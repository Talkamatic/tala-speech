import { interpret } from "xstate";
import { machine } from "./index";
import { Settings } from "./typings";

const externalParameters: Settings = {
  // defaultVoiceSearchString: "en-US",
  // asrLanguage: "sv-SE",
  locale: "en-US",
  completeTimeout: 0,
  endpoint:
    "https://reading-buddy-serverless-handler.eu2.ddd.tala.cloud/interact/alma/",
  azureKey: null,
  deviceID: null,
  // azureKey: "2e15e033f605414bbbfe26cb631ab755",
  // segment: { pageNumber: 0, dddName: "cover" },
};

const talaSpeechService = interpret(machine, {
  input: {
    parameters: externalParameters,
  },
  devTools: true,
});

talaSpeechService.subscribe((state) => {});

talaSpeechService.start();

talaSpeechService.send({ type: "PREPARE" });

window.talaSpeechService = talaSpeechService;
