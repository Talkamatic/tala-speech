/// <reference types="react-scripts" />

declare module "react-speech-kit";
declare module "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";
declare module "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";

interface Hypothesis {
  utterance: string;
  confidence: number;
}

interface Segment {
  pageNumber: number;
  dddName: string;
}

interface Settings {
  deviceID: string;
  endpoint: string;
  ttsVoice: string;
  ttsLexicon: string;
  asrLanguage: string;
  azureKey?: string;
  completeTimeout: number;
  clickToSkip: boolean;
  i18nClickToStart: string;
  i18nListening: string;
  i18nSpeaking: string;
  i18nClickToContinue: string;
}

interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
  new (s: string);
}

interface MySpeechRecognition extends SpeechRecognition {
  new (s: string);
}

interface SDSContext {
  parameters: Settings;
  asr: SpeechRecognition;
  tts: SpeechSynthesis;
  voice: SpeechSynthesisVoice;
  ttsUtterance: MySpeechSynthesisUtterance;
  recResult: Hypothesis[];
  hapticInput: string;
  nluData: any;
  ttsAgenda: string;
  query: string;
  snippet: string;
  sessionObject: any;
  tdmAll: any;
  tdmUtterance: string;
  segment: Segment;
  tdmPassivity: number;
  tdmSpeechCompleteTimeout: number;
  tdmActions: any;
  tdmVisualOutputInfo: any;
  tdmExpectedAlternatives: any;
  tdmOutput: any;
  tdmActiveDDD: string;
  tdmAvailableDDDs: string[];
  tdmAsrHints: string[];
  azureAuthorizationToken: string;
  audioCtx: any;
}

type SDSEvent =
  | { type: "TURNPAGE"; value: Segment }
  | { type: "TTS_READY" }
  | { type: "TTS_ERROR" }
  | { type: "CLICK" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "SELECT"; value: any }
  | { type: "SHOW_ALTERNATIVES" }
  | { type: "ASR_START" }
  | { type: "STARTSPEECH" }
  | { type: "RECOGNISED" }
  | { type: "ASRRESULT"; value: Hypothesis[] }
  | { type: "ENDSPEECH" }
  | { type: "TTS_END" }
  | { type: "LISTEN" }
  | { type: "TIMEOUT" }
  | { type: "SPEAK"; value: string };
