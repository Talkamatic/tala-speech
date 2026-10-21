import { metaToTailwind } from "./metaToTailwind";

export interface TalaSpeechViewState {
  uiState: string | undefined;
  imageUrl: string | undefined;
}

export interface TalaSpeechTemplateActions {
  start: () => void;
  control: () => void;
}

export interface TalaSpeechTemplate {
  mount: (
    container: HTMLDivElement,
    actions: TalaSpeechTemplateActions,
  ) => {
    update: (state: TalaSpeechViewState) => void;
  };
}

interface TDMState {
  [key: string]: unknown;
  output?: {
    [key: string]: unknown;
    visual_output?: {
      [key: string]: unknown;
      image?: string;
    };
  };
}

export const createTalaSpeechViewState = (
  uiState: string | undefined,
  tdmState: TDMState | undefined,
): TalaSpeechViewState => ({
  uiState,
  imageUrl: tdmState?.output?.visual_output?.image,
});

export const defaultTalaSpeechTemplate: TalaSpeechTemplate = {
  mount: (element, actions) => {
    const imageContainer = document.createElement("div");
    imageContainer.className =
      "mb-3 aspect-video w-full max-w-lg overflow-hidden rounded-lg";

    const imagePlaceholder = document.createElement("div");
    imagePlaceholder.className =
      "flex h-full w-full items-center justify-center text-neutral-400";

    const dialogueImage = document.createElement("img");
    dialogueImage.className = "h-full w-full object-contain";
    dialogueImage.alt = "Dialogue visual";
    dialogueImage.style.display = "none";
    dialogueImage.addEventListener("load", () => {
      dialogueImage.style.display = "block";
      imagePlaceholder.style.display = "none";
    });
    dialogueImage.addEventListener("error", () => {
      dialogueImage.style.display = "none";
      imagePlaceholder.style.display = "flex";
    });
    imageContainer.append(imagePlaceholder, dialogueImage);

    const button = document.createElement("button");
    const baseCSS =
      "mb-3 bg-neutral-100 text-slate-900 text-2xl text-center py-2 px-5 rounded-r-2xl flex flex-row h-28 w-64 items-center justify-start gap-4 border border-[2px] border-slate-900";
    button.id = `${element.id}-button`;
    button.className = baseCSS;
    button.addEventListener("click", () => {
      actions.start();
      actions.control();
    });

    const debugContainer = document.createElement("details");
    debugContainer.className =
      "text-neutral-400 marker:text-neutral-400 open:marker:content-['−_Debug:'] marker:content-['+_Debug...']";
    const debugHeader = document.createElement("summary");
    debugContainer.appendChild(debugHeader);
    const debugMessage = document.createTextNode("...");
    debugContainer.id = "debugContainer";
    debugContainer.addEventListener(
      "debugMessage",
      (e: CustomEventInit<number>) => {
        debugMessage.textContent =
          `Network overhead for last request: ${e.detail!.toFixed()} ms` || "";
      },
    );
    debugContainer.appendChild(debugMessage);

    element.append(imageContainer, button, debugContainer);

    return {
      update: ({ uiState, imageUrl }) => {
        button.className = metaToTailwind(uiState, baseCSS);

        if (!imageUrl) {
          dialogueImage.removeAttribute("src");
          dialogueImage.style.display = "none";
          imagePlaceholder.style.display = "flex";
        } else if (dialogueImage.getAttribute("src") !== imageUrl) {
          dialogueImage.style.display = "none";
          imagePlaceholder.style.display = "flex";
          dialogueImage.src = imageUrl;
        }
      },
    };
  },
};

export const mountTalaSpeechTemplate = (
  element: HTMLDivElement,
  template: TalaSpeechTemplate,
  actions: TalaSpeechTemplateActions,
) => {
  const container = document.createElement("div");
  container.className = "tala-speech-container p-2";
  element.appendChild(container);
  return template.mount(container, actions);
};
