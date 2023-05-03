import { MachineConfig, actions } from "xstate";
const { send, assign } = actions;

export const fakeDmMachine: MachineConfig<SDSContext, any, SDSEvent> = {
  predictableActionArguments: true,
  initial: "wait",
  states: {
    wait: { on: { TTS_READY: "idle" } },
    idle: {
      entry: [
        assign({
          step: () => 0,
          shuff: () => true,
          tdmPassivity: () => 7000,
        }),
        "showDialogue",
      ],
      on: {
        CLICK: "main",
      },
    },
    main: {
      initial: "start",
      states: {
        start: {
          initial: "prompt",
          on: {
            TIMEOUT: ".passivity",
            RECOGNISED: [
              {
                target: ".good",
		actions: assign({ step: (c) => c.step + 1 }),

              },
            ],
          },
          states: {
            passivity: {
              entry: send((context: SDSContext) => ({
                type: "SPEAK",
                value: context.parameters.i18nNoInput,
              })),
              on: { ENDSPEECH: "ask" },
            },
            good: {
                always: [
                  {
                    target: "#root.dm.idle",
                    cond: (context) => context.step === context.steps,
                  },
                  {
                    target: "prompt",
                  },
                ],
            },
            bad: {
              entry: send((_context: SDSContext) => ({
                type: "SPEAK",
                value:
                  '<audio src="https://tala.pratb.art/sounds/gd.wav">Oops!</audio>',
              })),
              on: {
                ENDSPEECH: {
                  target: "prompt",
                },
              },
            },
            prompt: {
              entry: send((context: SDSContext) => ({
                type: "SPEAK",
                value: context.dialogue[context.step].S,
              })),
              on: {
                ENDSPEECH: "ask",
              },
            },
            ask: {
              entry: send("LISTEN"),
            },
          },
        },
      },
    },
  },
};



