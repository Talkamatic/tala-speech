import "./styles.scss";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Machine, assign, actions, State } from "xstate";
import { useMachine, asEffect } from "@xstate/react";
import { tdmDmMachine } from "./tdmClient";
import { inspect } from "@xstate/inspect";

import createSpeechRecognitionPonyfill from 'web-speech-cognitive-services/lib/SpeechServices/SpeechToText'
import createSpeechSynthesisPonyfill from 'web-speech-cognitive-services/lib/SpeechServices/TextToSpeech';

let dm = tdmDmMachine

const { send, cancel } = actions

const TOKEN_ENDPOINT = 'https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken';
const REGION = 'northeurope';

const defaultPassivity = 5


if (process.env.NODE_ENV === 'development') {
    inspect({
        url: "https://statecharts.io/inspect",
        iframe: false
    });
}


const machine = Machine<SDSContext, any, SDSEvent>({
    id: 'root',
    type: 'parallel',
    invoke: {
        src: 'checkForPage',
    },
    states: {
        dm: {
            ...dm
        },
        gui: {
            initial: 'micOnly',
            states: {
                micOnly: {
                    on: { SHOW_ALTERNATIVES: 'showAlternatives' },
                },
                showAlternatives: {
                    on: { SELECT: 'micOnly' },
                },
            },
        },
        asrtts: {
            initial: 'initialize',
            states: {
                initialize: {
                    initial: 'await',
                    on: {
                        TTS_READY: 'ready',
                        TTS_ERROR: '.fail'
                    },
                    states: {
                        fail: {},
                        await: {
                            on: {
                                CLICK: {
                                    target: 'getToken',
                                    actions: [
                                        assign({
                                            audioCtx: (_ctx) =>
                                                new ((window as any).AudioContext || (window as any).webkitAudioContext)()
                                        }),
                                        (context) =>
                                            navigator.mediaDevices.getUserMedia({ audio: true })
                                                .then(function(stream) { context.audioCtx.createMediaStreamSource(stream) })
                                    ]
                                }
                            }
                        },
                        getToken: {
                            invoke: {
                                id: "getAuthorizationToken",
                                src: (context, _evt) => getAuthorizationToken(context.parameters.azureKey),
                                onDone: {
                                    actions: [
                                        assign((_context, event) => { return { azureAuthorizationToken: event.data } }),
                                        'ponyfillASR'],
                                    target: 'ponyfillTTS'
                                },
                                onError: {
                                    target: 'fail'
                                }
                            }
                        },
                        ponyfillTTS: {
                            invoke: {
                                id: 'ponyTTS',
                                src: (context, _event) => (callback, _onReceive) => {
                                    const ponyfill = createSpeechSynthesisPonyfill({
                                        audioContext: context.audioCtx,
                                        credentials: {
                                            region: REGION,
                                            authorizationToken: context.azureAuthorizationToken,
                                        }
                                    });
                                    const { speechSynthesis, SpeechSynthesisUtterance } = ponyfill;
                                    context.tts = speechSynthesis
                                    context.ttsUtterance = SpeechSynthesisUtterance
                                    context.tts.addEventListener('voiceschanged', () => {
                                        context.tts.cancel()
                                        const voices = context.tts.getVoices();
                                        const voiceRe = RegExp(context.parameters.ttsVoice, 'u')
                                        const voice = voices.find((v: any) => voiceRe.test(v.name))!
                                        if (voice) {
                                            context.voice = voice
                                            callback('TTS_READY')
                                        } else {
                                            console.error(`TTS_ERROR: Could not get voice for regexp ${voiceRe}`)
                                            callback('TTS_ERROR')
                                        }
                                    })
                                }
                            },
                        }
                    },
                },
                ready: {
                    initial: 'idle',
                    states: {
                        idle: {
                            on: {
                                LISTEN: 'recognising',
                                SPEAK: {
                                    target: 'speaking',
                                    actions: assign((_context, event) => { return { ttsAgenda: event.value } })
                                }
                            },
                        },
                        recognising: {
                            initial: 'noinput',
                            exit: 'recStop',
                            on: {
                                ASRRESULT: {
                                    actions: [
                                        assign((_context, event) => {
                                            return {
                                                recResult: event.value
                                            }
                                        }),
                                        cancel('completeTimeout')],
                                    target: '.match'
                                },
                                RECOGNISED: { target: 'idle', actions: 'recLogResult' },
                                SELECT: 'idle',
                                CLICK: '.pause',
                                TIMEOUT: '#root.asrtts.ready.idle',
                                STARTSPEECH: { target: '.inprogress', actions: cancel('completeTimeout') }
                            },
                            states: {
                                noinput: {
                                    entry: [
                                        'recStart',
                                        send(
                                            { type: 'TIMEOUT' },
                                            {
                                                delay: (context) => (1000 * (context.tdmPassivity ?? defaultPassivity)),
                                                id: 'timeout'
                                            }
                                        )],
                                    on: {
                                    },
                                    exit: cancel('timeout')
                                },
                                inprogress: {
                                },
                                match: {
                                    entry: send(
                                        { type: 'RECOGNISED' },
                                        {
                                            delay: (context) => context.parameters.completeTimeout,
                                            id: 'completeTimeout'
                                        })
                                },
                                final: {
                                    entry: send('RECOGNISED'),
                                },
                                pause: {
                                    entry: 'recStop',
                                    on: { CLICK: 'noinput' }
                                }
                            }
                        },
                        speaking: {
                            entry: ['recStop', 'ttsStart'],
                            on: {
                                ENDSPEECH: 'idle',
                                SELECT: 'idle',
                                CLICK: { target: 'idle', actions: send('ENDSPEECH') }
                            },
                            exit: 'ttsStop',
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
    var promptText = ((props.state.context.tdmVisualOutputInfo || [{}])
        .find((el: any) => el.attribute === "name") || {}).value;
    var promptImage = ((props.state.context.tdmVisualOutputInfo || [{}])
        .find((el: any) => el.attribute === "image") || {}).value;
    var circleClass = "circle"
    switch (true) {
        case props.state.matches({ asrtts: 'fail' }) || props.state.matches({ dm: 'fail' }):
            break;
        case props.state.matches({ asrtts: { ready: { recognising: 'pause' } } }):
            promptText = "Click to continue"
            break;
        case props.state.matches({ asrtts: { ready: 'recognising' } }):
            circleClass = "circle-recognising"
            promptText = promptText || 'Listening...'
            break;
        case props.state.matches({ asrtts: { ready: 'speaking' } }):
            circleClass = "circle-speaking"
            promptText = promptText || 'Speaking...'
            break;
        case props.state.matches({ dm: 'idle' }):
            promptText = "Click to start!"
            circleClass = "circle-click"
            break;
        case props.state.matches({ dm: 'init' }):
            promptText = "Click to start!"
            circleClass = "circle-click"
            break;
        default:
            circleClass = "circle-click"
            promptText = promptText || '\u00A0'
    }
    return (
        <div className="control">
            <figure className="prompt">
                {promptImage &&
                    <img src={promptImage}
                        alt={promptText} />}
            </figure>
            <div className="status"  {...props}>
                <button type="button" className={circleClass}
                    style={{}}>
                </button>
                <div className="status-text">
                    {promptText}
                </div>
            </div>
        </div>);
}

const FigureButton = (props: Props): JSX.Element => {
    const caption = props.alternative.find((el: any) => el.attribute === "name").value
    const imageSrc = (props.alternative.find((el: any) => el.attribute === "image") || {}).value
    return (
        <figure className="flex" {...props}>
            {imageSrc &&
                <img src={imageSrc} alt={caption} />}
            <figcaption>{caption}</figcaption>
        </figure>
    )
}

function App({ domElement }: any) {
    const tdmContext = {
        segment: { pageNumber: 0, dddName: "cover" },
        parameters: {
            endpoint: domElement.getAttribute("data-tdm-endpoint"),
            ttsVoice: domElement.getAttribute("data-tts-voice") || "en-US",
            ttsLexicon: domElement.getAttribute("data-tts-lexicon"),
            asrLanguage: domElement.getAttribute("data-asr-language") || "en-US",
            azureKey: domElement.getAttribute("data-azure-key"),
            completeTimeout: Number(domElement.getAttribute("data-complete-timeout")) || 0,
        }
    }

    const [current, send] = useMachine(machine.withContext({ ...machine.context, ...tdmContext }), {
        devTools: process.env.NODE_ENV === 'development' ? true : false,
        services: {
            checkForPage: () => (send) => {
                const listener = (e: any) => {
                    send({ type: 'TURNPAGE', value: e.detail });
                };

                window.addEventListener('turnpage', listener);

                return () => {
                    window.removeEventListener('turnpage', listener);
                };
            },
        },
        actions: {
            setAvailableDDDs: asEffect((context) => {
                const event = new CustomEvent<any>('setAvailableDDDs', { detail: context.tdmAvailableDDDs });
                window.dispatchEvent(event);
            }),
            recLogResult: (context: SDSContext) => {
                console.log('U>', context.recResult[0]["utterance"],
                    { "confidence": context.recResult[0]["confidence"] });
            },
            recStart: asEffect((context) => {
                context.asr.start()
                /* console.log('Ready to receive a voice input.'); */
            }),
            recStop: asEffect((context) => {
                context.asr.abort?.()
                /* console.log('Recognition stopped.'); */
            }),
            ttsStart: asEffect((context) => {
                let content = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${context.voice.name}">`
                if (context.parameters.ttsLexicon) {
                    content = content + `<lexicon uri="${context.parameters.ttsLexicon}"/>`
                }
                content = content + `${context.ttsAgenda}</voice></speak>`
                if (context.ttsAgenda === ("" || " ")) { content = "" };
                console.debug(content)
                const utterance = new context.ttsUtterance(content);
                console.log("S>", context.ttsAgenda, { "passivity": context.tdmPassivity })
                utterance.voice = context.voice
                utterance.onend = () => send('ENDSPEECH')
                context.tts.speak(utterance)
            }),
            ttsStop: asEffect((context) => {
                /* console.log('TTS STOP...'); */
                context.tts.cancel()
            }),
            ponyfillASR: asEffect((context, _event) => {
                const
                    { SpeechRecognition }
                        = createSpeechRecognitionPonyfill({
                            audioContext: context.audioCtx,
                            credentials: {
                                region: REGION,
                                authorizationToken: context.azureAuthorizationToken,
                            }
                        });
                context.asr = new SpeechRecognition()
                context.asr.lang = context.parameters.asrLanguage
                context.asr.continuous = true
                context.asr.interimResults = true
                context.asr.onresult = function(event: any) {
                    if (event.results[event.results.length - 1].isFinal) {
                        const transcript = event.results.map((x: SpeechRecognitionResult) =>
                            x[0].transcript.replace(/\.$/, '')).join(" ")
                        const confidence = event.results.map((x: SpeechRecognitionResult) =>
                            x[0].confidence).reduce((a: number, b: number) => a + b) / event.results.length
                        send({
                            type: "ASRRESULT", value:
                                [{
                                    "utterance": transcript,
                                    "confidence": confidence
                                }]
                        })
                    } else {
                        send({ type: "STARTSPEECH" })
                    }
                }
            })
        }
    });
    const figureButtons = (current.context.tdmExpectedAlternatives || []).filter((o: any) => o.visual_information)
        .map(
            (o: any, i: any) => (
                <FigureButton state={current}
                    alternative={o.visual_information}
                    key={i}
                    onClick={() => send({ type: 'SELECT', value: o })} />
            )
        )

    switch (true) {
        default:
            return (
                <div className="App" id="App" style={{
                    backgroundSize: `auto 100%`,
                    backgroundRepeat: 'no-repeat'
                }}>
                    <ReactiveButton state={current} alternative={{}}
                        onClick={() => send('CLICK')} />
                    <div className="select-wrapper">
                        <div className="select">
                            {figureButtons}
                        </div>
                    </div>
                </div>
            )
    }

};

const getAuthorizationToken = (azureKey: string) => (
    fetch(new Request(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': azureKey
        },
    })).then(data => data.text()))


const rootElement = document.getElementById("tala-speech");
ReactDOM.render(
    <App domElement={rootElement} />,
    rootElement);
