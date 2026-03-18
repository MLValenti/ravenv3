import test from "node:test";
import assert from "node:assert/strict";

import {
  detectWagerDelegation,
  hasStakeSignal,
  isGameChoiceDelegation,
  isGameNextPromptQuestion,
  isGameRulesQuestion,
  isGameStartCue,
  isSimpleGreeting,
  isStakeQuestion,
  wantsAnotherRound,
} from "../lib/dialogue/user-signals.ts";

test("shared signals detect greeting variants", () => {
  assert.equal(isSimpleGreeting("hi"), true);
  assert.equal(isSimpleGreeting("hi miss"), true);
  assert.equal(isSimpleGreeting("hello mistress"), true);
  assert.equal(isSimpleGreeting("lets play a game"), false);
});

test("shared signals detect wager delegation variants", () => {
  assert.equal(detectWagerDelegation("you pick the wager"), "all");
  assert.equal(detectWagerDelegation("what do you want if you win"), "all");
  assert.equal(detectWagerDelegation("care to make a wager on the game"), "all");
  assert.equal(detectWagerDelegation("you decide what happens if i win"), "user_win");
  assert.equal(detectWagerDelegation("you decide what happens if you win"), "raven_win");
  assert.equal(detectWagerDelegation("if you win you can pick"), "raven_win");
  assert.equal(detectWagerDelegation("if i win you can pick"), "user_win");
});

test("shared signals detect game and stake cues", () => {
  assert.equal(hasStakeSignal("lets bet on the game"), true);
  assert.equal(isStakeQuestion("do you remember the stakes?"), true);
  assert.equal(isGameChoiceDelegation("you pick"), true);
  assert.equal(isGameStartCue("ok lets start"), true);
  assert.equal(isGameRulesQuestion("how do we play"), true);
  assert.equal(isGameNextPromptQuestion("what now"), true);
  assert.equal(wantsAnotherRound("another round"), true);
});
