import * as React from "react";
import { machine } from "tala-speech";
import { ttsMachine } from "tala-speech";
// import { asrMachine } from "tala-speech";
import { useMachine, useActor, useActorRef, useSelector } from "@xstate/react";
import { interpret } from "xstate";

// import { inspect } from "@xstate/inspect";

// inspect();

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

export const App = () => {
  const sdsActorRef = useActorRef(machine, { input: { ...externalContext } });

  // actor.start();
  sdsActorRef.send({ type: "PREPARE" });
  const sel = useSelector(sdsActorRef, (s) => s.context);

  return (
    <div>
      <button
        onClick={() => {
          console.log(sel);
          sdsActorRef.send({ type: "CLICK" });
          console.log(sel);
        }}
      >
        CLICK
      </button>
    </div>
  );
};
