// Мастерская: поля недуга holds/stageLock — правка ядром и круг форма -> правило без потерь.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as af from "../scripts/workshop/affliction-edit.mjs";

const mk = () => {
  const f = { kind: "onUse", apply: [{ kind: "note" }] }, row = {};
  af.afflInit(row, f);
  f.apply.push(row);
  return { f, row, def: () => JSON.parse(row.text).def };
};

test("holds и stageLock: правка, режим, стадия, снятие", () => {
  const { f, row, def } = mk();
  af.afflSet(f, row, "holds.add", "sickened");
  af.afflSet(f, row, "holds.add", "sickened");   // дубль не добавляется
  af.afflSet(f, row, "holds.add", "drained");
  assert.deepEqual(def().holds, [{ slug: "sickened" }, { slug: "drained" }]);
  af.afflSet(f, row, "holds.1.mode", "present");
  af.afflSet(f, row, "holds.1.from", "3");
  af.afflSet(f, row, "holds.1.slug", "sickened");   // занято — не меняется
  assert.deepEqual(def().holds[1], { slug: "drained", mode: "present", from: 3 });
  af.afflSet(f, row, "holds.1.mode", "keep");
  af.afflSet(f, row, "holds.1.from", "");
  assert.deepEqual(def().holds[1], { slug: "drained" });
  af.afflSet(f, row, "stageLock", true);
  assert.equal(def().stageLock, true);
  const v = af.afflView(f, row, { t: (k) => k, damageLabel: (x) => x, conditionLabel: (x) => x });
  assert.deepEqual(v.holds.map((h) => [h.slug, h.mode, h.from]), [["sickened", "keep", ""], ["drained", "keep", ""]]);
  assert.equal(v.stageLock, true);
  af.afflOp(f, row, "holdRm:0");
  af.afflOp(f, row, "holdRm:0");
  af.afflSet(f, row, "stageLock", false);
  assert.ok(!("holds" in def()) && !("stageLock" in def()));
});

test("holds: добавление ограничено шестью", () => {
  const { f, row, def } = mk();
  for (const s of ["sickened", "drained", "doomed", "stunned", "frightened", "unconscious", "slowed"]) af.afflSet(f, row, "holds.add", s);
  assert.equal(def().holds.length, 6);
});

test("stageRm сдвигает holds[].from; from=1 исчезает; from за пределами стадий убирает запись", () => {
  const { f, row, def } = mk();
  while (def().stages.length < 4) af.afflOp(f, row, "stageAdd");
  af.afflSet(f, row, "holds.add", "drained");
  af.afflSet(f, row, "holds.0.from", "3");
  af.afflOp(f, row, "stageRm:2");   // удалена сама стадия 3 (from): её место заняла стадия 4 — from тот же
  assert.equal(def().holds[0].from, 3);
  af.afflOp(f, row, "stageAdd");
  af.afflOp(f, row, "stageRm:0");   // удалена стадия 1 < 3
  assert.equal(def().holds[0].from, 2);
  af.afflOp(f, row, "stageRm:2");   // удалена стадия 3 > from — from на месте
  assert.equal(def().holds[0].from, 2);
  af.afflOp(f, row, "stageRm:0");   // from 2 -> 1 (по умолчанию, поле убирается)
  assert.deepEqual(def().holds, [{ slug: "drained" }]);
  const g = mk();
  while (g.def().stages.length < 3) af.afflOp(g.f, g.row, "stageAdd");
  af.afflSet(g.f, g.row, "holds.add", "drained");
  af.afflSet(g.f, g.row, "holds.0.from", "3");
  const d = JSON.parse(g.row.text); d.def.stages.length = 2; g.row.text = JSON.stringify(d);   // from уже вне стадий
  af.afflOp(g.f, g.row, "stageRm:0");
  assert.equal(g.def().holds, undefined);
});
