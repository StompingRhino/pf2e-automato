// hold (plan-affliction-linger-hold.md, H-A): схема def.holds / def.stageLock в валидаторе и распознавание запрета в тексте недуга. Без Foundry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRule } from "../scripts/rules.mjs";
import { semanticErrors } from "../tools/validate.mjs";
import { parseAffliction, afflictionRule } from "../tools/affliction.mjs";

/* ---------- схема ---------- */

const stg = (conds, o = {}) => ({ duration: { value: 1, unit: "rounds" }, damage: [], conditions: conds, ...o });
const DEF = (o = {}) => ({ name: "Filth Fever", kind: "disease", save: { statistic: "fortitude", dc: 14 }, maxDuration: null,
  stages: [stg([]), stg([{ slug: "sickened", value: 1 }]), stg([{ slug: "sickened", value: 1 }, { slug: "unconscious" }])], ...o });
const rule = (def) => ({ v: 1, onUse: { targets: "selected", challenge: { statistic: "fortitude", dc: { value: 14 }, byDegree: { failure: [{ to: "target", affliction: { stage: 1, def } }] } } } });
const check = (o) => validateRule(rule(DEF(o)));
const keys = (o) => check(o).errors.map((e) => e.key);
const defOf = (o) => check(o).rule.onUse.challenge.byDegree.failure[0].affliction.def;

test("holds: допустимые формы нормализуются (keep — по умолчанию, не пишется), ключи доходят до правила", () => {
  assert.deepEqual(keys({ holds: [{ slug: "sickened" }, { slug: "unconscious", mode: "keep" }] }), []);
  assert.deepEqual(defOf({ holds: [{ slug: "sickened" }, { slug: "unconscious", mode: "keep" }] }).holds, [{ slug: "sickened" }, { slug: "unconscious" }]);
  assert.deepEqual(defOf({ holds: [{ slug: "sickened", mode: "present", from: 2 }] }).holds, [{ slug: "sickened", mode: "present", from: 2 }]);
  assert.deepEqual(defOf({ holds: [{ slug: "sickened", from: 3 }] }).holds, [{ slug: "sickened", from: 3 }]);
  assert.equal(defOf({ holds: [] }).holds, undefined, "пустой список ключа не создаёт");
  assert.equal(defOf({}).holds, undefined);
  assert.equal(defOf({ stageLock: true }).stageLock, true);
  assert.equal(defOf({ stageLock: false }).stageLock, undefined);
  // повторная проверка результата не меняет его
  const once = defOf({ holds: [{ slug: "sickened", mode: "present", from: 2 }], stageLock: true });
  assert.deepEqual(validateRule(rule(once)).rule.onUse.challenge.byDegree.failure[0].affliction.def, once);
});

test("holds: недопустимые формы — afflict.holds / afflict.stageLock", () => {
  for (const bad of [
    "sickened", {}, [{}], [{ slug: "Sickened!" }], [{ slug: 5 }],
    [{ slug: "sickened" }, { slug: "sickened" }],                 // дубль
    [{ slug: "sickened", mode: "hold" }],                         // режим
    [{ slug: "sickened", from: 0 }], [{ slug: "sickened", from: 1.5 }], [{ slug: "sickened", from: 4 }],   // from вне стадий
    [{ slug: "sickened", extra: 1 }],                             // лишний ключ
    Array.from({ length: 7 }, (_, i) => ({ slug: `c${i}` }))      // > 6
  ]) assert.deepEqual(keys({ holds: bad }), ["afflict.holds"], JSON.stringify(bad));
  assert.deepEqual(keys({ stageLock: "yes" }), ["afflict.stageLock"]);
});

