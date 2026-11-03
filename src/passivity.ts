export const DEFERRED_NO_INPUT_TIMEOUT_MS = 2_147_000_000;

const DEFAULT_NO_INPUT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

interface TDMOutput {
  expected_passivity?: number | null;
  speech_complete_timeout?: number;
}

interface TDMResponse {
  context?: { asr_hints?: string[] };
  output?: TDMOutput;
}

interface SpeechStateRef {
  send: (event: { type: string; value?: unknown }) => void;
  getSnapshot: () => { context: { asrRef?: ASRActor } };
}

interface ASRSnapshot {
  value: any;
}

interface ASRActor {
  send: (event: { type: string; value?: unknown }) => void;
  getSnapshot: () => ASRSnapshot;
  subscribe: (listener: (snapshot: ASRSnapshot) => void) => {
    unsubscribe: () => void;
  };
}

export interface ASRParameters {
  noInputTimeout: number;
  hints?: string[];
  completeTimeout: number;
}

export function noInputTimeoutMs(output: TDMOutput) {
  const expectedPassivity = output.expected_passivity;
  if (expectedPassivity === undefined || expectedPassivity === null) {
    return DEFAULT_NO_INPUT_TIMEOUT_MS;
  }

  const expectedTimeoutMs = expectedPassivity * 1000;
  return expectedTimeoutMs;
}

export function asrParametersForResponse(response: TDMResponse): ASRParameters {
  const output = response.output || {};
  return {
    noInputTimeout: noInputTimeoutMs(output),
    hints: response.context?.asr_hints,
    completeTimeout: (output.speech_complete_timeout || 0) * 1000,
  };
}

export function updateAsrParameters(
  speechState: SpeechStateRef,
  response: TDMResponse,
) {
  const value = {
    ...asrParametersForResponse(response),
    noInputTimeout: DEFERRED_NO_INPUT_TIMEOUT_MS,
  };
  const asrRef = speechState.getSnapshot().context.asrRef;
  const target = asrRef || speechState;
  target.send({
    type: "UPDATE_ASR_PARAMETERS",
    value,
  });
  return value;
}

interface PassivityTurn {
  response: TDMResponse;
  responseReady: boolean;
  speechComplete: boolean;
  listenerReady: boolean;
  userSpeechStarted: boolean;
  speechState: SpeechStateRef;
  timeout?: ReturnType<typeof setTimeout>;
  asrSubscription?: { unsubscribe: () => void };
}

function userIsSpeaking(snapshot: ASRSnapshot) {
  const state = snapshot.value;
  const recognizing = typeof state === "string" ? state : state?.Recognising;
  return ["InProgress", "InterimResult", "NLURequest", "WaitToStop"].includes(recognizing);
}

export class PassivityCoordinator {
  private _requestPending = false;
  private _turn?: PassivityTurn;
  private _latestResponse?: TDMResponse;

  beginPrompt(
    response: TDMResponse,
    speechState: SpeechStateRef,
  ) {
    this._clearTurn();
    this._latestResponse = response;
    this._turn = {
      response,
      responseReady: !this._requestPending,
      speechComplete: false,
      listenerReady: false,
      userSpeechStarted: false,
      speechState,
    };
  }

  requestStarted() {
    this._requestPending = true;
    if (this._turn) {
      this._turn.responseReady = false;
      this._clearTimer(this._turn);
    }
  }

  responseArrived(response: TDMResponse) {
    this._requestPending = false;
    this._latestResponse = response;
    if (!this._turn || this._turn.userSpeechStarted) {
      return;
    }
    this._turn.response = response;
    this._turn.responseReady = true;
    this._scheduleNoInput(this._turn);
  }

  responseUnchanged() {
    this._requestPending = false;
    if (!this._turn || this._turn.userSpeechStarted) {
      return;
    }
    this._turn.response = this._latestResponse || this._turn.response;
    this._turn.responseReady = true;
    this._scheduleNoInput(this._turn);
  }

  speechComplete() {
    if (!this._turn) {
      return;
    }
    this._turn.speechComplete = true;
    this._scheduleNoInput(this._turn);
  }

  listenerStarted() {
    if (!this._turn) {
      return;
    }
    this._turn.listenerReady = true;
    this._scheduleNoInput(this._turn);
  }

  userRecognized() {
    if (!this._turn) {
      return;
    }
    this._turn.userSpeechStarted = true;
    this._clearTimer(this._turn);
  }

  cancel() {
    this._requestPending = false;
    this._clearTurn();
  }

  private _scheduleNoInput(turn: PassivityTurn) {
    if (
      this._turn !== turn || !turn.responseReady || !turn.speechComplete || !turn.listenerReady ||
      turn.userSpeechStarted || turn.timeout !== undefined
    ) {
      return;
    }

    const asrRef = turn.speechState.getSnapshot().context.asrRef;
    if (!asrRef) {
      return;
    }
    if (userIsSpeaking(asrRef.getSnapshot())) {
      turn.userSpeechStarted = true;
      return;
    }

    turn.asrSubscription = asrRef.subscribe((snapshot) => {
      if (userIsSpeaking(snapshot)) {
        turn.userSpeechStarted = true;
        this._clearTimer(turn);
      }
    });

    const timeoutMs = noInputTimeoutMs(turn.response.output || {});
    turn.timeout = setTimeout(() => {
      if (this._turn !== turn || turn.userSpeechStarted) {
        return;
      }
      this._clearTimer(turn);
      this._turn = undefined;
      asrRef.send({ type: "NOINPUT" });
    }, timeoutMs);
  }

  private _clearTimer(turn: PassivityTurn) {
    if (turn.timeout !== undefined) {
      clearTimeout(turn.timeout);
      turn.timeout = undefined;
    }
    turn.asrSubscription?.unsubscribe();
    turn.asrSubscription = undefined;
  }

  private _clearTurn() {
    if (this._turn) {
      this._clearTimer(this._turn);
      this._turn = undefined;
    }
  }
}
