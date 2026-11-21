// К3 plan-rustyspirit-gaps: sustain:true у поддерживаемых заклинаний (список A), Форма тёмного леса (этап 1), список B не тронут.
import { test } from "node:test";
import assert from "node:assert/strict";

const { SUSTAIN_A, SUSTAIN_B, report, loadMerged, stepsOf } = await import("../tools/sustain-gaps.mjs");
const { validateRule } = await import("../scripts/rules.mjs");

const rows = report();

test("sustain: каждый документ списка A (с шагом effect/condition) имеет шаг sustain:true", () => {
  for (const slug of SUSTAIN_A) {
    const mine = rows.filter((r) => r.slug === slug);
    assert.ok(mine.length, `${slug}: нет документов`);
    for (const r of mine) assert.ok(r.hasSustain, `${slug} (${r.uuid}) без sustain`);
  }
});

test("sustain: список B не получил sustain (кроме явных решений)", () => {
  for (const r of rows.filter((r) => SUSTAIN_B.includes(r.slug))) assert.equal(r.hasSustain, false, r.slug);
});

test("sustain: собранный каталог без ошибок валидации", () => {
  assert.deepEqual(loadMerged().errors, []);
});

test("sustain: у состояний с sustain есть срок (валидатор)", () => {
  const c = loadMerged();
  for (const r of rows.filter((r) => SUSTAIN_A.includes(r.slug))) {
    const rule = c.bySource.get(r.uuid) ?? c.bySlug.get(r.slug);
    assert.ok(validateRule(JSON.parse(JSON.stringify(rule))).ok, r.slug);
  }
});

test("Форма тёмного леса: выбор формы по кругу и три шага sustain", () => {
  const rule = loadMerged().bySource.get("Compendium.pf2e.spells-srd.Item.BhJtCTLbngvZm8EA");
  assert.ok(rule);
  const steps = rule.onUse.apply;
  const choose = steps.find((s) => s.choose).choose;
  assert.deepEqual(choose.options.map((o) => o.value), ["pest", "animal", "elemental"]);
  // ранг сотворения — из origin сообщения (origin:item:rank:N): предмет актёра — базовый, его item:rank:1 при усилении не меняется
  assert.deepEqual(choose.options.map((o) => o.when?.[0]?.gte?.[0]), [undefined, "origin:item:rank", "origin:item:rank"]);
  const forms = steps.filter((s) => s.effect);
  assert.equal(forms.length, 3);
  assert.ok(forms.every((s) => s.sustain === true && s.to === "self"));
  assert.deepEqual(forms.map((s) => s.when[0]), ["choice:pest", "choice:animal", "choice:elemental"]);
  assert.deepEqual(forms.map((s) => s.rank?.min ?? 1), [1, 2, 5]);
  assert.ok(stepsOf(rule).hasSustain);
});
