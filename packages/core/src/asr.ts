import { createMachine, actions, sendParent } from "xstate";
import { getAuthorizationToken } from "./getAuthorizationToken";

const { assign } = actions;

import createSpeechRecognitionPonyfill from "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";

const REGION = "northeurope";

export const asrMachine = createMachine(
  {
    id: "asr",
    predictableActionArguments: true,
    schema: {
      context: {} as ASRContext,
      events: {} as ASREvent,
    },
    initial: "getToken",
    on: {
      READY: {
        target: "ready",
        actions: [sendParent("ASR_READY")],
      },
    },
    states: {
      ready: {
        on: {
          START: {
            target: "recognising",
            actions: [
              "assignParameters",
              (c) => console.debug("ASR: recognition started", c),
            ],
          },
        },
      },
      fail: {},
      getToken: {
        invoke: {
          id: "getAuthorizationToken",
          src: (context) => getAuthorizationToken(), // TODO: add key from the context here
          onDone: {
            target: "ponyfill",
            actions: [
              assign((_context, event) => {
                return { azureAuthorizationToken: event.data };
              }),
            ],
          },
          onError: {
            target: "fail",
          },
        },
      },
      ponyfill: {
        invoke: {
          id: "ponyASR",
          src: (context: ASRContext) => (callback) => {
            const { SpeechGrammarList, SpeechRecognition } =
              createSpeechRecognitionPonyfill({
                audioContext: context.audioCtx,
                credentials: {
                  region: REGION,
                  authorizationToken: context.azureAuthorizationToken,
                },
              });
            context.asr = new SpeechRecognition();
            context.asr!.grammars = new SpeechGrammarList();
            callback("READY");
          },
        },
      },
      recognising: {
        initial: "wait",
        exit: "recStop",
        invoke: {
          id: "asrStart",
          src: (context, _event) => (callback, _onReceive) => {
            context.asr!.lang = context.language;
            context.asr!.continuous = true;
            context.asr!.interimResults = true;
            context.asr!.onstart = function (_event: any) {
              callback("STARTED");
            };
            context.asr!.onresult = function (event: any) {
              if (event.results[event.results.length - 1].isFinal) {
                const transcript = event.results
                  .map((x: SpeechRecognitionResult) =>
                    x[0].transcript.replace(/\.$/, "")
                  )
                  .join(" ");
                const confidence =
                  event.results
                    .map((x: SpeechRecognitionResult) => x[0].confidence)
                    .reduce((a: number, b: number) => a + b) /
                  event.results.length;
                callback({
                  type: "RESULT",
                  value: [
                    {
                      utterance: transcript,
                      confidence: confidence,
                    },
                  ],
                });
              } else {
                callback({ type: "STARTSPEECH" });
              }
            };
            context.asr!.start();
          },
        },
        states: {
          wait: {
            on: {
              STARTED: {
                target: "noinput",
                actions: sendParent("ASR_STARTED"),
              },
            },
          },
          noinput: {
            after: {
              NOINPUT: {
                target: "#asr.ready",
                actions: [
                  sendParent("ASR_NOINPUT_TIMEOUT"),
                  () => console.debug("ASR: noinput timeout"),
                ],
              },
            },
            on: {
              STARTSPEECH: {
                target: "inprogress",
                actions: () => console.debug("ASR: started talking"),
              },
            },
          },
          inprogress: {
            initial: "firstSegment",
            on: {
              RESULT: {
                target: ".nextSegment",
                actions: [
                  "assignResult",
                  (c) => console.debug(`ASR: result`, c.result),
                ],
              },
            },
            states: {
              firstSegment: {},
              nextSegment: {
                after: {
                  COMPLETE: {
                    target: "#asr.ready",
                    actions: [
                      sendParent((c) => ({
                        type: "RECOGNISED",
                        value: c.result,
                      })),
                      () => console.debug("ASR: speech complete"),
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    actions: {
      assignParameters: assign({
        noinputTimeout: (_c, e: any) => e.value.noinputTimeout,
        completeTimeout: (_c, e: any) => e.value.completeTimeout,
      }),
      assignResult: assign({
        result: (_c, e: any) => e.value,
      }),
      recStop: (context) => {
        context.asr!.abort?.();
      },
    },
    delays: {
      NOINPUT: (context) => {
        return context.noinputTimeout || 5000;
      },
      COMPLETE: (context) => {
        return context.completeTimeout || 0;
      },
    },
  }
);
