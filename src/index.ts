import { createMachine, interpret, assign, sendTo } from "xstate";
import { machine } from "speechstate";

const settings = {
  azureCredentials: "https://tala.pratb.art/gettoken.php",
  asrDefaultCompleteTimeout: 0,
  locale: "en-US",
};

interface DMContext {
  spstRef?: any;
}

const dmMachine = createMachine(
  {
    id: "dm",
    initial: "prepare",
    types: {
      context: {} as DMContext,
    },
    states: {
      prepare: {
        entry: [
          assign({
            spstRef: ({ context, spawn }) => {
              return spawn(machine, {
                input: {
                  settings: {
                    azureCredentials: "https://tala.pratb.art/gettoken.php",
                    asrDefaultCompleteTimeout: 0,
                    locale: "en-US",
                  },
                },
              });
            },
          }),
          ({ context }) =>
            context.spstRef.send({
              type: "PREPARE",
            }),
        ],
        on: {
          ASRTTS_READY: {
            target: "start",
            actions: () => console.debug("[SpSt→DM] ASRTTS_READY"),
          },
        },
      },
      start: {
        entry: ({ context }) =>
          context.spstRef.send({
            type: "SPEAK",
            value: { utterance: "hello world" },
          }),
        on: {
          ENDSPEECH: {
            target: "ask",
            actions: () => console.debug("[SpSt→DM] ENDSPEECH"),
          },
        },
      },
      ask: {
        entry: ({ context }) =>
          context.spstRef.send({
            type: "LISTEN",
          }),
        on: {
          RECOGNISED: {
            target: "repeat",
            actions: [({ context, event }) => console.log(event)],
          },
        },
      },
      repeat: {
        entry: ({ context, event }) =>
          context.spstRef.send({
            type: "SPEAK",
            value: { utterance: event.value[0].utterance },
          }),
        on: {
          ENDSPEECH: {
            target: "ask",
            actions: () => console.debug("[SpSt→DM] ENDSPEECH"),
          },
        },
      },
    },
  },
  {}
);

const talaSpeechService = interpret(dmMachine);
talaSpeechService.start();
