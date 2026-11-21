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

test("when: круг сотворения заменяет круг заклинания с листа (Форма тёмного леса на круге 2)", async () => {
  const originItem = { type: "spell", getRollOptions: () => ["item:rank:1", "item:trait:polymorph"] };
  const message = { flags: { pf2e: { origin: { castRank: 2, rollOptions: ["origin:item:rank:1"] } } } };
  const o = await whenOptions({ use: { kind: "use", targets: [] }, message, originItem });
  assert.deepEqual([...o].filter((x) => /rank/.test(x)).sort(), ["item:rank:2", "origin:item:rank:2"]);
  assert.equal(testPredicate([{ gte: ["origin:item:rank", 2] }], o), true);
  assert.equal(testPredicate([{ gte: ["item:rank", 5] }], o), false);
  const noCast = await whenOptions({ use: { kind: "use", targets: [] }, message: { flags: {} }, originItem });
  assert.equal(noCast.has("item:rank:1"), true);   // без castRank — как было
});