test("holds: слаги ENDS_EARLY без UNLINKED не держатся — ошибка; UNLINKED и обёрнутые (clumsy, slowed, paralyzed, fatigued…) можно", () => {
  for (const slug of ["prone", "confused", "fascinated", "restrained", "grabbed", "immobilized", "wounded", "dying"]) assert.deepEqual(keys({ holds: [{ slug }] }), ["afflict.holds"], slug);
  for (const slug of ["frightened", "sickened", "drained", "doomed", "stunned", "unconscious", "clumsy", "enfeebled", "stupefied", "slowed", "paralyzed", "fatigued"]) assert.deepEqual(keys({ holds: [{ slug }] }), [], slug);
});

test("semanticErrors: держимое состояние должно встречаться в стадии с номером ≥ from", () => {
  const refs = { conditions: { sickened: {}, unconscious: {}, drained: {} }, effects: {} };
  const wrap = (o) => validateRule(rule(DEF(o))).rule;
  const sm = (o) => semanticErrors(wrap(o), refs, null).filter((m) => /holds/.test(m));
  assert.deepEqual(sm({ holds: [{ slug: "sickened" }, { slug: "unconscious", from: 3 }] }), []);
  assert.equal(sm({ holds: [{ slug: "drained" }] }).length, 1, "состояния нет ни в одной стадии");
  assert.equal(sm({ holds: [{ slug: "unconscious" }, { slug: "sickened", from: 3 }] }).length, 0);
  assert.equal(sm({ holds: [{ slug: "unconscious", from: 3 }] }).length, 0);
  assert.equal(sm({ stages: [stg([{ slug: "unconscious" }]), stg([]), stg([])], holds: [{ slug: "unconscious", from: 2 }] }).length, 1, "после from состояния уже нет");
});

/* ---------- парсер ---------- */

const condSlug = (u) => (u.includes(".conditionitems.") ? u.split(".").pop() : null);
const C = (slug, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${slug}]{${label ?? slug[0].toUpperCase() + slug.slice(1)}}`;
const SV = `<p><strong>Saving Throw</strong> @Check[fortitude|dc:20]</p>`;
const stage = (n, body) => `<p><strong>Stage ${n}</strong> ${body}</p>`;
const doc = (outside, ...stages) => `${outside ? `<p>${outside}</p>` : ""}${SV}${stages.map((b, i) => stage(i + 1, b)).join("")}`;
const P = (html, o = {}) => parseAffliction(html, { name: "X", traits: ["disease"], condSlug, ...o });

test("hold, состояния: «can't end or be reduced until cured» (Filth Fever, Putrid Plague, Zombie Plague)", () => {
  const h = doc(`The ${C("sickened")} and ${C("unconscious")} conditions from filth fever can't end or be reduced until the disease is cured.`,
    "carrier with no ill effect (1 day)", `${C("sickened", "Sickened 1")} (1 day)`, `${C("sickened", "Sickened 2")} and ${C("unconscious")} (1 day)`);
  assert.deepEqual(P(h).def.holds, [{ slug: "sickened" }, { slug: "unconscious" }]);
  assert.equal(P(h).def.stageLock, undefined);
});

test("hold, состояния: «can't recover from … until cured» (Abyssal Plague, Black Apoxia), «can't be removed while the poison lasts» (Fearweed)", () => {
  const ab = doc(`A creature can't recover from the ${C("drained")} condition until Abyssal plague is cured`, `${C("drained", "Drained 1")} (1 day)`, `${C("drained", "Drained 3")} (1 day)`);
  assert.deepEqual(P(ab).def.holds, [{ slug: "drained" }]);
  const fw = doc(`The ${C("frightened")} condition from fearweed can't be removed while the poison lasts.`, `${C("frightened", "Frightened 1")} (1 round)`, `${C("frightened", "Frightened 2")} (1 round)`);
  assert.deepEqual(P(fw, { traits: ["poison"], kind: "poison" }).def.holds, [{ slug: "frightened", mode: "present" }]);   // «removed» — снять нельзя, снижать до 1 можно
});

