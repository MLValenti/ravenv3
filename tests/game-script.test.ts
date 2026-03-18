import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeterministicGameTurnReply,
  buildDeterministicGameStart,
  detectRequestedDeterministicGameTemplateId,
  deriveGameProgressFromUserText,
  isDeterministicGameCompletionText,
  parseChosenNumber,
  selectDeterministicGameTemplate,
} from "../lib/session/game-script.ts";

test("game script uses learned profile to bias deterministic game selection", () => {
  const fastTemplate = selectDeterministicGameTemplate({
    profile: { preferred_pace: "fast and sharp" },
    rotationIndex: 0,
  });
  const steadyTemplate = selectDeterministicGameTemplate({
    profile: { preferred_pace: "slow and steady", likes: "memory and recall" },
    rotationIndex: 1,
  });
  const strictTierTemplate = selectDeterministicGameTemplate({
    profile: { preferred_style: "strict control" },
    progress: {
      current_tier: "gold",
      free_pass_count: 0,
      last_completion_summary: null,
    },
    rotationIndex: 2,
  });
  const fallbackTemplate = selectDeterministicGameTemplate({ rotationIndex: 2 });

  assert.equal(fastTemplate.id, "rps_streak");
  assert.equal(steadyTemplate.id, "number_hunt");
  assert.equal(strictTierTemplate.id, "rps_streak");
  assert.equal(fallbackTemplate.id, "math_duel");
});

test("game script starts with a real first prompt and only advances on valid answers", () => {
  const start = buildDeterministicGameStart("rps_streak");
  assert.match(start, /I pick\./i);
  assert.match(start, /First throw now/i);

  let progress = deriveGameProgressFromUserText("rps_streak", "round_1", "ok");
  assert.equal(progress, "round_1");

  progress = deriveGameProgressFromUserText("rps_streak", "round_1", "rock");
  assert.equal(progress, "round_2");

  progress = deriveGameProgressFromUserText("rps_streak", "round_2", "wrong");
  assert.equal(progress, "failed");

  progress = deriveGameProgressFromUserText("rps_streak", "round_2", "scissors");
  assert.equal(progress, "completed");
});

test("game script gives a corrective reply for invalid or filler answers", () => {
  const fillerReply = buildDeterministicGameTurnReply("rps_streak", "round_1", "ok");
  assert.match(fillerReply, /No stalling, pet\./i);
  assert.match(fillerReply, /First throw now/i);

  const invalidReply = buildDeterministicGameTurnReply("rps_streak", "round_1", "wrong");
  assert.match(invalidReply, /No\. Answer the prompt properly, pet\./i);
  assert.match(invalidReply, /First throw now/i);

  const validRoundOneReply = buildDeterministicGameTurnReply("rps_streak", "round_1", "rock");
  assert.match(validRoundOneReply, /You chose rock/i);
  assert.match(validRoundOneReply, /Rock beats scissors\./i);
  assert.match(validRoundOneReply, /Second throw now/i);

  const roundTwoInvalidReply = buildDeterministicGameTurnReply("rps_streak", "round_2", "wrong");
  assert.match(roundTwoInvalidReply, /No\. Keep up, pet\./i);
  assert.match(roundTwoInvalidReply, /Second throw now/i);

  const roundOneTieReply = buildDeterministicGameTurnReply("rps_streak", "round_1", "scissors");
  assert.match(roundOneTieReply, /Dead even\./i);
  assert.match(roundOneTieReply, /first throw stays live/i);
});

test("rps replies distinguish first throw, tie, and deciding throw outcomes", () => {
  const firstThrowReply = buildDeterministicGameTurnReply("rps_streak", "round_1", "rock");
  assert.match(firstThrowReply, /You chose rock/i);
  assert.match(firstThrowReply, /You take the first throw/i);
  assert.match(firstThrowReply, /Clean\./i);
  assert.match(firstThrowReply, /Second throw now/i);

  const decidingTieReply = buildDeterministicGameTurnReply("rps_streak", "round_2", "paper");
  assert.match(decidingTieReply, /deciding throw stays live/i);
  assert.match(decidingTieReply, /Dead even\./i);
  assert.match(decidingTieReply, /Second throw now/i);

  const decidingLossReply = buildDeterministicGameTurnReply("rps_streak", "failed", "rock", "round_2");
  assert.match(decidingLossReply, /You lose the deciding throw/i);
  assert.match(decidingLossReply, /Paper beats rock\./i);
  assert.match(decidingLossReply, /I win this one/i);
  assert.doesNotMatch(decidingLossReply, /and the round is mine/i);
});

