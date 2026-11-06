import assert from "node:assert/strict";
import { test } from "node:test";

import {
  waitForActorSnapshot,
  startDmSession,
  waitForDmSnapshot,
  waitForDmState,
} from "./support/dmHarness.ts";

test("DM starts a TDM session and stores the returned session state", async (t) => {
  const session = await startDmSession();
  t.after(session.cleanup);

  assert.equal(session.requests.length, 1);
  assert.equal(session.requests[0].url, session.endpoint);
  assert.equal(session.requests[0].method, "POST");
  assert.deepEqual(await session.requests[0].clone().json(), {
    version: "3.4",
    session: { device_id: "device-42", locale: "en-US" },
    request: { start_session: {} },
  });
  assert.deepEqual(session.snapshot.context.tdmState, session.backendResponse);
  assert.equal(session.snapshot.context.segment, "welcome");
});

test("DM can select another segment after starting the session", async (t) => {
  const session = await startDmSession();
  t.after(session.cleanup);

  session.actor.send({ type: "TURN_PAGE", value: "next-page" });

  assert.equal(session.actor.getSnapshot().context.segment, "next-page");
  assert.equal(session.requests.length, 1);
});

test("DM reaches Idle after PREPARE and speech readiness", async (t) => {
  const session = await startDmSession();
  t.after(session.cleanup);
  const preparing = waitForDmState(session.actor, "Prepare");
  const idle = waitForDmState(session.actor, "Idle");

  session.actor.send({ type: "PREPARE" });

  const [prepareSnapshot, idleSnapshot] = await Promise.all([preparing, idle]);
  assert.equal(prepareSnapshot.value, "Prepare");
  assert.equal(idleSnapshot.value, "Idle");
  assert.deepEqual(idleSnapshot.context.tdmState, session.backendResponse);
  assert.equal(session.requests.length, 1);
});

test("DM speaks streamed text after START", async (t) => {
  const sseEvents = [
    { type: "INIT" },
    { type: "STREAMING_CHUNK", data: "This phrase " },
    { type: "STREAMING_CHUNK", data: "arrived over SSE." },
    { type: "STREAMING_DONE" },
  ];
  const session = await startDmSession({ sseEvents });
  t.after(session.cleanup);
  const firstTurnComplete = waitForDmSnapshot(session.actor, (snapshot) => {
    const conversation = snapshot.value?.Active?.Conversation;
    return (
      conversation?.Adjacency === "Prompt" && conversation?.TDMCalls === "Idle"
    );
  }, "the first prompt and segment request");

  session.actor.send({ type: "PREPARE" });
  await waitForDmState(session.actor, "Idle");
  session.actor.send({ type: "START" });

  const snapshot = await firstTurnComplete;
  const speechSnapshot = snapshot.context.spstRef.getSnapshot();
  assert.equal(speechSnapshot.value, "speaking");
  assert.equal(
    speechSnapshot.context.streamUrl,
    "https://tdm.example.test/stream/session-123",
  );
  assert.equal(speechSnapshot.context.streamedText, "This phrase arrived over SSE.");
  assert.equal(speechSnapshot.context.streamComplete, true);
  assert.equal(session.requests.length, 2);
  assert.deepEqual(await session.requests[1].clone().json(), {
    version: "3.4",
    session: session.backendResponse.session,
    request: {
      semantic_input: {
        interpretations: [
          {
            modality: "other",
            moves: [
              {
                ddd: "welcome",
                perception_confidence: 1,
                understanding_confidence: 1,
                semantic_expression: "request(top)",
              },
            ],
          },
        ],
      },
    },
  });
});

test("barge-in interrupts one stream and uses the next TDM passivity", async (t) => {
  const tdmResponse = (expectedPassivity: number, utterance: string) => ({
    session: {
      session_id: "session-123",
      sse_endpoint: "https://tdm.example.test/stream",
      barge_in: true,
    },
    context: {
      available_ddds: ["welcome"],
      active_ddd: "welcome",
      asr_hints: ["support"],
    },
    output: {
      expected_passivity: expectedPassivity,
      speech_complete_timeout: 1,
      moves: ["greeting"],
      utterance,
    },
  });
  const hypothesis = { utterance: "Wait, I have a question.", confidence: 1 };
  const session = await startDmSession({
    backendResponses: [
      tdmResponse(1, "First prompt"),
      tdmResponse(1, "Segment response"),
      tdmResponse(2, "Second prompt"),
    ],
    sseStreams: [
      [
        { type: "INIT" },
        { type: "STREAMING_CHUNK", data: "First stream has started." },
      ],
      [
        { type: "INIT" },
        { type: "STREAMING_CHUNK", data: "Second stream after barge-in." },
        { type: "STREAMING_DONE" },
      ],
    ],
  });
  t.after(session.cleanup);

  session.actor.send({ type: "PREPARE" });
  await waitForDmState(session.actor, "Idle");

  const firstPrompt = waitForDmSnapshot(
    session.actor,
    (snapshot) => {
      const conversation = snapshot.value?.Active?.Conversation;
      return conversation?.Adjacency === "Prompt" && conversation?.TDMCalls === "Idle";
    },
    "the first prompt and segment request",
  );
  session.actor.send({ type: "START" });
  const firstTurn = await firstPrompt;
  const speechActor = firstTurn.context.spstRef;
  const firstSpeech = speechActor.getSnapshot().context.speakHistory[0];

  assert.equal(firstSpeech.value.utterance, "First prompt");
  assert.equal(firstSpeech.value.bargeIn.noInputTimeout, 1_000);
  assert.equal(firstSpeech.streamComplete, false);
  assert.equal(firstSpeech.interrupted, false);

  const nlInput = waitForDmSnapshot(
    session.actor,
    (snapshot) => snapshot.value?.Active?.Conversation?.TDMCalls === "NLInput",
    "TDM natural-language input from ASR",
  );
  session.sendSpeechEvent({ type: "TEST_ASR_INTERRUPT", value: [hypothesis] });
  await nlInput;

  const nlRequest = await session.requests[2].clone().json();
  assert.deepEqual(nlRequest.request.natural_language_input.hypotheses, [hypothesis]);
  assert.deepEqual(nlRequest.session.moves, ["greeting"]);

  const secondTurn = await waitForDmSnapshot(
    session.actor,
    (snapshot) =>
      snapshot.value?.Active?.Conversation?.TDMCalls === "Idle" &&
      snapshot.context.tdmState.output.utterance === "Second prompt",
    "the TDM response after barge-in",
  );
  assert.equal(secondTurn.context.lastNoInputTimeout, 2_000);

  const secondPrompt = waitForActorSnapshot(
    secondTurn.context.spstRef,
    (snapshot) => snapshot.context.speakHistory.length === 2,
    "the second streamed prompt",
  );
  session.sendSpeechEvent({ type: "TEST_LISTEN_COMPLETE" });
  const secondSpeechSnapshot = await secondPrompt;
  const speakHistory = secondSpeechSnapshot.context.speakHistory;

  assert.equal(speakHistory[0].interrupted, true);
  assert.equal(speakHistory[0].streamComplete, false);
  assert.equal(speakHistory[1].value.utterance, "Second prompt");
  assert.equal(speakHistory[1].value.bargeIn.noInputTimeout, 2_000);
  assert.equal(speakHistory[1].streamedText, "Second stream after barge-in.");
  assert.equal(speakHistory[1].streamComplete, true);
  assert.equal(session.requests.length, 3);
});
