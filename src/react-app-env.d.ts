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
  sessionObjectAdditions: any;
  endpoint: string;
  ttsVoice: string;
  ttsLexicon: string;
  speechRate: string;
  asrLanguage: string;
  azureKey?: string;
  azureProxyURL?: string;
  completeTimeout: number;
  fillerDelay: number;
  clickToSkip: boolean;
  i18nClickToStart: string;
  i18nListening: string;
  i18nSpeaking: string;
  i18nClickToContinue: string;
}

interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
  new (s: string?): MySpeechSynthesisUtterance;
}

interface SDSContext {
  parameters: Settings;
  asr: SpeechRecognition;
  tts: SpeechSynthesis;
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
  stream: any;
  buffer: string;
  streamingDone: boolean;
}

type SDSEvent =
  | { type: "TURNPAGE"; value: Segment }
  | { type: "GET_TOKEN" }
  | { type: "NEW_TOKEN" }
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
  | { type: "PRELIMINARY_RECOGNITION" }
  | { type: "ASRRESULT"; value: Hypothesis[] }
  | { type: "ENDSPEECH" }
  | { type: "TTS_END" }
  | { type: "LISTEN" }
  | { type: "TIMEOUT" }
  | { type: "SPEAK"; value: string }
  | { type: "STREAMING_CHUNK"; value: string }
  | { type: "STREAMING_DONE" }
  | { type: "STREAMING_RESET" }
  | { type: "SPEAKING_STREAM" };
