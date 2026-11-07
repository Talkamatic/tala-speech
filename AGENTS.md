# Tala-speech components

## Runtime relationships

- **Embedding browser app:** supplies `TDMSettings`, a page/segment identifier, and a `HTMLDivElement` to `TalaSpeechRenderer.renderTalaSpeech`. It can control the dialogue through the `window.TalaSpeech` actor and observe `window.TalaSpeechUIState`.
- **Tala-speech dialogue manager (`src/index.ts`):** an XState actor that owns setup, page selection, preparation, the speak/listen loop, pause/stop, and end/failure states. It coordinates the backend and speech actor.
- **Talkamatic dialogue manager (TDM) backend:** a JSON HTTP API at the configured `endpoint`. Tala-speech sends `start_session`, `semantic_input` (for a segment), `natural_language_input` (for recognized speech), and `passivity` requests. Responses carry the session and dialogue state used for the next turn, including utterance, moves, ASR hints, passivity, and the speech stream URL.
- **`speechstate` package:** spawned as a child actor. Tala-speech sends it preparation, speech, listening, control, stop, and ASR-parameter updates. It receives recognition and speech lifecycle events back. Speech uses the stream URL and session identifier supplied by the TDM response; `speechstate` handles the speech services and stream.
- **View/template (`src/talaSpeechView.ts`):** converts current UI and TDM state into display data, including a relevant image URL, and mounts either the default DOM template or a caller-supplied template. `src/metaToTailwind.ts` maps UI states to button styling.
- **Browser APIs:** runtime code uses `fetch` for TDM/JSON requests and DOM APIs for rendering and debug events. The main actor module also publishes its actor and renderer on `window`.

## Minimal unit tests

Start with pure functions that do not need a browser, network, or running actor. `calculatePassivity` in `src/passivity.ts` converts expected passivity seconds to milliseconds and supplies the deferred timeout when the value is missing. `test/calculatePassivity.test.ts` is a small example. For actor-level TDM tests, use `startDmSession` from `test/support/dmHarness.ts`. It supplies fake TDM and speechstate actors and returns a fresh actor at `BeforePrepare`; configure ordered `backendResponses` and `sseStreams` when testing multiple turns. The speechstate test double sends `ASRTTS_READY` after `PREPARE`, consumes configured `STREAMING_CHUNK` and `STREAMING_DONE` events after `SPEAK`, and accepts `TEST_ASR_INTERRUPT` and `TEST_LISTEN_COMPLETE` to model a barge-in cycle. Register its `cleanup` with `t.after` in each test. Other isolated candidates are `createTalaSpeechViewState` and `metaToTailwind`.

Run the focused test suite with `npm test`. Actor, backend, speech-service, and DOM behavior tests need their external dependencies mocked and can be added separately when those boundaries are needed.
