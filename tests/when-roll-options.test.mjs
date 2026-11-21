import { test } from "node:test";
import assert from "node:assert/strict";
import { testPredicate } from "../scripts/predicate.mjs";
import { whenOptions } from "../scripts/apply.mjs";

const msg = (options) => ({ flags: { pf2e: { context: { options } } } });
const when = ["check:statistic:thievery"];
const run = async (kind, options, extra = {}) => testPredicate(when, await whenOptions({ use: { kind, targets: [] }, message: msg(options), ...extra }));

test("when: опции броска (check:statistic:*) видны только записи kind=roll", async () => {
  assert.equal(await run("roll", ["check:statistic:thievery", "action:disarm"]), true);
  assert.equal(await run("roll", ["check:statistic:athletics"]), false);
  assert.equal(await run("use", ["check:statistic:thievery"]), false);
});

test("when: target:* из сообщения не подмешивается", async () => {
  const o = await whenOptions({ use: { kind: "roll", targets: [] }, message: msg(["target", "target:trait:undead", "action:disarm"]) });
  assert.equal(o.has("action:disarm"), true);
  assert.equal(o.has("target"), false);
  assert.equal(o.has("target:trait:undead"), false);
});

test("when: опции актёра по-прежнему работают у roll", async () => {
  const selfActor = { getRollOptions: () => ["feat:sly-disarm"] };
  const o = await whenOptions({ use: { kind: "roll", targets: [] }, message: msg([]), selfActor });
  assert.equal(testPredicate(["feat:sly-disarm"], o), true);
});