test("hold, состояния: «can't be removed until the affliction is removed» — три состояния, включая обёрнутые (Crystal Corruption)", () => {
  const h = doc(`This affliction's ${C("sickened")}, ${C("slowed")}, and ${C("paralyzed")} conditions can't be removed until the affliction itself is removed.`,
    `${C("sickened", "Sickened 1")} (1 day)`, `${C("slowed", "Slowed 1")} (1 day)`, `${C("paralyzed")} (1 day)`);
  assert.deepEqual(P(h).def.holds.map((x) => x.slug), ["sickened", "slowed", "paralyzed"]);
});

test("hold, режимы: «can't reduce … below 1» — present; «don't improve on their own until» — НЕ запрет (Vargouille's Kiss)", () => {
  const bl = doc(`A creature can't reduce its ${C("sickened")} value below 1 while it's taking persistent bleed damage from blister pox`, `${C("sickened", "Sickened 2")} (1 round)`, `${C("sickened", "Sickened 2")} and 1d6 persistent bleed (1 round)`);
  assert.deepEqual(P(bl).def.holds, [{ slug: "sickened", mode: "present" }]);
  const vk = doc(`The ${C("sickened")}, ${C("stupefied")}, and ${C("unconscious")} conditions from Vargouille's Kiss don't improve on their own until the disease is cured.`,
    `${C("sickened", "Sickened 1")} (1 day)`, `${C("stupefied", "Stupefied 1")} (1 day)`, `${C("unconscious")} (1 day)`);
  assert.equal(P(vk).def.holds, undefined);
});

test("batch --only-holds: пишутся только записи с holds/stageLock (долг и partial без запрета — нет)", async () => {
  const { filterWritten } = await import("../tools/affliction-batch.mjs");
  const mk = (aff, group) => ({ group, rule: { onUse: { challenge: { byDegree: { failure: [{ affliction: { def: aff } }] } } } } });
  const h = mk({ holds: [{ slug: "sickened" }] }, "g"), l = mk({ stageLock: true }, "g"), n = mk({}, "g"), o = mk({}, "x"), debt = { rule: null };
  const b = { ok: [n], partial: [h, l, n, o], debt: [debt] };
  assert.deepEqual(filterWritten(b, ["g"], true), [h, l]);
  assert.deepEqual(filterWritten(b, ["g"]), [n, h, l, n, debt]);
});

test("hold, from: Bone Moth's Kiss — запрет в тексте стадии 3 (from: 3)", () => {
  const h = SV + stage(1, `${C("drained", "Drained 1")} and sickened 1 (1 round)`) + stage(2, `${C("drained", "Drained 2")} (1 round)`)
    + stage(3, `${C("drained", "Drained 3")} and can't recover from the drained condition until the disease is cured (1 day)`);
  assert.deepEqual(P(h).def.holds, [{ slug: "drained", from: 3 }]);
});

test("hold, from: фраза после «;» со сроком всего недуга (Azarpal) — без from; фраза внутри стадии — from остаётся", () => {
  const h = SV + stage(1, `${C("sickened", "Sickened 1")} (1 minute)`) + stage(2, `${C("sickened", "Sickened 2")} (1 minute)`)
    + stage(3, `${C("sickened", "Sickened 3")} (1 minute); the sickened condition value caused by azarpal poison cannot be reduced below 1 as long as the poison's duration remains active.`);
  assert.deepEqual(P(h, { traits: ["poison"], kind: "poison" }).def.holds, [{ slug: "sickened", mode: "present" }]);
  const g = SV + stage(1, `${C("drained", "Drained 1")} (1 day)`) + stage(2, `${C("drained", "Drained 2")} (1 day)`)
    + stage(3, `${C("drained", "Drained 3")} and can't recover from the drained condition while the poison's duration remains active (1 day)`);
  assert.deepEqual(P(g, { traits: ["poison"], kind: "poison" }).def.holds, [{ slug: "drained", from: 3 }]);
});

