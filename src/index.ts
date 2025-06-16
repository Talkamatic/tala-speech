import {
  assign,
  raise,
  createActor,
  setup,
  fromPromise,
  waitFor,
  AnyActor,
  stateIn,
} from "xstate";
import {
  speechstate,
  Hypothesis,
  Settings,
  SpeechStateExternalEvent,
} from "speechstate";

import { metaToTailwind } from "./metaToTailwind";

import "./index.css";

declare global {
  interface Window {
    TalaSpeech: AnyActor;
    TalaSpeechUIState: string | undefined;
    TalaSpeechRenderer: {
      renderTalaSpeech: (
        settings: TDMSettings,
        page: string,
        element: HTMLDivElement,
      ) => void;
      getDialogueJson: (url: string) => unknown;
    };
  }
}

interface TDMSettings extends Settings {
  deviceID: string;
  sessionObjectAdditions?: any;
  endpoint: string;
}

interface DMContext {
  tdmSettings?: TDMSettings;
  spstRef?: any;
  segment?: string;
  tdmState?: any;
  lastResult?: Hypothesis[];
  avatarName?: string;
}

type DMEvent =
  | SpeechStateExternalEvent
  | { type: "SETUP"; value: TDMSettings }
  | { type: "TURN_PAGE"; value: string }
  | { type: "START" };

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

