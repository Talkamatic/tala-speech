import * as React from "react";
import { machine } from "tala-speech";
import { ttsMachine } from "tala-speech";
import { asrMachine } from "tala-speech";
import { useInterpret, useMachine } from "@xstate/react";
import { interpret } from "xstate";

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
    // azureKey: "2e15e033f605414bbbfe26cb631ab755",
    azureKey: null,
    deviceID: null,
  },
  segment: { pageNumber: 0, dddName: "cover" },
};

// const talaSpeechService = interpret(
//   machine.withContext({
//     ...machine.context,
//     ...externalContext,
//   }),
//   { devTools: true }
// );

// talaSpeechService.start();

// talaSpeechService.send("PREPARE");

export const App = () => {
  const [state, send, service] = useMachine(
    machine.withContext({
      ...machine.context,
      ...externalContext,
    }),
    { devTools: true }
  );

  service.start();
  send("PREPARE");

  return <div></div>;
};
