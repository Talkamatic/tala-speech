import { assign, createActor, setup, fromPromise, AnyActor } from "xstate";
import { speechstate, Agenda, Hypothesis } from "speechstate";
import { AZURE_PROXY, ENDPOINT } from "./credentials.ts";

declare global {
  interface Window {
    TalaSpeech: AnyActor;
  }
}

interface Settings {
  deviceID: string;
  sessionObjectAdditions: any;
  endpoint: string;
  ttsVoice: string;
  ttsLexicon: string;
  speechRate: string;
  asrLanguage: string;
  azureKey?: string;
  azureProxyURL?: string;
  completeTimeout: number;
  fillerDelay: number;
  clickToSkip: boolean;
  i18nClickToStart: string;
  i18nListening: string;
  i18nSpeaking: string;
  i18nClickToContinue: string;
}

interface DMContext {
  settings: Settings;
  spstRef?: any;
  segment?: string;
  tdmState: any;
}

type DMEvent =
  | SSDMEvent
  | { type: "TURNPAGE"; value: string }
  | { type: "START" };

type SSDMEvent = // todo move to SpeechState

    | { type: "PREPARE" }
    | { type: "ASRTTS_READY" }
    | { type: "CONTROL" }
    | { type: "STOP" }
    | { type: "SPEAK"; value: Agenda }
    | { type: "LISTEN" } // TODO parameters!
    | { type: "TTS_STARTED" }
    | { type: "TTS_ERROR" }
    | { type: "SPEAK_COMPLETE" }
    | { type: "ASR_STARTED" }
    | { type: "ASR_NOINPUT" }
    | { type: "RECOGNISED"; value: Hypothesis[] };

async function tdmRequest(endpoint: string, requestBody: any) {
  return fetch(
    new Request(endpoint, {
      method: "POST",
      headers: {
        "Content-type": "application/json",
      },
      body: JSON.stringify({
        version: "3.4",
        ...requestBody,
      }),
    }),
  ).then((data) => data.json());
}

const VERSION = "3.4";
const startSessionBody = (deviceID: string, sessionObjectAdditions: any) => ({
  version: VERSION,
  session: { device_id: deviceID, ...sessionObjectAdditions },
  request: {
    start_session: {},
  },
});
const sendSegmentBody = (sessionObject: any, ddd: string) => ({
  version: VERSION,
  session: sessionObject,
  request: {
    semantic_input: {
      interpretations: [
        {
          modality: "other",
          moves: [
            {
              ddd: ddd,
              perception_confidence: 1,
              understanding_confidence: 1,
              semantic_expression: "request(top)",
            },
          ],
        },
      ],
    },
  },
});

const dmMachine = setup({
  actions: {
    tdmAssign: assign((_, params: any) => {
      console.debug("[tdmState]", params);
      return { tdmState: params };
    }),
  },
}).createMachine({
  id: "DM",
  initial: "GetPages",
  context: {
    settings: {
      deviceID: "tala-speech",
      endpoint: ENDPOINT,
      sessionObjectAdditions: {},
    },
  },
  types: {} as {
    context: DMContext;
    events: DMEvent;
  },
  on: {
    TURNPAGE: {
      actions: [assign({ segment: ({ event }) => event.value })],
    },
    STOP: ".Stopped",
  },
  entry: assign({
    spstRef: ({ spawn }) => {
      return spawn(speechstate, {
        // TODO: turn this into event-based (CREATE?)
        input: {
          azureCredentials: AZURE_PROXY,
          asrDefaultCompleteTimeout: 0,
          locale: "en-US",
          asrDefaultNoInputTimeout: 5000,
          ttsDefaultVoice: "en-US-DavisNeural",
        },
      });
    },
  }),
  states: {
    GetPages: {
      invoke: {
        id: "startSession",
        input: ({ context }) => ({
          endpoint: context.settings.endpoint,
          deviceID: context.settings.deviceID,
          sessionObjectAdditions: context.settings.sessionObjectAdditions,
        }),
        src: fromPromise(({ input }) =>
          tdmRequest(
            input.endpoint,
            startSessionBody(input.deviceID, input.sessionObjectAdditions),
          ),
        ),
        onDone: [
          {
            target: "Idle",
            actions: [
              { type: "tdmAssign", params: ({ event }) => event.output },
              assign({
                segment: ({ context }) =>
                  context.tdmState.context.available_ddds[0],
              }),
            ],
            guard: ({ event }) => !!event.output,
          },
          {
            target: "Fail",
          },
        ],
        onError: { target: "Fail" },
      },
    },
    Idle: { on: { START: "Active" } },
    Active: {
      initial: "Start",
      states: {
        Start: {
          invoke: {
            id: "sendSegment",
            input: ({ context }) => ({
              endpoint: context.settings.endpoint,
              sessionObject: context.tdmState.session,
              segment: context.segment,
            }),
            src: fromPromise(({ input }) =>
              tdmRequest(
                input.endpoint,
                sendSegmentBody(input.sessionObject, input.segment),
              ),
            ),
            onDone: [
              {
                target: "Next",
                actions: [
                  { type: "tdmAssign", params: ({ event }) => event.output },
                ],
                guard: ({ event }) => !!event.output,
              },
              {
                target: "#DM.Fail",
              },
            ],
            onError: { target: "#DM.Fail" },
          },
        },
        Next: {},
      },
    },
    Stopped: { on: { START: "GetPages" } },
    Fail: {},

    /////////////////////////////
    Prepare: {
      entry: [
        ({ context }) =>
          context.spstRef.send({
            type: "PREPARE",
          }),
      ],
      on: {
        ASRTTS_READY: {
          target: "start",
          actions: () => console.debug("[SpSt→DM] ASRTTS_READY"),
        },
      },
    },
    start: {
      entry: ({ context }) =>
        context.spstRef.send({
          type: "SPEAK",
          value: { utterance: "hello world" },
        }),
      on: {
        SPEAK_COMPLETE: {
          actions: () => console.debug("[SpSt→DM] SPEAK_COMPLETE"),
        },
      },
    },
    ask: {
      entry: ({ context }) =>
        context.spstRef.send({
          type: "LISTEN",
        }),
      on: {
        RECOGNISED: {
          target: "repeat",
          actions: [({ event }) => console.log(event)],
        },
      },
    },
    repeat: {
      entry: ({ context, event }) =>
        context.spstRef.send({
          type: "SPEAK",
          value: { utterance: event.value[0].utterance },
        }),
      on: {
        SPEAK_COMPLETE: {
          target: "ask",
          actions: () => console.debug("[SpSt→DM] ENDSPEECH"),
        },
      },
    },
  },
});

const talaSpeechService = createActor(dmMachine);
talaSpeechService.start();
talaSpeechService.subscribe((state) => {
  console.log(state.value, state.context);
});
window.TalaSpeech = talaSpeechService;