const startSessionBody = (deviceID: string, sessionObjectAdditions: any) => ({
  session: { device_id: deviceID, ...sessionObjectAdditions },
  request: {
    start_session: {},
  },
});
const sendSegmentBody = (sessionObject: any, ddd: string) => ({
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
const nlInputBody = (
  sessionObject: any,
  ddd: string,
  moves: string[],
  hypotheses: Hypothesis[],
) => ({
  session: {
    ...sessionObject,
    ddd: ddd,
    moves: moves,
  },
  request: {
    natural_language_input: {
      modality: "speech",
      hypotheses: hypotheses,
    },
  },
});
const passivityBody = (sessionObject: any) => ({
  session: sessionObject,
  request: {
    passivity: {},
  },
});

const dmMachine = setup({
  types: {} as {
    context: DMContext;
    events: DMEvent;
  },
  actions: {
    tdmAssign: assign((_, params: any) => {
      console.debug("[tdmState]", params);
      return { tdmState: params };
    }),
  },
  actors: {
    startSession: fromPromise<
      any,
      { endpoint: string; deviceID: string; sessionObjectAdditions: any }
    >(({ input }) =>
      tdmRequest(
        input.endpoint,
        startSessionBody(input.deviceID, input.sessionObjectAdditions || {}),
      ),
    ),
    sendSegment: fromPromise<
      any,
      { endpoint: string; sessionObject: any; segment: string }
    >(({ input }) =>
      tdmRequest(
        input.endpoint,
        sendSegmentBody(input.sessionObject, input.segment),
      ),
    ),
    nlInput: fromPromise<
      any,
      {
        endpoint: string;
        sessionObject: any;
        activeDDD: string;
        moves: string[];
        lastResult: Hypothesis[];
      }
    >(({ input }) =>
      tdmRequest(
        input.endpoint,
        nlInputBody(
          input.sessionObject,
          input.activeDDD,
          input.moves,
          input.lastResult,
        ),
      ),
    ),
    passivity: fromPromise<any, { endpoint: string; sessionObject: any }>(
      ({ input }) =>
        tdmRequest(input.endpoint, passivityBody(input.sessionObject)),
    ),
  },
  guards: {
    stateInTDMIdle: stateIn("#TDMIdle"),
  },
}).createMachine({
  id: "DM",
  initial: "BeforeSetup",
  on: {
    TURN_PAGE: {
      actions: assign({ segment: ({ event }) => event.value }),
    },
    STOP: ".Stopped",
  },
  states: {
    BeforeSetup: {
      meta: { view: "initiating" },
      on: {
        SETUP: {
          target: "GetPages",
          actions: assign({ tdmSettings: ({ event }) => event.value }),
        },
      },
    },
    GetPages: {
      meta: { view: "initiating" },
      entry: assign({
        spstRef: ({ spawn, context }) =>
          /** TODO: fix typings */
          {
            return spawn(speechstate as any, {
              id: "speechstate",
              input: {
                azureCredentials: context.tdmSettings!.azureCredentials,
                azureRegion: context.tdmSettings!.azureRegion,
                asrDefaultCompleteTimeout:
                  context.tdmSettings!.asrDefaultCompleteTimeout || 0,
                locale: context.tdmSettings!.locale || "en-US",
                asrDefaultNoInputTimeout:
                  context.tdmSettings!.asrDefaultNoInputTimeout || 5000,
                ttsDefaultVoice:
                  context.tdmSettings!.ttsDefaultVoice || "en-US-DavisNeural",
                ttsDefaultFiller: context.tdmSettings!.ttsDefaultFiller,
                ttsDefaultFillerDelay:
                  context.tdmSettings!.ttsDefaultFillerDelay,
                ttsLexicon: context.tdmSettings!.ttsLexicon,
                speechRecognitionEndpointId:
                  context.tdmSettings!.speechRecognitionEndpointId,
                noPonyfill: context.tdmSettings!.noPonyfill || false,
              } as any,
            });
          },
      }),
      invoke: {
        src: "startSession",
        input: ({ context }) => ({
          endpoint: context.tdmSettings!.endpoint,
          deviceID: context.tdmSettings!.deviceID,
          sessionObjectAdditions: context.tdmSettings!.sessionObjectAdditions,
        }),
        onDone: [
          {
            target: "BeforePrepare",
            actions: [
              {
                type: "tdmAssign",
                params: ({ event }: { event: any }) => event.output,
              },
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
    BeforePrepare: {
      meta: { view: "before-prepare" },
      on: { PREPARE: "Prepare" },
    },
    Prepare: {
      meta: { view: "initiating" },
      entry: [
        ({ context }) =>
          context.spstRef.send({
            type: "PREPARE",
          }),
      ],
      on: {
        ASRTTS_READY: {
          target: "Idle",
          actions: () => console.debug("[SpSt→DM] ASRTTS_READY"),
        },
      },
    },
    Idle: { meta: { view: "ready" }, on: { START: "Active" } },
    End: { meta: { view: "end" }, on: { START: "Active" } },
    Active: {
      meta: { view: "active" },
      initial: "Conversation",
      on: {
        STOP: {
          target: "#DM.Stopped",
          actions: ({ context }) =>
            context.spstRef.send({
              type: "STOP",
            }),
        },
      },
      states: {
        Conversation: {
          type: "parallel",
          states: {
            Adjacency: {
              initial: "Prompt",
              states: {
                Prompt: {
                  entry: ({ context }) =>
                    context.spstRef.send({
                      type: "SPEAK",
                      value: {
                        utterance: context.tdmState.output.utterance,
                        stream: `${context.tdmState.session.sse_endpoint || "https://tala-event-sse.azurewebsites.net/event-sse"}/${context.tdmState.session.session_id}`,
                        cache:
                          "https://tala-tts-service.azurewebsites.net/api/",
                      },
                    }),
                  on: {
                    CONTROL: {
                      actions: ({ context }) =>
                        context.spstRef.send({ type: "CONTROL" }),
                    },
                    STREAMING_SET_PERSONA: {
                      actions: [
                        () => console.debug("[SpSt→DM] STREAMING_SET_PERSONA"),
                        assign({
                          avatarName: ({ event }) => event.value,
                        }),
                      ],
                    },
                    SPEAK_COMPLETE: "WaitForTDM",
                  },
                },
                WaitForTDM: {
                  initial: "Wait",
                  states: {
                    Wait: {
                      always: [
                        {
                          guard: "stateInTDMIdle",
                          target: "Transition",
                        },
                      ],
                    },
                    Transition: {
                      type: "final",
                    },
                  },
                  onDone: [
                    {
                      target: "#DM.End",
                      guard: ({ context }) =>
                        context.tdmState.output.actions.some((item: any) =>
                          [
                            "EndOfSection",
                            "EndSession",
                            "EndConversation",
                          ].includes(item.name),
                        ),
                    },
                    {
                      /** if passivity is 0 don't listen */
                      target: "Prompt",
                      actions: raise({ type: "ASR_NOINPUT" }),
                      reenter: true,
                      guard: ({ context }) =>
                        context.tdmState.output.expected_passivity === 0,
                    },
                    { target: "Ask" },
                  ],
                },
                Ask: {
                  entry: ({ context }) =>
                    context.spstRef.send({
                      type: "LISTEN",
                      value: {
                        /** 0 vs null (null = ∞)*/
                        noInputTimeout:
                          (context.tdmState.output.expected_passivity
                            ? context.tdmState.output.expected_passivity * 1000
                            : context.tdmState.output.expected_passivity) ??
                          1000 * 3600 * 24,
                        hints: context.tdmState.context.asr_hints,
                        completeTimeout:
                          context.tdmState.output.speech_complete_timeout *
                          1000,
                      },
                    }),
                  on: {
                    LISTEN_COMPLETE: {
                      actions: () => console.debug("[SpSt→DM] LISTEN_COMPLETE"),
                      target: "Prompt",
                    },
                    CONTROL: {
                      actions: ({ context }) =>
                        context.spstRef.send({ type: "CONTROL" }),
                    },
                  },
                },
              },
            },
            TDMCalls: {
              initial: "Start",
              states: {
                Start: {
                  invoke: {
                    src: "sendSegment",
                    input: ({ context }) => ({
                      endpoint: context.tdmSettings!.endpoint,
                      sessionObject: context.tdmState.session,
                      segment: context.segment!,
                    }),
                    onDone: [
                      {
                        target: "Idle",
                        guard: ({ event }) => !!event.output.no_content,
                      },
                      {
                        target: "Idle",
                        actions: {
                          type: "tdmAssign",
                          params: ({ event }: { event: any }) => event.output,
                        },
                        guard: ({ event }) => !!event.output,
                      },
                      {
                        target: "#DM.Fail",
                      },
                    ],
                    onError: { target: "#DM.Fail" },
                  },
                },
                Idle: {
                  id: "TDMIdle",
                  on: {
                    RECOGNISED: {
                      target: "NLInput",
                      actions: [
                        assign({
                          lastResult: ({ event }) => event.value,
                        }),
                      ],
                    },
                    ASR_NOINPUT: {
                      target: "Passivity",
                    },
                  },
                },
                NLInput: {
                  invoke: {
                    src: "nlInput",
                    input: ({ context }) => ({
                      endpoint: context.tdmSettings!.endpoint,
                      sessionObject: context.tdmState.session,
                      activeDDD: context.tdmState.context.active_ddd,
                      moves: context.tdmState.output.moves,
                      lastResult: context.lastResult!,
                    }),
                    onDone: [
                      {
                        target: "Idle",
                        guard: ({ event }) => !!event.output.no_content,
                      },
                      {
                        target: "Idle",
                        actions: {
                          type: "tdmAssign",
                          params: ({ event }: { event: any }) => event.output,
                        },
                        guard: ({ event }) => !!event.output,
                      },
                      {
                        target: "#DM.Fail",
                      },
                    ],
                    onError: "#DM.Fail",
                  },
                },
                Passivity: {
                  invoke: {
                    src: "passivity",
                    input: ({ context }) => ({
                      endpoint: context.tdmSettings!.endpoint,
                      sessionObject: context.tdmState.session,
                    }),
                    onDone: [
                      {
                        target: "Idle",
                        guard: ({ event }) => !!event.output.no_content,
                      },
                      {
                        target: "Idle",
                        actions: {
                          type: "tdmAssign",
                          params: ({ event }: { event: any }) => event.output,
                        },
                        guard: ({ event }) => !!event.output,
                      },
                      { target: "#DM.Fail" },
                    ],
                    onError: "#DM.Fail",
                  },
                },
              },
            },
          },
        },
      },
    },
    Stopped: { meta: { view: "stopped" }, on: { SETUP: "BeforeSetup" } },
    Fail: { meta: { view: "fail" } },
  },
});

const talaSpeechService = createActor(dmMachine);
talaSpeechService.start();

window.TalaSpeechUIState = "initiating";
talaSpeechService.subscribe((state) => {
  let metaView: string | undefined;
  let metaTS: { view?: string } = Object.values(state.getMeta())[0] || {
    view: undefined,
  };
  let metaSS: { view?: string } = Object.values(
    state.context.spstRef.getSnapshot().getMeta(),
  )[0] || { view: undefined };
  if (metaTS.view === "active") {
    metaView = metaSS.view;
  } else {
    metaView = metaTS.view;
  }
  window.TalaSpeechUIState !== metaView &&
    console.debug("[TalaSpeechUIState]", metaView);
  window.TalaSpeechUIState = metaView;
});
window.TalaSpeech = talaSpeechService;

const getDialogueJson = async (url: string) =>
  await fetch(url).then((resp) => resp.json());

const renderTalaSpeech = async (
  settings: TDMSettings,
  page: string,
  element: HTMLDivElement,
) => {
  const button = document.createElement("button");
  const baseCSS =
    "bg-neutral-100 text-slate-900 text-2xl text-center py-2 px-5 rounded-r-2xl flex flex-row h-28 w-64 items-center justify-start gap-4 border border-[2px] border-slate-900";
  button.id = `${element.id}-button`;
  button.className = baseCSS;
  talaSpeechService.subscribe((_state) => {
    button.className = metaToTailwind(window.TalaSpeechUIState, baseCSS);
  });
  element.appendChild(button);

  talaSpeechService.send({ type: "SETUP", value: settings });
  await waitFor(
    talaSpeechService,
    (snapshot) => {
      return (
        (Object.values(snapshot.getMeta())[0] || {}).view === "before-prepare"
      );
    },
    {
      timeout: 10_000,
    },
  );
  talaSpeechService.send({ type: "TURN_PAGE", value: page });
  button.addEventListener(
    "click",
    () => {
      talaSpeechService.send({ type: "START" });
      talaSpeechService.send({ type: "CONTROL" });
    },
    false,
  );
  talaSpeechService.send({ type: "PREPARE" });
};

window.TalaSpeechRenderer = {
  renderTalaSpeech: renderTalaSpeech,
  getDialogueJson: getDialogueJson,
};
