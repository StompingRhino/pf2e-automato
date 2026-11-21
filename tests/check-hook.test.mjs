import test from "node:test";
import assert from "node:assert/strict";

test("check-hook: подписчики по порядку, false — броска нет, сбой подписчика бросок не срывает, повторная подписка игнорируется", async () => {
  const calls = [];
  globalThis.game = { pf2e: { Check: { roll: async (check, ctx) => { calls.push("roll"); return "rolled"; } } }, modules: { get: () => null }, user: { isGM: true } };
  globalThis.ui = { notifications: { warn: () => {} } };
  const hook = await import("../scripts/builtin/check-hook.mjs");
  let block = false;
  const a = async () => { calls.push("a"); };
  const b = async () => { calls.push("b"); throw new Error("x"); };
  const c = async (check) => { calls.push("c"); check.n = 1; if (block) return false; };
  hook.subscribe(a); hook.subscribe(b); hook.subscribe(c); hook.subscribe(a);
  hook.install(); hook.install();
  const check = {};
  assert.equal(await game.pf2e.Check.roll(check, {}), "rolled");
  assert.deepEqual(calls, ["a", "b", "c", "roll"]);
  assert.equal(check.n, 1);
  calls.length = 0; block = true;
  assert.equal(await game.pf2e.Check.roll({}, {}), null);
  assert.deepEqual(calls, ["a", "b", "c"]);
});
