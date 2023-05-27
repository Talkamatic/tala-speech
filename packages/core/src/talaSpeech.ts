import { createMachine, assign, fromPromise, raise } from "xstate";
import { ttsMachine } from "./tts";
// import { asrMachine } from "./asr";
// import { tdmDmMachine } from "./tdmClient";

const machine = createMachine(
  {
    types: {
      context: {} as DomainContext,
      events: {} as SDSEvent,
    },
    context: ({ input }) => ({
      parameters: input.parameters,
      sessionObject: null,
      hapticInput: null,
      recResult: null,
      azureAuthorizationToken: null,
      audioCtx: null,
      ttsRef: null,
      asrRef: null,
    }),
    id: "sds",
    type: "parallel",
    states: {
      dm: {
        // ...tdmDmMachine,
        initial: "idle",
        states: {
          idle: { on: { CLICK: "hello" } },
          hello: {
            entry: raise({
              type: "SPEAK",
              value: "hello world",
            }),
          },
        },
      },
      asrTtsSpawner: {
        initial: "idle",
        states: {
          idle: { on: { PREPARE: "createAudioContext" } },
          createAudioContext: {
            invoke: {
              id: "createAudioContext",
              src: "audioContext",
              onDone: {
                target: "spawn",
                actions: assign({ audioCtx: ({ event }) => event.output }),
              },
            },
          },
          spawn: {
            entry: [
              assign({
                ttsRef: ({ context, spawn }) => {
                  return spawn(ttsMachine, {
                    input: {
                      ttsVoice: context.parameters.ttsVoice,
                      audioCtx: context.audioCtx,
                      ttsLexicon: context.parameters.ttsLexicon,
                    },
                  });
                },
              }),
              // assign({
              //   asrRef: ({ context, spawn }) => {
              //     return spawn(asrMachine, {
              //       input: {
              //         language: context.parameters.ttsVoice,
              //         audioCtx: context.audioCtx,
              //       },
              //     });
              //   },
              // }),
            ],
            // after: {
            //   30000: {
            //     target: "spawn",
            //   },
            // },
          },
        },
      },
      asrTtsManager: {
        initial: "initialize",
        on: {
          TTS_READY: {
            target: ".ready",
          },
          ASR_READY: {
            target: ".ready",
          },
          TTS_ERROR: ".fail",
          ASR_NOINPUT_TIMEOUT: ".ready",
        },
        states: {
          initialize: {
            initial: "ponyfill",
            states: {
              fail: {},
              ponyfill: {},
              preReady: {},
            },
          },
          ready: {
            initial: "idle",
            states: {
              idle: {
                on: {
                  LISTEN: [{ target: "waitForRecogniser" }],
                  SPEAK: [
                    {
                      // actions: "logAgenda",
                      target: "speaking",
                    },
                  ],
                },
              },
              speaking: {
                entry: [
                  ({ context, event }) =>
                    context.ttsRef.send({
                      type: "START",
                      value: "hello", // (event as any).value,
                    }),
                ],
                on: { ENDSPEECH: "idle" },
              },
              waitForRecogniser: {
                entry: ({ context }) =>
                  context.asrRef.send({
                    type: "START",
                    value: {
                      noinputTimeout: context.tdmPassivity ?? 1000 * 3600 * 24,
                      completeTimeout:
                        context.tdmSpeechCompleteTimeout ||
                        context.parameters.completeTimeout,
                    },
                  }),
                on: {
                  ASR_STARTED: "recognising",
                },
              },
              recognising: {
                on: {
                  RECOGNISED: {
                    target: "idle",
                    // actions: "logRecResult",
                  },
                },
              },
            },
          },
          fail: {},
        },
      },
    },
  },
  {
    actors: {
      audioContext: fromPromise(() => {
        const audioContext = new ((window as any).AudioContext ||
          (window as any).webkitAudioContext)();
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(function (stream) {
            audioContext.createMediaStreamSource(stream);
          });
        return audioContext;
      }),
    },
    actions: {
      createAudioContext: ({ context }) => {
        const audioCtx = new ((window as any).AudioContext ||
          (window as any).webkitAudioContext)();
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(function (stream) {
            audioCtx.createMediaStreamSource(stream);
          });
      },
      logRecResult: ({ event }) => {
        console.log("U>", (event as any).value[0]["utterance"], {
          confidence: (event as any).value[0]["confidence"],
        });
      },
      logAgenda: ({ context, event }) => {
        console.log("S>", (event as any).value, {
          passivity: `${context.tdmPassivity ?? "∞"} ms`,
          speechCompleteTimeout: `${
            context.tdmSpeechCompleteTimeout ||
            context.parameters.completeTimeout
          } ms`,
        });
      },
    },
  }
);

export { machine };
