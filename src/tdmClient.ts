import { MachineConfig, actions, AssignAction } from "xstate";
import Config from './config.json'

const { send, assign, choose } = actions;


const tdmEndpoint = Config.TDM_ENDPOINT || "https://sourdough-for-dummies-orchestration-pipeline.eu2.ddd.tala.cloud/interact"

const startSession = {
    "version": "3.3",
    "session": { "device_id": "tala-speech" },
    "request": {
        "start_session": {}
    }
}

const passivity = (sessionObject: any) => ({
    "version": "3.3",
    "session": sessionObject,
    "request": {
        "passivity": {}
    }
})

const nlInput = (sessionObject: any, hypotheses: Hypothesis[]) => ({
    "version": "3.3",
    "session": sessionObject,
    "request": {
        "natural_language_input": {
            "modality": "speech",
            "hypotheses": hypotheses
        }
    }
})

const hapticInput = (sessionObject: any, expression: string) => ({
    "version": "3.3",
    "session": sessionObject,
    "request": {
        "semantic_input": {
            "interpretations": [{
                "modality": "haptic",
                "moves": [{
                    "perception_confidence": 1,
                    "understanding_confidence": 1,
                    "semantic_expression": expression
                }]
            }]
        }
    }
})

const tdmRequest = (requestBody: any) => (fetch(new Request(tdmEndpoint, {
    method: 'POST',
    headers: {
        'Content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
})).then(data => data.json()))

const tdmAssign: AssignAction<SDSContext, any> = assign({
    sessionObject: (_ctx, event) => event.data.session,
    tdmAll: (_ctx, event) => event.data,
    tdmUtterance: (_ctx, event) => event.data.output.utterance,
    tdmVisualOutputInfo: (_ctx, event) => (event.data.output.visual_output || [{}])[0].visual_information,
    tdmExpectedAlternatives: (_ctx, event) => (event.data.context.expected_input || {}).alternatives,
    tdmPassivity: (_ctx, event) => event.data.output.expected_passivity,
    tdmActions: (_ctx, event) => event.data.output.actions,
})


const maybeAlternatives = choose<SDSContext, SDSEvent>([
    {
        cond: (context) => { return (context.tdmExpectedAlternatives || [{}])[0].visual_information },
        actions: [send({ type: "SHOW_ALTERNATIVES" })]
    },
])

export const tdmDmMachine: MachineConfig<SDSContext, any, SDSEvent> = ({
    initial: 'idle',
    states: {
        idle: {
            on: {
                CLICK: 'init',
            }
        },
        init: {
            on: {
                TTS_READY: 'tdm',
            }
        },
        tdm: {
            initial: 'start',
            states: {
                start: {
                    invoke: {
                        id: "startSession",
                        src: (_ctx, _evt) => tdmRequest(startSession),
                        onDone: [
                            {
                                target: 'utter',
                                actions: tdmAssign,
                                cond: (_ctx, event) => event.data.output
                            },
                            {
                                target: 'fail'
                            }
                        ],
                        onError: { target: 'fail' }
                    }
                },
                utter: {
                    initial: 'prompt',
                    on: {
                        RECOGNISED: 'next',
                        SELECT: {
                            target: 'nextHaptic',
                            actions: assign({ hapticInput: (_ctx, event) => event.value })
                        },
                        TIMEOUT: 'passivity'
                    },
                    states: {
                        prompt: {
                            entry: [
                                maybeAlternatives,
                                send((context: SDSContext) => ({
                                    type: "SPEAK", value: context.tdmUtterance
                                }))],
                            on: {
                                ENDSPEECH:
                                    [
                                        {
                                            target: '#root.dm.init',
                                            cond: (context) =>
                                                context.tdmActions.some(
                                                    (item: any) =>
                                                        ['EndSession', 'EndConversation'].
                                                            includes(item.name))
                                        },
                                        { target: 'ask' }
                                    ]

                            }
                        },
                        ask: {
                            entry: send('LISTEN')
                        },
                    }
                },
                next: {
                    invoke: {
                        id: "nlInput",
                        src: (context, _evt) => tdmRequest(nlInput(context.sessionObject, context.recResult)),
                        onDone: [
                            {
                                target: 'utter',
                                actions: tdmAssign,
                                cond: (_ctx, event) => event.data.output
                            },
                            {
                                target: 'fail'
                            }
                        ],
                        onError: { target: 'fail' }
                    }
                },
                nextHaptic: {
                    invoke: {
                        id: "hapticInput",
                        src: (context, _evt) => tdmRequest(hapticInput(context.sessionObject, context.hapticInput)),
                        onDone: [
                            {
                                target: 'utter',
                                actions: tdmAssign,
                                cond: (_ctx, event) => event.data.output
                            },
                            {
                                target: 'fail'
                            }
                        ],
                        onError: { target: 'fail' }
                    }
                },
                passivity: {
                    invoke: {
                        id: "passivity",
                        src: (context, _evt) => tdmRequest(passivity(context.sessionObject)),
                        onDone: [
                            {
                                target: 'utter',
                                actions: tdmAssign,
                                cond: (_ctx, event) => event.data.output
                            },
                            {
                                target: 'fail'
                            }
                        ],
                        onError: { target: 'fail' }
                    }

                },
                fail: {}
            },
        },
    },
});
