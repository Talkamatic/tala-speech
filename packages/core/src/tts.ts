import { createMachine, sendParent, assign } from "xstate";
import { getAuthorizationToken } from "./getAuthorizationToken";

import createSpeechSynthesisPonyfill from "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";

const REGION = "northeurope";

export const ttsMachine = createMachine(
  {
    id: "tts",
    predictableActionArguments: true,
    schema: {
      context: {} as TTSContext,
      events: {} as TTSEvent,
    },
    initial: "getToken",
    on: {
      READY: {
        target: "ready",
        actions: sendParent("TTS_READY"),
      },
      ERROR: "fail",
    },
    states: {
      ready: {
        on: { START: { target: "speaking", actions: "assignAgenda" } },
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
          id: "ponyTTS",
          src: (context, _event) => (callback, _onReceive) => {
            const ponyfill = createSpeechSynthesisPonyfill({
              audioContext: context.audioCtx,
              credentials: {
                region: REGION,
                authorizationToken: context.azureAuthorizationToken,
              },
            });
            const { speechSynthesis, SpeechSynthesisUtterance } = ponyfill;
            context.tts = speechSynthesis;
            context.ttsUtterance = SpeechSynthesisUtterance;
            context.tts!.addEventListener("voiceschanged", () => {
              context.tts!.cancel();
              const voices = context.tts!.getVoices();
              const voiceRe = RegExp(context.ttsVoice, "u");
              const voice = voices.find((v: any) => voiceRe.test(v.name))!;
              if (voice) {
                context.voice = voice;
                callback("READY");
              } else {
                console.error(
                  `TTS_ERROR: Could not get voice for regexp ${voiceRe}`
                );
                callback("ERROR");
              }
            });
          },
        },
      },
      speaking: {
        initial: "go",
        on: {
          END: {
            target: "ready",
          },
        },
        exit: sendParent("ENDSPEECH"),
        states: {
          go: {
            invoke: {
              id: "ttsStart",
              src: (context, _event) => (callback, _onReceive) => {
                let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${
                  context.voice!.name
                }">`;
                if (context.ttsLexicon) {
                  content = content + `<lexicon uri="${context.ttsLexicon}"/>`;
                }
                content = content + `${context.ttsAgenda}</voice></speak>`;
                if (context.ttsAgenda === ("" || " ")) {
                  content = "";
                }
                const utterance = new context.ttsUtterance!(content);
                utterance.voice = context.voice;
                utterance.onend = () => {
                  callback("END");
                };
                context.tts!.speak(utterance);
              },
            },
            on: {
              // SELECT: "#asrttsIdle",
              PAUSE: "paused",
            },
            exit: "ttsStop",
          },
          paused: {
            on: {
              CONTINUE: "go",
              //            SELECT: "#asrttsIdle",
            },
          },
        },
      },
    },
  },
  {
    actions: {
      assignAgenda: assign({
        ttsAgenda: (_c, e: any) => e.value,
      }),
      ttsStop: (context: TTSContext) => {
        context.tts!.cancel();
      },
    },
  }
);
