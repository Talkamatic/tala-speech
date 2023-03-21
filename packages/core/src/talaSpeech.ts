import { AnyStateMachine, createMachine, assign, spawn, send } from "xstate";
import { inspect } from "@xstate/inspect";
import { ttsMachine } from "./tts";
import { asrMachine } from "./asr";
import { tdmDmMachine } from "./tdmClient";

const machine = createMachine(
  {
    predictableActionArguments: true,
    schema: {
      context: {} as DomainContext,
      events: {} as SDSEvent,
    },
    id: "sds",
    type: "parallel",
    states: {
      dm: {
        ...tdmDmMachine,
      },
      asrTtsSpawner: {
        initial: "idle",
        states: {
          idle: { on: { PREPARE: "spawn" } },
          spawn: {
            entry: [
              "createAudioContext",
              assign({
                ttsRef: (c: DomainContext) => {
                  return spawn(
                    ttsMachine.withContext({
                      ttsVoice: c.parameters.ttsVoice,
                      audioCtx: c.audioCtx,
                      ttsLexicon: c.parameters.ttsLexicon,
                    })
                  );
                },
              }),
              assign({
                asrRef: (c) => {
                  return spawn(
                    asrMachine.withContext({
                      language: c.parameters.ttsVoice,
                      audioCtx: c.audioCtx,
                    })
                  );
                },
              }),
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
                      actions: "logAgenda",
                      target: "speaking",
                    },
                  ],
                },
              },
              speaking: {
                entry: (c, e: any) =>
                  c.ttsRef.send({
                    type: "START",
                    value: e.value,
                  }),
                on: { ENDSPEECH: "idle" },
              },
              waitForRecogniser: {
                entry: (c, _e: any) =>
                  c.asrRef.send({
                    type: "START",
                    value: {
                      noinputTimeout: c.tdmPassivity ?? 1000 * 3600 * 24,
                      completeTimeout:
                        c.tdmSpeechCompleteTimeout ||
                        c.parameters.completeTimeout,
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
                    actions: "logRecResult",
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
    actions: {
      createAudioContext: (context) => {
        context.audioCtx = new ((window as any).AudioContext ||
          (window as any).webkitAudioContext)();
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then(function (stream) {
            context.audioCtx.createMediaStreamSource(stream);
          });
      },
      logRecResult: (_c, e: any) => {
        console.log("U>", e.value[0]["utterance"], {
          confidence: e.value[0]["confidence"],
        });
      },
      logAgenda: (context, event: any) => {
        console.log("S>", event.value, {
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
