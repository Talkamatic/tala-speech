import { interpret } from "xstate";
import { machine } from "tala-speech";

const externalContext = {
  parameters: {
    ttsVoice: "sv-SE",
    ttsLexicon: null,
    asrLanguage: "sv-SE",
    completeTimeout: 0,
    endpoint:
      "https://reading-buddy-serverless-handler.eu2.ddd.tala.cloud/interact/alma/",
    // azureKey: "2e15e033f605414bbbfe26cb631ab755",
  },
  segment: { pageNumber: 0, dddName: "cover" },
};

export default talaSpeechService = interpret(
  machine.withContext({
    ...machine.context,
    ...externalContext,
  }),
  {
    devTools: process.env.NODE_ENV === "development" ? true : false,
  }
).onTransition((state, event) => {
  console.log(state, event);
});

talaSpeechService.start();
talaSpeechService.send({
  type: "TURNPAGE",
  value: { pageNumber: 0, dddName: "sida_5" },
});
