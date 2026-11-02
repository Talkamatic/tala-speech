import { afterEach, describe, expect, it, vi } from "vitest";

import {
  asrParametersForResponse,
  DEFERRED_NO_INPUT_TIMEOUT_MS,
  PassivityCoordinator,
  updateAsrParameters,
} from "../src/passivity";

afterEach(() => {
  vi.useRealTimers();
});

function givenSpeechState() {
  let snapshot = { value: { Recognising: { NoInput: "ApplyNoInputTimeout" } } };
  const listeners = new Set<(snapshot: typeof snapshot) => void>();
  const asrRef = {
    send: vi.fn(),
    getSnapshot: () => snapshot,
    subscribe: vi.fn((listener: (snapshot: typeof snapshot) => void) => {
      listeners.add(listener);
      listener(snapshot);
      return {
        unsubscribe: () => listeners.delete(listener),
      };
    }),
  };

  return {
    speechState: {
      send: vi.fn(),
      getSnapshot: () => ({ context: { asrRef } }),
    },
    asrRef,
    setAsrState(value: typeof snapshot.value) {
      snapshot = { value };
      listeners.forEach((listener) => listener(snapshot));
    },
  };
}

const instructionResponse = {
  context: { asr_hints: [] },
  output: {
    expected_passivity: 5,
    moves: ["request(next_instruction)"],
    speech_complete_timeout: 0,
  },
};

describe("ASR passivity settings", () => {
  it("uses the arriving response rather than the preceding turn's timeout", () => {
    const previousResponse = {
      context: { asr_hints: ["previous hint"] },
      output: {
        expected_passivity: 0,
        moves: ["report(action_status(previous_step, done))"],
        speech_complete_timeout: 0,
      },
    };
    const arrivingResponse = {
      context: { asr_hints: ["next hint"] },
      output: {
        expected_passivity: 5,
        moves: ["request(next_instruction)"],
        speech_complete_timeout: 2,
      },
    };

    expect(asrParametersForResponse(arrivingResponse)).toEqual({
      noInputTimeout: 30_000,
      hints: ["next hint"],
      completeTimeout: 2_000,
    });
    expect(asrParametersForResponse(previousResponse).noInputTimeout).toBe(0);
  });

  it("uses the new response when updating SpeechState", () => {
    const { speechState, asrRef } = givenSpeechState();
    const response = {
      ...instructionResponse,
      context: { asr_hints: ["next hint"] },
    };

    updateAsrParameters(speechState, response);

    expect(asrRef.send).toHaveBeenCalledWith({
      type: "UPDATE_ASR_PARAMETERS",
      value: {
        noInputTimeout: DEFERRED_NO_INPUT_TIMEOUT_MS,
        hints: ["next hint"],
        completeTimeout: 0,
      },
    });
    expect(speechState.send).not.toHaveBeenCalled();
  });

  it("allows a configured instruction wait longer than the default", () => {
    const response = {
      context: {},
      output: {
        expected_passivity: 45,
        moves: ["request(next_instruction)"],
      },
    };

    expect(asrParametersForResponse(response, 60).noInputTimeout).toBe(60_000);
  });

  it("does not shorten an instruction wait that already exceeds the minimum", () => {
    const response = {
      context: {},
      output: {
        expected_passivity: 45,
        moves: ["request(next_instruction)"],
      },
    };

    expect(asrParametersForResponse(response).noInputTimeout).toBe(45_000);
  });

  it("preserves zero-timeout automatic continuations", () => {
    const response = {
      context: {},
      output: {
        expected_passivity: 0,
        moves: ["request(next_instruction)"],
      },
    };

    expect(asrParametersForResponse(response).noInputTimeout).toBe(0);
  });

  it("preserves existing timeouts for non-instruction moves", () => {
    const response = {
      context: {},
      output: {
        expected_passivity: 5,
        moves: ["ask(?X.goal(X))"],
      },
    };

    expect(asrParametersForResponse(response).noInputTimeout).toBe(5_000);
  });

  it("preserves the existing indefinite-listening fallback", () => {
    const response = {
      context: {},
      output: {
        moves: ["request(next_instruction)"],
      },
    };

    expect(asrParametersForResponse(response).noInputTimeout).toBe(86_400_000);
  });

  it("starts the timeout only after speech and the matching response both complete", () => {
    vi.useFakeTimers();
    const { speechState, asrRef } = givenSpeechState();
    const coordinator = new PassivityCoordinator();

    coordinator.beginPrompt(
      { output: { expected_passivity: 0, moves: ["answer(help(help_top))"] } },
      speechState,
      30,
    );
    coordinator.requestStarted();
    coordinator.listenerStarted();
    coordinator.speechComplete();

    vi.advanceTimersByTime(60_000);
    expect(asrRef.send).not.toHaveBeenCalledWith({ type: "NOINPUT" });

    coordinator.responseArrived(instructionResponse);
    vi.advanceTimersByTime(29_999);
    expect(asrRef.send).not.toHaveBeenCalledWith({ type: "NOINPUT" });
    vi.advanceTimersByTime(1);
    expect(asrRef.send).toHaveBeenCalledWith({ type: "NOINPUT" });
  });

  it("does not start the timeout until TTS completes when the response arrives first", () => {
    vi.useFakeTimers();
    const { speechState, asrRef } = givenSpeechState();
    const coordinator = new PassivityCoordinator();

    coordinator.beginPrompt(instructionResponse, speechState, 30);
    coordinator.requestStarted();
    coordinator.listenerStarted();
    coordinator.responseArrived(instructionResponse);

    vi.advanceTimersByTime(60_000);
    expect(asrRef.send).not.toHaveBeenCalledWith({ type: "NOINPUT" });

    coordinator.speechComplete();
    vi.advanceTimersByTime(29_999);
    expect(asrRef.send).not.toHaveBeenCalledWith({ type: "NOINPUT" });
    vi.advanceTimersByTime(1);
    expect(asrRef.send).toHaveBeenCalledWith({ type: "NOINPUT" });
  });

  it("cancels a deferred passivity timeout when the user starts speaking", () => {
    vi.useFakeTimers();
    const { speechState, asrRef, setAsrState } = givenSpeechState();
    const coordinator = new PassivityCoordinator();

    coordinator.beginPrompt(instructionResponse, speechState, 30);
    coordinator.requestStarted();
    coordinator.listenerStarted();
    coordinator.speechComplete();
    coordinator.responseArrived(instructionResponse);

    setAsrState({ Recognising: "InProgress" });
    vi.advanceTimersByTime(30_000);

    expect(asrRef.send).not.toHaveBeenCalledWith({ type: "NOINPUT" });
  });

  it("preserves immediate continuation after both speech and response complete", () => {
    vi.useFakeTimers();
    const { speechState, asrRef } = givenSpeechState();
    const coordinator = new PassivityCoordinator();
    const automaticResponse = {
      context: {},
      output: {
        expected_passivity: 0,
        moves: ["request(next_instruction)"],
      },
    };

    coordinator.beginPrompt(automaticResponse, speechState);
    coordinator.requestStarted();
    coordinator.listenerStarted();
    coordinator.speechComplete();
    vi.advanceTimersByTime(60_000);
    expect(asrRef.send).not.toHaveBeenCalledWith({ type: "NOINPUT" });

    coordinator.responseArrived(automaticResponse);
    vi.advanceTimersByTime(0);

    expect(asrRef.send).toHaveBeenCalledWith({ type: "NOINPUT" });
  });
});
