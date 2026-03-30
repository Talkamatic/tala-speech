import { waitFor } from "xstate";
import type { TDMSettings, TalaSpeechService } from "./types";
import { metaToTailwind } from "./metaToTailwind";

export const renderTalaSpeech = async (
  settings: TDMSettings,
  page: string,
  element: HTMLDivElement,
  talaSpeechService: TalaSpeechService,
) => {
  const button = document.createElement("button");
  const baseCSS =
    "mb-3 bg-neutral-100 text-slate-900 text-2xl text-center py-2 px-5 rounded-r-2xl flex flex-row h-28 w-64 items-center justify-start gap-4 border border-[2px] border-slate-900";
  button.id = `${element.id}-button`;
  button.className = baseCSS;
  button.addEventListener(
    "click",
    () => {
      talaSpeechService.send({ type: "START" });
      talaSpeechService.send({ type: "CONTROL" });
    },
    false,
  );

  const debugContainer = document.createElement("details");
  debugContainer.className =
    "text-neutral-400 marker:text-neutral-400 open:marker:content-['−_Debug:'] marker:content-['+_Debug...']";
  const debugHeader = document.createElement("summary");
  debugContainer.appendChild(debugHeader);
  let debugMessage = document.createTextNode("...");
  debugContainer.id = "debugContainer";
  debugContainer.addEventListener(
    "debugMessage",
    (e: CustomEventInit<number>) => {
      debugMessage.textContent =
        `Network overhead for last request: ${e.detail!.toFixed()} ms` || "";
    },
  );
  debugContainer.appendChild(debugMessage);
  element.appendChild(button);
  element.appendChild(debugContainer);

  talaSpeechService.send({ type: "SETUP", value: settings });
  await waitFor(
    talaSpeechService,
    (snapshot) => {
      return (
        (Object.values(snapshot.getMeta())[0] || {}).view === "before-prepare"
      );
    },
    {
      timeout: 10_000,
    },
  );
  talaSpeechService.send({ type: "TURN_PAGE", value: page });
  talaSpeechService.send({ type: "PREPARE" });
  await waitFor(talaSpeechService, (snapshot) => !!snapshot.context.spstRef);
  talaSpeechService.getSnapshot().context.spstRef.subscribe(() => {
    button.className = metaToTailwind(window.TalaSpeechUIState, baseCSS);
  });
};