test("не hold: Bloodeye Coffee (fatigued не накладывается стадиями), Najra («damage that can't be recovered»), Blightburn («except by magic»)", () => {
  const bc = SV + stage(1, `+1 item bonus to AC and saves to which you are taking penalties caused by the ${C("fatigued")} condition (10 minutes)`) + stage(2, `${C("stupefied", "Stupefied 1")} (1 hour)`) + stage(3, "can't recover from fatigued (1 day, after which the drug ends)");
  assert.equal(P(bc, { traits: ["poison"], kind: "poison" })?.def.holds, undefined);
  const nj = doc("", `@Damage[1d4[poison]] damage, ${C("fatigued")}, and @Damage[1d4[untyped]] damage that can't be recovered until the creature quenches its thirst (1 round)`, "as stage 1 (1 hour)");
  assert.equal(P(nj, { traits: ["poison"], kind: "poison" })?.def.holds, undefined);
  const bb = doc(`The target can't recover from the disease's ${C("drained")} or ${C("sickened")} condition except by magic.`, `${C("drained", "Drained 1")} (1 day)`, `${C("sickened", "Sickened 1")} (1 day)`);
  assert.equal(P(bb).def.holds, undefined);
});

test("не hold: слаг ENDS_EARLY без UNLINKED (prone) и ограничение, не связанное с состоянием", () => {
  const pr = doc(`The ${C("prone")} condition can't be removed until the disease is cured.`, `${C("prone")} (1 day)`, `${C("prone")} and 1d6 (1 day)`);
  assert.equal(P(pr).def.holds, undefined);
  const mr = doc(`The target can't heal damage from this disease until it is cured.`, `${C("sickened", "Sickened 1")} (1 day)`, `${C("sickened", "Sickened 2")} (1 day)`);
  assert.equal(P(mr).def.holds, undefined);
});

test("stageLock: «can't be reduced below stage 1 … until successfully treated» (Bog Rot, Blackfrost, Cold Rot)", () => {
  for (const t of [
    `This affliction can't be reduced below stage 1, nor can the damage from it be healed, until it's successfully treated with remove curse or a similar effect; the affliction can then be removed as normal for a disease.`,
    `This affliction can't be reduced below stage 1, nor the damage from it healed, until successfully treated with @UUID[Compendium.pf2e.spells-srd.Item.SUKaxVZW2TlM8lu0]{Cleanse Affliction} or a similar effect; the affliction can then be removed as a normal disease.`,
    `This affliction can't be reduced below stage 1, nor can damage from it be healed, until successfully treated with @UUID[Compendium.pf2e.spells-srd.Item.SUKaxVZW2TlM8lu0]{Cleanse Affliction} or a similar effect.`
  ]) {
    const p = P(doc(t, `${C("sickened", "Sickened 1")} (1 day)`, `${C("sickened", "Sickened 2")} (1 day)`));
    assert.equal(p.def.stageLock, true);
    assert.equal(p.def.holds, undefined);
  }
  // Wendigo: «can't recover beyond stage 1 until restored to full HP» — другое условие
  const w = P(doc(`A creature affected by wendigo torment can't recover beyond stage 1 until it has been restored to full HP.`, `${C("sickened", "Sickened 1")} (1 day)`, `${C("sickened", "Sickened 2")} (1 day)`));
  assert.equal(w.def.stageLock, undefined);
});

test("def с holds/stageLock проходит валидатор правила целиком (afflictionRule)", () => {
  const h = doc(`The ${C("sickened")} condition from daylight vapor can't be removed while the poison lasts.`, `${C("sickened", "Sickened 1")} (1 round)`, `${C("sickened", "Sickened 2")} (1 round)`);
  const r = afflictionRule(h, { name: "Daylight Vapor", traits: ["poison"], condSlug });
  assert.ok(r.rule, r.unsure.join("; "));
  assert.deepEqual(r.def.holds, [{ slug: "sickened", mode: "present" }]);
});
