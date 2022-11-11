import { MachineConfig, actions, AssignAction } from "xstate";

const { send, assign, choose } = actions;

const startSession = {
  version: "3.3",
  session: { device_id: "tala-speech" },
  request: {
    start_session: {},
  },
};

const passivity = (sessionObject: any) => ({
  version: "3.3",
  session: sessionObject,
  request: {
    passivity: {},
  },
});

const nlInput = (
  sessionObject: any,
  ddd: string,
  moves: any,
  hypotheses: Hypothesis[]
) => ({
  version: "3.3",
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

const segmentInput = (sessionObject: any, ddd: string) => ({
  version: "3.3",
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

const hapticInput = (sessionObject: any, alternative: any) => ({
  version: "3.3",
  session: sessionObject,
  request: {
    semantic_input: {
      interpretations: [
        {
          modality: "haptic",
          moves: [
            {
              perception_confidence: 1,
              understanding_confidence: 1,
              semantic_expression: alternative.semantic_expression,
            },
          ],
        },
      ],
    },
  },
});

const tdmRequest = (endpoint: string, requestBody: any) =>
  fetch(
    new Request(endpoint, {
      method: "POST",
      headers: {
        "Content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })
  ).then((data) => data.json());

const tdmAssign: AssignAction<SDSContext, any> = assign({
  sessionObject: (_ctx, event) => event.data.session,
  tdmAll: (_ctx, event) => event.data,
  tdmOutput: (_ctx, event) => event.data.output,
  tdmActiveDDD: (_ctx, event) => event.data.context.active_ddd,
  tdmAvailableDDDs: (_ctx, event) => event.data.context.available_ddds,
  tdmUtterance: (_ctx, event) => event.data.output.utterance,
  tdmVisualOutputInfo: (_ctx, event) =>
    (event.data.output.visual_output || [{}])[0].visual_information,
  tdmExpectedAlternatives: (_ctx, event) =>
    (event.data.context.expected_input || {}).alternatives,
  tdmPassivity: (_ctx, event) => event.data.output.expected_passivity,
  tdmActions: (_ctx, event) => event.data.output.actions,
  tdmAsrHints: (_ctx, event) => event.data.context.asr_hints,
});

const maybeAlternatives = choose<SDSContext, SDSEvent>([
  {
    cond: (context) => {
      return (context.tdmExpectedAlternatives || [{}])[0].visual_information;
    },
    actions: [send({ type: "SHOW_ALTERNATIVES" })],
  },
]);

export const tdmDmMachine: MachineConfig<SDSContext, any, SDSEvent> = {
  initial: "getPages",
  on: {
    TURNPAGE: {
      actions: [assign({ segment: (_ctx, event) => event.value })],
    },
    STOP: ".stopped",
  },
  states: {
    fail: {},
    stopped: { on: { CLICK: "getPages" } },
    getPages: {
      invoke: {
        id: "startSession",
        src: (context, _evt) =>
          tdmRequest(context.parameters.endpoint, startSession),
        onDone: [
          {
            target: "idle",
            actions: [tdmAssign, "setAvailableDDDs"],
            cond: (_ctx, event) => event.data.output,
          },
          {
            target: "fail",
          },
        ],
        onError: { target: "fail" },
      },
    },
    idle: {
      on: {
        CLICK: "init",
        SELECT: {
          actions: [
            send("CLICK"),
            assign({
              segment: (_ctx, event) => ({
                dddName: event.value.ddd,
                pageNumber: 0,
              }),
            }),
          ],
        },
      },
    },
    init: {
      on: {
        TTS_READY: "tdm",
        CLICK: "tdm",
      },
    },
    tdm: {
      initial: "start",
      states: {
        start: {
          invoke: {
            id: "startSession",
            src: (context, _evt) =>
              tdmRequest(context.parameters.endpoint, startSession),
            onDone: [
              {
                target: "selectSegment",
                actions: tdmAssign,
                cond: (_ctx, event) => event.data.output,
              },
              {
                target: "fail",
              },
            ],
            onError: { target: "fail" },
          },
        },
        selectSegment: {
          invoke: {
            id: "segmentInput",
            src: (context, _evt) =>
              tdmRequest(
                context.parameters.endpoint,
                segmentInput(context.sessionObject, context.segment.dddName)
              ),
            onDone: [
              {
                target: "utter",
                actions: tdmAssign,
                cond: (_ctx, event) => event.data.output,
              },
              {
                target: "fail",
              },
            ],
            onError: { target: "fail" },
          },
        },
        utter: {
          initial: "prompt",
          on: {
            RECOGNISED: "next",
            SELECT: {
              target: "nextHaptic",
              actions: assign({ hapticInput: (_ctx, event) => event.value }),
            },
            TIMEOUT: "passivity",
          },
          states: {
            prompt: {
              entry: [
                maybeAlternatives,
                send((context: SDSContext) => ({
                  type: "SPEAK",
                  value: context.tdmUtterance,
                })),
              ],
              on: {
                ENDSPEECH: [
                  {
                    target: "#root.dm.init",
                    cond: (context) =>
                      context.tdmActions.some((item: any) =>
                        [
                          "EndOfSection",
                          "EndSession",
                          "EndConversation",
                        ].includes(item.name)
                      ),
                  },
                  {
                    target: "#root.dm.tdm.passivity",
                    cond: (context) => context.tdmPassivity === 0,
                  },
                  { target: "ask" },
                ],
              },
            },
            ask: {
              entry: send("LISTEN"),
            },
          },
        },
        next: {
          invoke: {
            id: "nlInput",
            src: (context, _evt) =>
              tdmRequest(
                context.parameters.endpoint,
                nlInput(
                  context.sessionObject,
                  context.tdmActiveDDD,
                  context.tdmOutput.moves,
                  context.recResult
                )
              ),
            onDone: [
              {
                target: "utter",
                actions: tdmAssign,
                cond: (_ctx, event) => event.data.output,
              },
              {
                target: "fail",
              },
            ],
            onError: { target: "fail" },
          },
        },
        nextHaptic: {
          invoke: {
            id: "hapticInput",
            src: (context, _evt) =>
              tdmRequest(
                context.parameters.endpoint,
                hapticInput(context.sessionObject, context.hapticInput)
              ),
            onDone: [
              {
                target: "utter",
                actions: tdmAssign,
                cond: (_ctx, event) => event.data.output,
              },
              {
                target: "fail",
              },
            ],
            onError: { target: "fail" },
          },
        },
        passivity: {
          invoke: {
            id: "passivity",
            src: (context, _evt) =>
              tdmRequest(
                context.parameters.endpoint,
                passivity(context.sessionObject)
              ),
            onDone: [
              {
                target: "utter",
                actions: tdmAssign,
                cond: (_ctx, event) => event.data.output,
              },
              {
                target: "fail",
              },
            ],
            onError: { target: "fail" },
          },
        },
        fail: {},
      },
    },
  },
};
