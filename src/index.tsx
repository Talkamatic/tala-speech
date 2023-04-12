import "./styles.scss";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Machine, assign, actions, State } from "xstate";
import { useMachine, asEffect } from "@xstate/react";
import { tdmDmMachine } from "./tdmClient";
import { inspect } from "@xstate/inspect";

import createSpeechRecognitionPonyfill from "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";
import createSpeechSynthesisPonyfill from "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";

let dm = tdmDmMachine;

const { send, cancel } = actions;

const TOKEN_ENDPOINT =
  "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issuetoken";
const REGION = "eastus";

const defaultPassivity = 5000;

if (process.env.NODE_ENV === "development") {
  inspect({
    iframe: false,
  });
}

const machine = Machine<SDSContext, any, SDSEvent>({
  id: "root",
  type: "parallel",
  invoke: {
    src: "getListeners",
  },
  states: {
    dm: {
      ...dm,
    },
    gui: {
      initial: "micOnly",
      on: { STOP: ".micOnly" },
      states: {
        micOnly: {
          on: { SHOW_ALTERNATIVES: "showAlternatives" },
        },
        showAlternatives: {
          on: { SELECT: "micOnly" },
        },
      },
    },
    azureAuthentification: {
      initial: "start",
      states: {
        fail: {},
        start: { on: { GET_TOKEN: "getNewToken" } },
        getNewToken: {
          after: {
            300000: {
              target: "getNewToken",
            },
          },
          invoke: {
            id: "getAuthorizationToken",
            src: (context, _evt) => getAuthorizationToken(context),
            onDone: {
              actions: [
                assign((_context, event) => {
                  return { azureAuthorizationToken: event.data };
                }),
                send("NEW_TOKEN"),
                "ponyfillASR",
                "ponyfillTTS",
              ],
            },
            onError: {
              target: "fail",
            },
          },
        },
      },
    },
    asrtts: {
      initial: "initialize",
      on: { STOP: ".stopped" },
      states: {
        stopped: {
          entry: "closeAudioContext",
          on: { CLICK: "initialize" },
        },
        initialize: {
          initial: "start",
          on: {
            TTS_READY: "ready",
            TTS_ERROR: ".fail",
          },
          states: {
            fail: {},
            start: {
              always: [
                {
                  target: "waitForToken",
                  actions: send("GET_TOKEN"),
                  cond: (context) => context.azureAuthorizationToken == null,
                },
                { target: "await" },
              ],
            },
            waitForToken: {
              on: { NEW_TOKEN: "await" },
            },
            await: {
              on: {
                CLICK: {
                  target: "await2",
                  actions: ["createAudioContext", "ponyfillASR", "ponyfillTTS"],
                },
              },
            },
            await2: {},
          },
        },
        ready: {
          initial: "idle",
          states: {
            idle: {
              id: "asrttsIdle",
              on: {
                LISTEN: [{ target: "waitForRecogniser" }],
                SPEAK: [
                  {
                    target: "recognising.pause",
                    cond: "emptyUtteranceAndPassivityNull",
                  },
                  {
                    target: "speaking",
                    actions: assign((_context, event) => {
                      return { ttsAgenda: event.value };
                    }),
                  },
                ],
              },
            },
            waitForRecogniser: {
              entry: "recStart",
              on: {
                ASR_START: "recognising",
              },
            },
            recognising: {
              initial: "noinput",
              exit: "recStop",
              on: {
                ASRRESULT: {
                  actions: [
                    assign((_context, event) => {
                      return {
                        recResult: event.value,
                      };
                    }),
                    cancel("completeTimeout"),
                  ],
                  target: ".match",
                },
                RECOGNISED: { target: "idle", actions: "recLogResult" },
                SELECT: "idle",
                CLICK: ".pause",
                PAUSE: ".pause",
                TIMEOUT: "#root.asrtts.ready.idle",
                STARTSPEECH: {
                  target: ".inprogress",
                  actions: cancel("completeTimeout"),
                },
              },
              states: {
                noinput: {
                  entry: [
                    send(
                      { type: "TIMEOUT" },
                      {
                        delay: (context) =>
                          context.tdmPassivity ?? 1000 * 3600 * 24,
                        id: "timeout",
                      }
                    ),
                  ],
                  on: {},
                  exit: cancel("timeout"),
                },
                inprogress: {},
                match: {
                  entry: send(
                    { type: "RECOGNISED" },
                    {
                      delay: (context) =>
                        context.tdmSpeechCompleteTimeout ||
                        context.parameters.completeTimeout,
                      id: "completeTimeout",
                    }
                  ),
                },
                final: {
                  entry: send("RECOGNISED"),
                },
                pause: {
                  entry: "recStop",
                  on: {
                    CLICK: {
                      target: "#root.asrtts.ready.waitForRecogniser",
                      actions: assign((_context, _event) => {
                        return {
                          tdmPassivity: defaultPassivity,
                        };
                      }),
                    },
                  },
                },
              },
            },
            speaking: {
              initial: "go",
              entry: "recStop",
              states: {
                go: {
                  entry: "ttsStart",
                  on: {
                    PAUSE: { target: "paused" },
                    TTS_END: {
                      target: "#asrttsIdle",
                      actions: send("ENDSPEECH"),
                    },
                    SELECT: "#asrttsIdle",
                    CLICK: [
                      {
                        target: "#asrttsIdle",
                        actions: send("ENDSPEECH"),
                        cond: (context) => context.parameters.clickToSkip,
                      },
                      { target: "paused" },
                    ],
                  },
                  exit: "ttsStop",
                },
                paused: {
                  on: {
                    CLICK: "#root.asrtts.ready.speaking.go",
                    SELECT: "#asrttsIdle",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

interface Props extends React.HTMLAttributes<HTMLElement> {
  state: State<SDSContext, any, any, any>;
  alternative: any;
}
const ReactiveButton = (props: Props): JSX.Element => {
  var promptText = (
    (props.state.context.tdmVisualOutputInfo || [{}]).find(
      (el: any) => el.attribute === "name"
    ) || {}
  ).value;
  var promptImage = (
    (props.state.context.tdmVisualOutputInfo || [{}]).find(
      (el: any) => el.attribute === "image"
    ) || {}
  ).value;
  var circleClass = "circle";
  switch (true) {
    case props.state.matches({ asrtts: "fail" }) ||
      props.state.matches({ dm: "fail" }):
      break;
    case props.state.matches({ asrtts: { ready: { recognising: "pause" } } }) ||
      props.state.matches({ asrtts: { ready: { speaking: "paused" } } }):
      promptText = props.state.context.parameters.i18nClickToContinue;
      break;
    case props.state.matches({ asrtts: { ready: "recognising" } }):
      circleClass = "circle-recognising";
      promptText = promptText || props.state.context.parameters.i18nListening;
      break;
    case props.state.matches({ asrtts: { ready: { speaking: "go" } } }):
      circleClass = "circle-speaking";
      promptText = promptText || props.state.context.parameters.i18nSpeaking;
      break;
    case props.state.matches({ dm: "idle" }) ||
      props.state.matches({ dm: "end" }):
      promptText = props.state.context.parameters.i18nClickToStart;
      circleClass = "circle-click";
      break;
    default:
      circleClass = "circle-click";
      promptText = promptText || "\u00A0";
  }
  return (
    <div className="control">
      <figure className="prompt">
        {promptImage && <img src={promptImage} alt={promptText} />}
      </figure>
      <div className="status" {...props}>
        <button type="button" className={circleClass} style={{}}></button>
        <div className="status-text">{promptText}</div>
      </div>
    </div>
  );
};

const FigureButton = (props: Props): JSX.Element => {
  const caption = props.alternative.find(
    (el: any) => el.attribute === "name"
  ).value;
  const imageSrc = (
    props.alternative.find((el: any) => el.attribute === "image") || {}
  ).value;
  return (
    <figure className="flex" {...props}>
      {imageSrc && <img src={imageSrc} alt={caption} />}
      <figcaption>{caption}</figcaption>
    </figure>
  );
};

function App({ domElement }: any) {
  const tdmContext = {
    segment: { pageNumber: 0, dddName: "cover" },
    azureAuthorizationToken: domElement.getAttribute(
      "data-azure-authorization-token"
    ),
    parameters: {
      deviceID:
        domElement.getAttribute("data-device-id") || "tala-speech-default",
      endpoint: domElement.getAttribute("data-tdm-endpoint"),
      ttsVoice: domElement.getAttribute("data-tts-voice") || "en-US",
      ttsLexicon: domElement.getAttribute("data-tts-lexicon"),
      speechRate: domElement.getAttribute("data-speech-rate") || "1",
      asrLanguage: domElement.getAttribute("data-asr-language") || "en-US",
      azureKey: domElement.getAttribute("data-azure-key"),
      azureProxyURL: domElement.getAttribute("data-azure-proxy-url"),
      completeTimeout:
        Number(domElement.getAttribute("data-complete-timeout")) || 0,
      clickToSkip:
        Boolean(domElement.getAttribute("data-click-to-skip")) || false,
      i18nClickToStart:
        domElement.getAttribute("data-i18n-click-to-start") ||
        "Click to start!",
      i18nListening:
        domElement.getAttribute("data-i18n-listening") || "Listening...",
      i18nSpeaking:
        domElement.getAttribute("data-i18n-speaking") || "Speaking...",
      i18nClickToContinue:
        domElement.getAttribute("data-i18n-click-to-continue") ||
        "Click to continue",
    },
  };

  const [current, send, service] = useMachine(
    machine.withContext({ ...machine.context, ...tdmContext }),
    {
      devTools: process.env.NODE_ENV === "development" ? true : false,

      guards: {
        emptyUtteranceAndPassivityNull: (context, event) => {
          if ("value" in event) {
            return event.value === "" && context.tdmPassivity === null;
          }
          return false;
        },
      },
      services: {
        getListeners: () => (send) => {
          const clickListener = () => send("CLICK");
          const pauseListener = () => send("PAUSE");
          const stopListener = () => send("STOP");
          const turnPageListener = (e: any) => {
            send({ type: "TURNPAGE", value: e.detail });
          };
          window.addEventListener("talaClick", clickListener);
          window.addEventListener("talaPause", pauseListener);
          window.addEventListener("talaStop", stopListener);
          window.addEventListener("turnpage", turnPageListener);
          return () => {
            window.removeEventListener("talaClick", clickListener);
            window.removeEventListener("talaPause", pauseListener);
            window.removeEventListener("talaStop", stopListener);
            window.removeEventListener("turnpage", turnPageListener);
          };
        },
      },
      actions: {
        createAudioContext: (context: SDSContext) => {
          context.audioCtx = new ((window as any).AudioContext ||
            (window as any).webkitAudioContext)();
          navigator.mediaDevices
            .getUserMedia({ audio: true })
            .then(function (stream) {
              context.audioCtx.createMediaStreamSource(stream);
            });
        },
        closeAudioContext: (context: SDSContext) => {
          if (context.audioCtx && context.audioCtx.state !== "closed") {
            context.audioCtx.close();
          }
        },
        setAvailableDDDs: asEffect((context) => {
          const event = new CustomEvent<any>("setAvailableDDDs", {
            detail: context.tdmAvailableDDDs,
          });
          window.dispatchEvent(event);
        }),
        recLogResult: (context: SDSContext) => {
          console.log("U>", context.recResult[0]["utterance"], {
            confidence: context.recResult[0]["confidence"],
          });
        },
        recStart: asEffect((context) => {
          (context.asr.grammars as any).phrases = context.tdmAsrHints;
          context.asr.start();
          /* console.log('Ready to receive a voice input.'); */
        }),
        recStop: asEffect((context) => {
          context.asr.abort?.();
          /* console.log('Recognition stopped.'); */
        }),
        ttsStart: asEffect((context) => {
          let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${context.voice.name}">`;
          if (context.parameters.ttsLexicon) {
            content =
              content + `<lexicon uri="${context.parameters.ttsLexicon}"/>`;
          }
          content =
            content + `<prosody rate="${context.parameters.speechRate}">`;
          content = content + `${context.ttsAgenda}</prosody></voice></speak>`;
          if (context.ttsAgenda === ("" || " ")) {
            content = "";
          }
          const utterance = new context.ttsUtterance(content);
          console.log("S>", context.ttsAgenda, {
            passivity: `${context.tdmPassivity ?? "∞"} ms`,
            speechCompleteTimeout: `${
              context.tdmSpeechCompleteTimeout ||
              context.parameters.completeTimeout
            } ms`,
          });
          utterance.voice = context.voice;
          utterance.onend = () => send("TTS_END");
          context.tts.speak(utterance);
        }),
        ttsStop: asEffect((context) => {
          /* console.log('TTS STOP...'); */
          context.tts.cancel();
        }),
        ponyfillTTS: asEffect((context, _event) => {
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
          context.tts.addEventListener("voiceschanged", () => {
            context.tts.cancel();
            const voices = context.tts.getVoices();
            const voiceRe = RegExp(context.parameters.ttsVoice, "u");
            const voice = voices.find((v: any) => voiceRe.test(v.name))!;
            if (voice) {
              context.voice = voice;
              send("TTS_READY");
            } else {
              console.error(
                `TTS_ERROR: Could not get voice for regexp ${voiceRe}`
              );
              send("TTS_ERROR");
            }
          });
        }),
        ponyfillASR: asEffect((context, _event) => {
          const { SpeechGrammarList, SpeechRecognition } =
            createSpeechRecognitionPonyfill({
              audioContext: context.audioCtx,
              credentials: {
                region: REGION,
                authorizationToken: context.azureAuthorizationToken,
              },
            });
          context.asr = new SpeechRecognition();
          context.asr.grammars = new SpeechGrammarList();
          context.asr.lang = context.parameters.asrLanguage;
          context.asr.continuous = true;
          context.asr.interimResults = true;
          context.asr.onstart = function (_event: any) {
            send("ASR_START");
          };
          context.asr.onresult = function (event: any) {
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
              send({
                type: "ASRRESULT",
                value: [
                  {
                    utterance: transcript,
                    confidence: confidence,
                  },
                ],
              });
            } else {
              send({ type: "STARTSPEECH" });
            }
          };
        }),
      },
    }
  );

  React.useEffect(() => {
    const subscription = service.subscribe((state) => {
      // simple state logging
      const event = new CustomEvent<any>("talaSpeechState", { detail: state });
      window.dispatchEvent(event);
    });

    return subscription.unsubscribe;
  }, [service]);

  const figureButtons = (current.context.tdmExpectedAlternatives || [])
    .filter((o: any) => o.visual_information)
    .map((o: any, i: any) => (
      <FigureButton
        state={current}
        alternative={o.visual_information}
        key={i}
        onClick={() => send({ type: "SELECT", value: o })}
      />
    ));

  switch (true) {
    default:
      return (
        <div
          className="App"
          id="App"
          style={{
            backgroundSize: `auto 100%`,
            backgroundRepeat: "no-repeat",
          }}
        >
          <ReactiveButton
            state={current}
            alternative={{}}
            onClick={() => send("CLICK")}
          />
          <div className="select-wrapper">
            <div className="select">{figureButtons}</div>
          </div>
        </div>
      );
  }
}

const getAuthorizationToken = (context: SDSContext) => {
  if (context.parameters.azureProxyURL) {
    return fetch(new Request(context.parameters.azureProxyURL)).then((data) =>
      data.text()
    );
  }
  return fetch(
    new Request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": context.parameters.azureKey!,
      },
    })
  ).then((data) => data.text());
};

const rootElement: HTMLElement = document.getElementById("tala-speech")!;
ReactDOM.render(<App domElement={rootElement} />, rootElement);

const killListener = () => {
  dispatchEvent(new CustomEvent("talaStop"));
  ReactDOM.unmountComponentAtNode(rootElement);
};
window.addEventListener("talaKill", killListener);
