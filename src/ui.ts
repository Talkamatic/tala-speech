import { waitFor } from "xstate";
import type { TDMSettings, TalaSpeechService } from "./types";
import { metaToTailwind } from "./metaToTailwind";
import { html, render } from "lit-html";

export const renderTalaSpeech = async (
  settings: TDMSettings,
  page: string,
  element: HTMLDivElement,
  talaSpeechService: TalaSpeechService,
) => {
  const butn () => html`<button id="abc" class="btn">Button</button>`;
  render(butn(), element);

  const startAndControl = () => {
    talaSpeechService.send({ type: "START" });
    talaSpeechService.send({ type: "CONTROL" });
  };
  const baseCSS =
    "mb-3 bg-neutral-100 text-slate-900 text-2xl text-center py-2 px-5 rounded-r-2xl flex flex-row h-28 w-64 items-center justify-start gap-4 border border-[2px] border-slate-900";
  const button = (element: HTMLDivElement, className: string) =>
    html`<button
      @click=${startAndControl}
      id="${element.id}-button"
      class="${className}"
    ></button>`;

  const debugContainer = (message?: string) =>
    html`<details
      id="debugContainer"
      class="text-neutral-400 marker:text-neutral-400 open:marker:content-['−_Debug:'] marker:content-['+_Debug...']"
    >
      <summary></summary>
      <span id="debugMessage">${message || "..."}</span>
    </details>`;

  const tsUI = html`${button(element, baseCSS)}${debugContainer()}`;
  // render(tsUI, element);

  document.addEventListener("ts.DebugMessage", (e: CustomEventInit<number>) => {
    // render(
    //   debugContainer(
    //     `Network overhead for last request: ${e.detail!.toFixed()} ms`,
    //   ),
    //   element,
    // );
  });

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
    // render(
    //   button(element, metaToTailwind(window.TalaSpeechUIState, baseCSS)),
    //   element,
    // );
  });
};
