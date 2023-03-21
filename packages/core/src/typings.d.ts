declare module "web-speech-cognitive-services/lib/SpeechServices/TextToSpeech";
declare module "web-speech-cognitive-services/lib/SpeechServices/SpeechToText";

interface MySpeechSynthesisUtterance extends SpeechSynthesisUtterance {
  new (s: string);
}

interface Segment {
  pageNumber: number;
  dddName: string;
}

interface Hypothesis {
  utterance: string;
  confidence: number;
}

interface SDSContext {
  recResult: Hypothesis[];
  azureAuthorizationToken: string;
  audioCtx: AudioContext;
  ttsRef: any;
  asrRef: any;
}

interface Settings {
  ttsVoice: string;
  ttsLexicon: string;
  asrLanguage: string;
  azureKey: string;
  endpoint: string;
  deviceID: string;
  completeTimeout: number;
}

interface DomainContext extends SDSContext {
  parameters: Settings;

  sessionObject: any;
  hapticInput: string;
  segment?: Segment;

  tdmAll?: any;
  tdmUtterance?: string;
  tdmPassivity?: number;
  tdmSpeechCompleteTimeout?: number;
  tdmActions?: any;
  tdmVisualOutputInfo?: any;
  tdmExpectedAlternatives?: any;
  tdmOutput?: any;
  tdmActiveDDD?: string;
  tdmAvailableDDDs?: string[];
  tdmAsrHints?: string[];
}

type SDSEvent =
  | { type: "TTS_READY" }
  | { type: "TTS_ERROR" }
  | { type: "ENDSPEECH" }
  | { type: "ASR_READY" }
  | { type: "ASR_STARTED" }
  | { type: "ASR_NOINPUT_TIMEOUT" }
  | { type: "RECOGNISED"; value: Hypothesis[] }
  | { type: "PREPARE" }
  | { type: "CLICK" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "LISTEN" }
  | { type: "STARTSPEECH" }
  | { type: "SPEAK"; value: string }
  | { type: "TURNPAGE"; value: Segment };

interface ASRContext {
  audioCtx: AudioContext;
  language: string;
  azureAuthorizationToken?: string;
  noinputTimeout?: number;
  completeTimeout?: number;
  asr?: SpeechRecognition;
  result?: Hypothesis[];
}

type ASREvent =
  | { type: "READY" }
  | {
      type: "START";
      value?: { noinputTimeout: number; completeTimeout: number };
    }
  | { type: "STARTED" }
  | { type: "STARTSPEECH" }
  | { type: "RESULT"; value: Hypothesis[] };

interface TTSContext {
  audioCtx: AudioContext;
  azureAuthorizationToken?: string;
  ttsVoice: string;
  ttsLexicon: string;
  ttsAgenda?: string;
  tts?: SpeechSynthesis;
  voice?: SpeechSynthesisVoice;
  ttsUtterance?: MySpeechSynthesisUtterance;
}

type TTSEvent =
  | { type: "READY" }
  | { type: "ERROR" }
  | { type: "START"; value: string }
  | { type: "PAUSE" }
  | { type: "CONTINUE" }
  | { type: "END" };
