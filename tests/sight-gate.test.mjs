import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateRule } from "../scripts/rules.mjs";
import { sees } from "../scripts/sight-gate.mjs";

const ruleWith = (step) => ({ v: 1, onUse: { targets: "selected", apply: [{ to: "target", ...step }] } });
const eff = { effect: { uuid: "Item.effect" } };

test("sees: слепота, стена, невидимость без see-invisibility, hidden и выше — не видит; concealed и see-invisibility — видит", () => {
  assert.equal(sees({}), true);
  assert.equal(sees({ blinded: true }), false);
  assert.equal(sees({ walled: true }), false);
  assert.equal(sees({ subjectConds: ["invisible"] }), false);
  assert.equal(sees({ subjectConds: ["invisible"], seeInvisible: true }), true);
  for (const c of ["hidden", "undetected", "unnoticed"]) assert.equal(sees({ subjectConds: [c] }), false);
  for (const level of ["hidden", "undetected", "unnoticed"]) assert.equal(sees({ level }), false);
  assert.equal(sees({ level: "concealed" }), true);
});

test("gate:\"sight\" — только у effect с sustain:true", () => {
  const ok = validateRule(ruleWith({ ...eff, sustain: true, gate: "sight" }));
  assert.equal(ok.ok, true, ok.errors?.join("; "));
  assert.equal(ok.rule.onUse.apply[0].gate, "sight");
  for (const bad of [{ ...eff, gate: "sight" }, { ...eff, sustain: true, gate: "hearing" }, { condition: { slug: "sickened" }, sustain: true, gate: "sight" }])
    assert.ok(validateRule(ruleWith(bad)).errors.some((e) => e.key === "apply.gate"));
});

test("Evil Eye: минимум-эффект с gate sight, ручной заметки нет", () => {
  const e = JSON.parse(readFileSync(new URL("../rules/catalog.json", import.meta.url), "utf8")).bySource["Compendium.pf2e.spells-srd.Item.f45JpY7Ph2cAJGW2"];
  for (const steps of Object.values(e.onUse.challenge.byDegree)) {
    assert.equal(steps.find((s) => s.effect).gate, "sight");
    assert.equal(steps.some((s) => s.note), false);
  }
});

test("sight-gate shouldRestore: откаченная карточка, снятое целью состояние — не возвращать; карточки нет — возвращать", async () => {
  const { shouldRestore } = await import("../scripts/sight-gate.mjs");
  const uuid = "Actor.g.Item.e1";
  assert.equal(shouldRestore({ card: { apply: { t: { ops: [{ op: "created", item: uuid }] } } }, uuid }), true);
  assert.equal(shouldRestore({ card: { apply: {} }, uuid }), false);                       // откат удалил запись цели
  assert.equal(shouldRestore({ card: null, uuid }), true);                                  // карточку убрала чистка чата
  assert.equal(shouldRestore({ card: null, uuid, held: ["sickened"], has: () => false }), false);   // цель сама сняла тошноту
  assert.equal(shouldRestore({ card: null, uuid, held: ["sickened"], has: () => true }), true);
});
