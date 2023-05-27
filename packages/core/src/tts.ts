import {
  createMachine,
  sendParent,
  assign,
  fromPromise,
  fromCallback,
} from "xstate";

import createSpeechSynthesisPonyfill from "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";

const REGION = "northeurope";

export const ttsMachine = createMachine(
  {
    id: "tts",
    types: {
      context: {} as TTSContext,
      events: {} as TTSEvent,
    },
    context: ({ input }) => ({
      ttsVoice: input.ttsVoice,
      audioCtx: input.audioCtx,
      ttsLexicon: input.ttsLexicon,
    }),

    initial: "getToken",
    on: {
      READY: {
        target: ".ready",
        actions: [
          assign({
            tts: ({ event }) => event.value.tts,
            ttsUtterance: ({ event }) => event.value.utt,
            voice: ({ event }) => event.value.voice,
          }),
          ({ context }) => console.log(context),
          sendParent({ type: "TTS_READY" }),
        ],
      },
      ERROR: ".fail",
    },
    states: {
      ready: {
        on: { START: { target: "speaking", actions: "assignAgenda" } },
      },
      fail: {},
      getToken: {
        invoke: {
          id: "getAuthorizationToken",
          src: fromPromise(() =>
            fetch(new Request("https://tala.pratb.art/gettoken.php")).then(
              (data) => data.text()
            )
          ),
          onDone: {
            target: "ponyfill",
            actions: [
              assign(({ event }) => {
                return { azureAuthorizationToken: event.output };
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
          src: "ponyfill",
          input: ({ context }) => ({
            audioCtx: context.audioCtx,
            azureAuthorizationToken: context.azureAuthorizationToken,
            voice: context.ttsVoice,
          }),
        },
      },
      speaking: {
        initial: "go",
        on: {
          END: {
            target: "ready",
          },
        },
        exit: sendParent({ type: "ENDSPEECH" }),
        states: {
          go: {
            invoke: {
              input: ({ context, event }) => ({
                tts: context.tts,
                ttsUtterance: context.ttsUtterance,
                ttsLexicon: context.ttsLexicon,
                voice: context.voice,
                ttsAgenda: event.value,
              }),
              src: "speak",
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
        ttsAgenda: ({ event }) => (event as any).value,
      }),
      ttsStop: ({ context }) => {
        context.tts!.cancel();
      },
    },
    actors: {
      ponyfill: fromCallback((sendBack, _receive, { input }) => {
        const ponyfill = createSpeechSynthesisPonyfill({
          audioContext: input.audioCtx,
          credentials: {
            region: REGION,
            authorizationToken: input.azureAuthorizationToken,
          },
        });
        const { speechSynthesis, SpeechSynthesisUtterance } = ponyfill;
        const tts = speechSynthesis;
        const ttsUtterance = SpeechSynthesisUtterance;
        tts.addEventListener("voiceschanged", () => {
          tts.cancel();
          const voices = tts.getVoices();
          const voiceRe = RegExp(input.ttsVoice, "u");
          const voice = voices.find((v: any) => voiceRe.test(v.name))!;
          if (voice) {
            sendBack({
              type: "READY",
              value: { tts: tts, utt: ttsUtterance, voice: voice },
            });
            console.debug("TTS> ponyfill ready");
          } else {
            console.error(
              `TTS_ERROR: Could not get voice for regexp ${voiceRe}`
            );
            sendBack({ type: "ERROR" });
          }
        });
      }),
      speak: fromCallback((sendBack, _receive, { input }) => {
        console.log(input);
        let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${input.voice}">`;
        if (input.ttsLexicon) {
          content = content + `<lexicon uri="${input.ttsLexicon}"/>`;
        }
        content = content + `${input.ttsAgenda}</voice></speak>`;
        if (input.ttsAgenda === ("" || " ")) {
          content = "";
        }
        const utterance = new input.ttsUtterance!(content);
        utterance.voice = input.voice;
        utterance.onend = () => {
          sendBack({ type: "END" });
        };
        input.tts!.speak(utterance);
      }),
    },
  }
);
