// pf2e: context.origin.actor не может быть null — без источника автором становится цель; нет и цели — context null.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectSource } from "../scripts/builtin/lib.mjs";

test("effectSource: origin.actor без источника = цель; без обоих — context null", () => {
  const c = effectSource({ name: "x", origin: {}, target: { actor: "A.t", token: "T.t" } }).system.context;
  assert.deepEqual([c.origin.actor, c.origin.token, c.target.actor], ["A.t", "T.t", "A.t"]);
  const s = effectSource({ name: "x", origin: { actor: "A.s" }, target: { actor: "A.t", token: "T.t" } }).system.context;
  assert.deepEqual([s.origin.actor, s.origin.token], ["A.s", null]);
  assert.equal(effectSource({ name: "x" }).system.context, null);
});