test("game script rotates on explicit another-round cue instead of reusing learned bias", () => {
  const nextRoundTemplate = selectDeterministicGameTemplate({
    userText: "play again another round",
    profile: { preferred_pace: "fast and sharp" },
    rotationIndex: 2,
  });
  assert.equal(nextRoundTemplate.id, "math_duel");
});

test("game script selects competitive templates for wager and riddle cues", () => {
  const wagerTemplate = selectDeterministicGameTemplate({
    userText: "lets bet on the game",
    rotationIndex: 0,
  });
  const riddleTemplate = selectDeterministicGameTemplate({
    userText: "give me a riddle game",
    rotationIndex: 0,
  });
  assert.equal(wagerTemplate.id, "math_duel");
  assert.equal(riddleTemplate.id, "riddle_lock");
});

test("math duel allows a real loss on wrong answer and a win on clean answers", () => {
  let progress = deriveGameProgressFromUserText("math_duel", "round_1", "12");
  assert.equal(progress, "failed");

  progress = deriveGameProgressFromUserText("math_duel", "round_1", "11");
  assert.equal(progress, "round_2");

  progress = deriveGameProgressFromUserText("math_duel", "round_2", "15");
  assert.equal(progress, "completed");

  const failReply = buildDeterministicGameTurnReply("math_duel", "failed", "12");
  assert.match(failReply, /i win this round/i);
});

test("wager sessions force competitive templates and avoid low stakes defaults", () => {
  const withStakesDefault = selectDeterministicGameTemplate({
    userText: "you pick",
    hasStakes: true,
    rotationIndex: 0,
  });
  const withStakesProfileWord = selectDeterministicGameTemplate({
    userText: "you pick",
    hasStakes: true,
    profile: { preferred_style: "verbal word play" },
    rotationIndex: 0,
  });
  const withStakesExplicitRiddle = selectDeterministicGameTemplate({
    userText: "you pick a riddle",
    hasStakes: true,
    rotationIndex: 0,
  });

  assert.notEqual(withStakesDefault.id, "word_chain");
  assert.notEqual(withStakesDefault.id, "memory_chain");
  assert.notEqual(withStakesProfileWord.id, "word_chain");
  assert.notEqual(withStakesProfileWord.id, "memory_chain");
  assert.equal(withStakesExplicitRiddle.id, "riddle_lock");
});

test("explicit game selection survives wagered start cues", () => {
  const explicitTemplateId = detectRequestedDeterministicGameTemplateId(
    "lets play rock paper scissors",
  );
  assert.equal(explicitTemplateId, "rps_streak");

  const preservedTemplate = selectDeterministicGameTemplate({
    userText: "ok lets start best of three",
    hasStakes: true,
    currentTemplateId: "rps_streak",
    rotationIndex: 2,
  });

  assert.equal(preservedTemplate.id, "rps_streak");
});

test("explicit game selection survives another-round cue", () => {
  const preservedTemplate = selectDeterministicGameTemplate({
    userText: "another round of rock paper scissors",
    hasStakes: true,
    currentTemplateId: "number_hunt",
    rotationIndex: 3,
  });

  assert.equal(preservedTemplate.id, "rps_streak");
});

test("number command parses number picks and transitions through round states", () => {
  assert.equal(parseChosenNumber("i pick 7"), 7);
  assert.equal(parseChosenNumber("10"), 10);
  assert.equal(parseChosenNumber("11"), null);
  assert.equal(parseChosenNumber("zero"), null);

  let progress = deriveGameProgressFromUserText("number_command", "round_1", "i pick 4");
  assert.equal(progress, "round_2");

  progress = deriveGameProgressFromUserText("number_command", "round_2", "done");
  assert.equal(progress, "completed");

  progress = deriveGameProgressFromUserText("number_command", "round_2", "i failed");
  assert.equal(progress, "failed");
});

test("number command selection triggers from number game wording", () => {
  const pickedTemplate = selectDeterministicGameTemplate({
    userText: "lets do a number game 1-10",
    rotationIndex: 0,
  });
  assert.equal(pickedTemplate.id, "number_command");
});

test("game completion detection recognizes both Raven and user round resolution lines", () => {
  assert.equal(isDeterministicGameCompletionText("I win this one."), true);
  assert.equal(isDeterministicGameCompletionText("You win this round."), true);
  assert.equal(isDeterministicGameCompletionText("First throw now."), false);
});
