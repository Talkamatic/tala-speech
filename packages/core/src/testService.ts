import { interpret } from "xstate";
import { machine } from "./index";
import { inspect } from "@xstate/inspect";

inspect();

const externalContext = {
  parameters: {
    ttsVoice: "sv-SE",
    ttsLexicon: null,
    asrLanguage: "sv-SE",
    completeTimeout: 0,
    endpoint:
      "https://reading-buddy-serverless-handler.eu2.ddd.tala.cloud/interact/alma/",
    azureKey: null,
    deviceID: null,
    // azureKey: "2e15e033f605414bbbfe26cb631ab755",
  },
  segment: { pageNumber: 0, dddName: "cover" },
};

const talaSpeechService = interpret(
  machine.withContext({
    ...machine.context,
    ...externalContext,
  }),
  { devTools: true }
);

talaSpeechService.start();

talaSpeechService.send("PREPARE");
