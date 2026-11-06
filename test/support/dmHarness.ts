import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const endpoint = "https://tdm.example.test/dialogue";
interface SseEvent {
  type: string;
  data?: string;
}

const defaultSseEvents: SseEvent[] = [
  { type: "INIT" },
  { type: "STREAMING_CHUNK", data: "Welcome from " },
  { type: "STREAMING_CHUNK", data: "the SSE stream." },
  { type: "STREAMING_DONE" },
];

const createSpeechstateTestDouble = (sseStreams: SseEvent[][]) => `
  import { assign, sendParent, setup } from "xstate";

  const sseStreams = ${JSON.stringify(sseStreams)};

  export const speechstate = setup({
    actions: {
      notifyReady: sendParent({ type: "ASRTTS_READY" }),
      consumeSseStream: assign(({ context, event }) => {
        const streamEvents = event.value.stream
          ? sseStreams[
              Math.min(context.speakHistory.length, sseStreams.length - 1)
            ] || []
          : [];
        const streamedText = streamEvents
          .filter(({ type }) => type === "STREAMING_CHUNK")
          .map(({ data }) => data || "")
          .join("");
        const streamComplete = streamEvents.some(
          ({ type }) => type === "STREAMING_DONE",
        );
        return {
          streamUrl: event.value.stream,
          streamedText,
          streamComplete,
          speakHistory: [
            ...context.speakHistory,
            {
              value: event.value,
              streamedText,
              streamComplete,
              interrupted: false,
            },
          ],
        };
      }),
      markStreamInterrupted: assign(({ context }) => ({
        speakHistory: context.speakHistory.map((speech, index) =>
          index === context.speakHistory.length - 1
            ? { ...speech, interrupted: true }
            : speech,
        ),
      })),
      notifyRecognised: sendParent(({ event }) => ({
        type: "RECOGNISED",
        value: event.value,
        bargeIn: true,
      })),
      notifyListenComplete: sendParent({ type: "LISTEN_COMPLETE" }),
    },
  }).createMachine({
    id: "speechstate-test-double",
    context: () => ({
      streamUrl: undefined,
      streamedText: "",
      streamComplete: false,
      speakHistory: [],
    }),
    initial: "not-ready",
    states: {
      "not-ready": {
        meta: { view: "initiating" },
        on: {
          PREPARE: { target: "ready", actions: "notifyReady" },
          STOP: "stopped",
          UPDATE_ASR_PARAMETERS: {},
        },
      },
      ready: {
        meta: { view: "ready" },
        on: {
          CONTROL: {},
          STOP: "stopped",
          SPEAK: { target: "speaking", actions: "consumeSseStream" },
          UPDATE_ASR_PARAMETERS: {},
        },
      },
      speaking: {
        meta: { view: "speaking" },
        on: {
          CONTROL: {},
          SPEAK_COMPLETE: "ready",
          SPEAK: {
            target: "speaking",
            reenter: true,
            actions: "consumeSseStream",
          },
          TEST_ASR_INTERRUPT: {
            actions: ["markStreamInterrupted", "notifyRecognised"],
          },
          TEST_LISTEN_COMPLETE: {
            target: "ready",
            actions: "notifyListenComplete",
          },
          STOP: "stopped",
          UPDATE_ASR_PARAMETERS: {},
        },
      },
      stopped: { meta: { view: "stopped" } },
    },
  });
`;

const defaultBackendResponse = () => ({
  session: {
    session_id: "session-123",
    sse_endpoint: "https://tdm.example.test/stream",
    barge_in: false,
  },
  context: {
    available_ddds: ["welcome"],
    asr_hints: [],
  },
  output: {
    expected_passivity: 2,
    speech_complete_timeout: 1,
    moves: [],
    utterance: "Welcome",
  },
});

const replaceGlobal = (name: string, value: unknown) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (previous) {
      Object.defineProperty(globalThis, name, previous);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  };
};

