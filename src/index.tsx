import "./styles.scss";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Machine, assign, actions, State } from "xstate";
import { useMachine, asEffect } from "@xstate/react";
import { tdmDmMachine } from "./tdmClient";
import { inspect } from "@xstate/inspect";

import createSpeechRecognitionPonyfill from 'web-speech-cognitive-services/lib/SpeechServices/SpeechToText'
import createSpeechSynthesisPonyfill from 'web-speech-cognitive-services/lib/SpeechServices/TextToSpeech';

import Config from './config.json'

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
                                src: (_ctx, _evt) => getAuthorizationToken(),
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
                                        let voiceRe = RegExp("en-US", 'u')
                                        if (Config.TTS_VOICE) {
                                            voiceRe = RegExp(Config.TTS_VOICE, 'u')
                                        }
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
                                    actions: ['recLogResult',
                                        assign((_context, event) => {
                                            return {
                                                recResult: event.value
                                            }
                                        })],
                                    target: '.match'
                                },
                                RECOGNISED: 'idle',
                                SELECT: 'idle',
                                CLICK: '.pause',
                                TIMEOUT: '#root.asrtts.ready.idle'
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
                                        STARTSPEECH: 'inprogress'
                                    },
                                    exit: cancel('timeout')
                                },
                                inprogress: {
                                },
                                match: {
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

const tdmContext = { segment: { pageNumber: 0, dddName: "cover" } }
function App() {
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
                if ((Config as any).TTS_LEXICON) {
                    content = content + `<lexicon uri="${(Config as any).TTS_LEXICON}"/>`
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
                context.asr.lang = Config.ASR_LANGUAGE || 'en-US'
                context.asr.continuous = true
                context.asr.interimResults = true
                context.fakeInterim = []
                context.asr.onresult = function(event: any) {
                    var result = event.results[0]
                    if (result.isFinal) {
                        context.fakeInterim = context.fakeInterim.concat(event.results[0][0])
                        console.log(context.fakeInterim)
                        if (result[0].transcript.endsWith('och')) {
                            context.asr.start()
                        } else {
                            const res = context.fakeInterim.reduce((
                                prev: SpeechRecognitionAlternative,
                                curr: SpeechRecognitionAlternative) => ({
                                    transcript: prev.transcript + " " + curr.transcript,
                                    confidence: (prev.confidence + curr.confidence) / 2  // (not real average)
                                }))
                            send({
                                type: "ASRRESULT", value:
                                    [{
                                        "utterance": res.transcript.replace(/\.$/, ''),
                                        "confidence": res.confidence
                                    }]
                            })
                        }
                    } else {
                        send({ type: "STARTSPEECH" });
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
                    onClick={() => send({ type: 'SELECT', value: o.semantic_expression })} />
            )
        )

    switch (true) {
        default:
            return (
                <div className="App" style={{
                    backgroundImage: `url(${(Config as any).BACKGROUND || ''})`,
                    backgroundSize: `auto 100%`
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

const getAuthorizationToken = () => (
    fetch(new Request(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': Config.AZURE_KEY!
        },
    })).then(data => data.text()))


const rootElement = document.getElementById("root");
ReactDOM.render(
    <App />,
    rootElement);
