import { waitFor, AnyActorRef } from "xstate";
import { talaSpeechService } from "../src/index";
import { AZURE_PROXY, ENDPOINT } from "../src/credentials";

import { describe, test, expect } from "vitest";

function getView(snapshot: any): string | undefined {
  const metaTS: { view?: string } = Object.values(snapshot.getMeta())[0] || {
    view: undefined,
  };
  return metaTS.view;
}

describe("Benchmark", async () => {
  talaSpeechService.send({
    type: "SETUP",
    value: {
      deviceID: "test-voice-stream",
      endpoint: ENDPOINT,
      azureCredentials: AZURE_PROXY,
      azureRegion: "swedencentral",
      locale: "en-US" /** default */,
      asrDefaultCompleteTimeout: 0 /** default */,
      asrDefaultNoInputTimeout: 5000 /** default */,
      ttsDefaultVoice: "en-US-DavisNeural" /** default */,
      azureLanguageCredentials: undefined /** default, not supported by TDM*/,
      speechRecognitionEndpointId: undefined /** default */,
    },
  });
  const s1 = await waitFor(
    talaSpeechService,
    (snapshot) => {
      return getView(snapshot) === "before-prepare";
    },
    {
      timeout: 1000,
    },
  );
  expect(s1).toBeTruthy();

  talaSpeechService.send({ type: "PREPARE" });
  const s2 = await waitFor(
    talaSpeechService,
    (snapshot) => {
      return getView(snapshot) === "ready";
    },
    {
      timeout: 3000,
    },
  );
  expect(s2).toBeTruthy();
  talaSpeechService.send({ type: "TURN_PAGE", value: "2" });
  talaSpeechService.send({ type: "START" });
  test("", async () => {
    const s3 = await waitFor(
      talaSpeechService,
      (snapshot) => {
        return getView(snapshot) === "???";
      },
      {
        timeout: 120_000,
      },
    );
    expect(s3).toBeTruthy();
  });
});
