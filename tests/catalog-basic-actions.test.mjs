import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cat = JSON.parse(readFileSync(new URL("../rules/catalog.json", import.meta.url), "utf8"));
const ACTIONS = "Compendium.pf2e.actionspf2e.Item.";

// Базовые действия живут в двух копиях: bySource (по uuid) и bySlug (для NPC). Копии не должны расходиться.
test("копии базовых действий bySource/bySlug совпадают", () => {
  let n = 0;
  for (const [uuid, src] of Object.entries(cat.bySource)) {
    if (!uuid.startsWith(ACTIONS)) continue;
    const twin = Object.entries(cat.bySlug).filter(([, v]) => v.label === src.label && v.onUse?.check?.options?.[0] === src.onUse?.check?.options?.[0]);
    assert.ok(twin.length >= 1, `нет копии bySlug для ${src.label}`);
    for (const [slug, v] of twin) { assert.deepEqual(v.onUse, src.onUse, `${slug} расходится с ${uuid}`); n++; }
  }
  assert.ok(n >= 5, `сверено копий: ${n}`);
});

test("Trip: крит. успех наносит 1d6 дробящего шагом damage", () => {
  const crit = cat.bySlug.trip.onUse.check.byDegree.criticalSuccess;
  assert.ok(crit.some((s) => s.damage?.formula === "1d6" && s.damage.damageType === "bludgeoning"));
});

test("Disarm: Хитрое разоружение — шаги с when по черте и статистике Воровства, обе копии одинаковы", () => {
  const by = (r) => r.onUse.check.byDegree;
  for (const r of [cat.bySource[ACTIONS + "Dt6B1slsBy8ipJu9"], cat.bySlug.disarm]) {
    for (const d of ["criticalSuccess", "success"]) {
      const st = by(r)[d].filter((s) => s.when?.includes("feat:sly-disarm"));
      assert.equal(st.length, 2, d);
      assert.ok(st.every((s) => s.when.includes("check:statistic:thievery")));
      assert.equal(st.find((s) => s.condition).condition.slug, "off-guard");
    }
  }
});

test("Деморализация: заметка Unrelenting Terror без придуманного названия; Финт: заметка «застигнута врасплох» — текст плана (без when, иначе шёпот при каждом Финте)", () => {
  const txt = (r, d) => r.onUse.check.byDegree[d].filter((s) => s.note);
  for (const r of [cat.bySource[ACTIONS + "2u915NdUyQan6uKF"], cat.bySlug.demoralize]) {
    for (const d of ["criticalSuccess", "success"]) { const n = txt(r, d); assert.equal(n.length, 1); assert.ok(!/Неумолим/.test(n[0].note)); }
  }
  for (const r of [cat.bySource[ACTIONS + "QNAVeNKtHA0EUw4X"], cat.bySlug.feint]) {
    for (const d of ["criticalSuccess", "success"]) {
      const n = txt(r, d).find((s) => s.note.startsWith("Цель застигнута врасплох"));
      assert.equal(n.when, undefined, d);
    }
  }
});