export const waitForActorSnapshot = (
  actor: any,
  predicate: (snapshot: any) => boolean,
  description = "expected actor snapshot",
) =>
  new Promise<any>((resolveState, rejectState) => {
    let lastSnapshot = actor.getSnapshot();
    if (predicate(lastSnapshot)) {
      resolveState(lastSnapshot);
      return;
    }

    let subscription: any;
    const timeout = setTimeout(() => {
      subscription?.unsubscribe();
      rejectState(
        new Error(
          `Timed out waiting for ${description}; last state: ${JSON.stringify(lastSnapshot?.value)}`,
        ),
      );
    }, 2_000);
    subscription = actor.subscribe((snapshot: any) => {
      lastSnapshot = snapshot;
      if (predicate(snapshot)) {
        clearTimeout(timeout);
        subscription.unsubscribe();
        resolveState(snapshot);
      }
    });
  });

export const waitForDmSnapshot = waitForActorSnapshot;

export const waitForDmState = (actor: any, expectedState: string) =>
  waitForDmSnapshot(
    actor,
    (snapshot) => snapshot.value === expectedState,
    `state ${expectedState}`,
  );

interface StartDmSessionOptions {
  backendResponse?: Record<string, any>;
  backendResponses?: Record<string, any>[];
  sseEvents?: SseEvent[];
  sseStreams?: SseEvent[][];
  settings?: Record<string, any>;
}

export const startDmSession = async (options: StartDmSessionOptions = {}) => {
  const backendResponses = options.backendResponses || [
    options.backendResponse || defaultBackendResponse(),
  ];
  const backendResponse = backendResponses[0];
  const sseStreams = options.sseStreams || [options.sseEvents || defaultSseEvents];
  const settings = options.settings || {};
  const tempDirectory = await mkdtemp(
    join(projectRoot, "test", ".tala-speech-dm-test-"),
  );
  const bundlePath = join(tempDirectory, "index.mjs");
  const globalNames = ["TalaSpeech", "TalaSpeechUIState", "TalaSpeechRenderer"];
  const previousGlobals = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const requests: Request[] = [];
  const restorers: Array<() => void> = [];
  let actor: any;
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    actor?.stop();
    restorers.reverse().forEach((restore) => restore());
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
    await rm(tempDirectory, { recursive: true, force: true });
  };

  try {
    await build({
      entryPoints: [join(projectRoot, "src/index.ts")],
      outfile: bundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
      external: ["xstate"],
      loader: { ".css": "empty" },
      plugins: [
        {
          name: "speechstate-test-double",
          setup(pluginBuild) {
            pluginBuild.onResolve(
              { filter: /^speechstate$/ },
              () => ({ path: "speechstate", namespace: "speechstate-test" }),
            );
            pluginBuild.onLoad(
              { filter: /.*/, namespace: "speechstate-test" },
              () => ({
                contents: createSpeechstateTestDouble(sseStreams),
                loader: "js",
              }),
            );
          },
        },
      ],
    });

    restorers.push(replaceGlobal("window", globalThis));
    restorers.push(
      replaceGlobal("document", {
        createElement: () => ({ setAttribute: () => {} }),
        documentElement: { getAttribute: () => null },
        head: { appendChild: () => {} },
        getElementById: () => null,
      }),
    );
    restorers.push(
      replaceGlobal("fetch", async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        requests.push(request);
        const response = backendResponses[
          Math.min(requests.length - 1, backendResponses.length - 1)
        ];
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await import(pathToFileURL(bundlePath).href);
    actor = (globalThis as any).TalaSpeech;
    const beforePrepare = waitForDmState(actor, "BeforePrepare");
    actor.send({
      type: "SETUP",
      value: {
        deviceID: "device-42",
        endpoint,
        azureCredentials: "test-credentials",
        azureRegion: "test-region",
        sessionObjectAdditions: { locale: "en-US" },
        ...settings,
      },
    });
    const snapshot = await beforePrepare;

    const sendSpeechEvent = (event: Record<string, any>) =>
      actor.getSnapshot().context.spstRef.send(event);

    return {
      actor,
      backendResponse,
      backendResponses,
      endpoint,
      requests,
      snapshot,
      sendSpeechEvent,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
