import type { AnyActor, Actor, StateMachine } from "xstate";

declare global {
  interface Window {
    TalaSpeech: AnyActor;
    TalaSpeechUIState: string | undefined;
    TalaSpeechRenderer: {
      renderTalaSpeech: (
        settings: TDMSettings,
        page: string,
        element: HTMLDivElement,
        talaSpeechService: TalaSpeechService,
      ) => void;
      getDialogueJson: (url: string) => unknown;
    };
  }
}

import type {
  Settings,
  Hypothesis,
  SpeechStateExternalEvent,
} from "speechstate";

export interface TDMSettings extends Settings {
  deviceID: string;
  sessionObjectAdditions?: any;
  endpoint: string;
}

export interface DMContext {
  tdmSettings?: TDMSettings;
  spstRef?: any;
  segment?: string;
  tdmState?: any;
  lastResult?: Hypothesis[];
  lastBargeIn?: boolean;
  avatarName?: string;
  executionStartTime?: number;
}

export type DMEvent =
  | SpeechStateExternalEvent
  | { type: "SETUP"; value: TDMSettings }
  | { type: "TURN_PAGE"; value: string }
  | { type: "START" };

export type TalaSpeechService = Actor<
  StateMachine<
    DMContext,
    DMEvent,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >
>;
