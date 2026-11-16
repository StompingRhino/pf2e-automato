// Записи M4 (контрзаклинания без траты ячейки) в rules/catalog.counterspell.json: валидатор, round-trip формы, значения против описаний (tools/out/items.json, если он есть). Без Foundry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

globalThis.game ??= {};
globalThis.foundry ??= { data: { regionBehaviors: { RegionBehaviorType: class {} }, fields: new Proxy({}, { get: () => class {} }) }, utils: { deepClone: (o) => structuredClone(o) } };
globalThis.CONFIG ??= { PF2E: {} };
const rules = await import("../scripts/rules.mjs");
const { ruleToForm, formToRule } = await import("../scripts/sheet.mjs");

const all = JSON.parse(readFileSync(new URL("../rules/catalog.counterspell.json", import.meta.url), "utf8")).bySource;
const counters = Object.entries(all).filter(([, r]) => r.onEvent?.some((e) => e.counter));
const mine = counters.filter(([, r]) => !r.onEvent[0].counter.expend);   // фаза 1: без траты ячейки
const slotted = counters.filter(([, r]) => r.onEvent[0].counter.expend);   // фаза 2 (M4.9): с тратой
const byLabel = (l) => mine.filter(([, r]) => r.label === l).map(([, r]) => r.onEvent[0]);

test("catalog.counterspell.json: 20 записей (без Bloodstone Doll и Reflect Spell), validateRule ок, round-trip формы без потерь", () => {
  assert.equal(mine.length, 20);
  for (const gone of ["Bloodstone Doll (Minor)", "Bloodstone Doll (Moderate)", "Bloodstone Doll (Major)", "Reflect Spell"]) assert.equal(byLabel(gone).length, 0, gone);
  for (const [u, r] of mine) {
    const v = rules.validateRule(r);
    assert.ok(v.ok, `${u}: ${JSON.stringify(v.errors)}`);
    const back = rules.validateRule(formToRule(ruleToForm(v.rule)));   // форма добавляет пустой apply
    assert.ok(back.ok, u);
    assert.deepEqual(back.rule.onEvent.map(({ apply, ...e }) => e), v.rule.onEvent.map(({ apply, ...e }) => e), `${u}: round-trip`);
    assert.deepEqual(JSON.parse(JSON.stringify(v.rule.onEvent).replace(/,"policy":"max"/g, "")), r.onEvent, `${u}: валидатор ничего не теряет в записи`);   // policy:"max" — умолчание состояния
  }
  assert.deepEqual(rules.buildCatalog([{ v: 1, bySource: all }]).errors, []);
});

test("каталог: дальность без ограничения — только явное range \"any\" (Devour, Absorb, Hateful), остальные — числом; костыля 1000 нет", () => {
  const any = mine.filter(([, r]) => r.onEvent[0].range === "any").map(([, r]) => r.label).sort();
  assert.deepEqual(any, ["Absorb into the Aegis", "Devour Ambient Magic", "Hateful Counteract"]);
  assert.ok(mine.every(([, r]) => r.onEvent[0].range === "any" || Number.isFinite(r.onEvent[0].range)));
  assert.equal(mine.some(([, r]) => r.onEvent[0].range >= 1000), false);
});

test("каталог: иммунитет по несрыву — Denounce ×3, Chastise ×2, Ravage; степени в записи не заданы (их считает run), срок 24 ч, scope slug", () => {
  const withImm = mine.filter(([, r]) => r.onEvent[0].counter.immunity).map(([, r]) => r.label);
  assert.deepEqual(withImm.sort(), ["Chastise Heretic", "Chastise Heretic", "Denounce Heretic", "Denounce Heretic", "Denounce Heretic", "Ravage Heretic"]);
  for (const [, r] of mine) {
    const im = r.onEvent[0].counter.immunity;
    if (im) assert.deepEqual([im.scope, im.duration, im.degrees], ["slug", { value: 24, unit: "hours" }, undefined], r.label);
  }
});

test("каталог: тип урона Chastise Heretic — по тексту: void у иерофанта, mental у Xin Yue; Hateful — 2×ранг ментальный; Seize Prayer — срыв, урон обоим и заметка", () => {
  const [a, b] = mine.filter(([, r]) => r.label === "Chastise Heretic").map(([, r]) => r.onEvent[0].counter.onCounter[0]);
  assert.deepEqual([a.persistent.damageType, b.persistent.damageType, a.persistent.formula], ["void", "mental", "1d10"]);
  assert.deepEqual(byLabel("Hateful Counteract")[0].counter.onCounter, [{ to: "target", damage: { formula: "(2*@item.rank)", damageType: "mental" } }]);
  const sp = byLabel("Seize Prayer")[0].counter.onCounter;
  assert.deepEqual(sp.map((s) => s.to), ["target", "self", "self"]);
  assert.ok(sp[0].damage && sp[1].damage && sp[2].note);
  assert.deepEqual(byLabel("Ravage Heretic")[0].counter.onCounter, [{ to: "target", condition: { slug: "stunned", value: 3 } }]);
});

test("каталог: Shred Spell — заметка про погасшую ауру только на крит. провале; Devour — массив навыков", () => {
  const sh = byLabel("Shred Spell")[0].counter;
  assert.deepEqual(sh.onFail.map((s) => s.when), [["outcome:criticalFailure"]]);
  assert.deepEqual(byLabel("Devour Ambient Magic")[0].counter.statistic, ["arcana", "nature"]);
});

// значения — из описаний предметов (CLAUDE.md §1.2); items.json не в репозитории, без него проверка пропускается
const itemsPath = new URL("../tools/out/items.json", import.meta.url);
test("каталог против descEn: модификатор, ранг, частота, иммунитет, урон", { skip: !existsSync(itemsPath) }, () => {
  const items = new Map(JSON.parse(readFileSync(itemsPath, "utf8")).items.map((i) => [i.uuid, i]));
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
  for (const [u, r] of mine) {
    const it = items.get(u), d = it?.descEn ?? "", c = r.onEvent[0].counter;
    assert.ok(it, `${r.label}: нет в items.json`);
    if (c.mod != null) assert.ok(d.includes(`+${c.mod}`), `${r.label}: модификатор ${c.mod}`);
    if (Number.isInteger(c.rank)) assert.ok(new RegExp(`counteract rank (?:of )?(?:${c.rank}|${ord[c.rank]})`).test(d) || /counteract rank is \d/.test(d) && d.includes(`rank is ${c.rank}`), `${r.label}: ранг ${c.rank}`);
    if (c.rank?.half) assert.ok(/half (?:your|the \w+'s|their) level|half/i.test(d) || !/counteract rank/.test(d), `${r.label}: ранг — половина уровня`);
    if (c.immunity) assert.ok(/immune/.test(d) && /24 hours/.test(d), `${r.label}: иммунитет`);
    assert.equal(it.frequency ?? null, r.label === "Devour Ambient Magic" || r.label === "Hateful Counteract" ? "1/day" : null, `${r.label}: частота`);
    for (const s of c.onCounter ?? []) {
      if (s.persistent) assert.ok(d.includes(`${s.persistent.formula}[persistent,${s.persistent.damageType}]`), `${r.label}: продолжительный урон`);
      if (s.condition) assert.ok(new RegExp(`${s.condition.slug} ${s.condition.value}`, "i").test(d), `${r.label}: состояние`);
    }
  }
});

/* ---------- M4.9: группа «контрзаклинание с тратой ячейки» ---------- */

const bySlotLabel = (l) => slotted.filter(([, r]) => r.label === l).map(([, r]) => r.onEvent[0]);
const SLOT_EXCLUDED = new Set(["Intercession Spell", "Rewrite Fate", "Catharsis Emotion", "Stolen Spell", "Mythic Counterspell", "Recognize Spell", "Foreseen Failure", "Rebounding Smite", "Ward Casting", "Retain Absorbed Spell", "Battlefield Arcana",
  "Divine Weapon", "Divine Weapon of Milani", "Second Thoughts", "Surging Interference", "Interfering Surge", "Absorb Spell", "Vermillion Threads", "Imbue Spell", "Sustaining Steel", "Accompany", "Tempest-Sun Shielding", "Belimarius's Invidious Halberd",
  "Conflagration Club", "Reflect Spell", "Rightfully Mine", "Adaptive Rune Magic"]);   // тратят ячейку/подготовленное по другому поводу или другим механизмом (долг: Mythic, Interfering Surge, Reflect Spell)

test("каталог M4.9: 30 записей с expend, валидатор и round-trip без потерь, у всех when origin:enemy, проверка без mod/statistic — counteraction записи", () => {
  assert.equal(slotted.length, 30);
  for (const [u, r] of slotted) {
    const v = rules.validateRule(r);
    assert.ok(v.ok, `${u}: ${JSON.stringify(v.errors)}`);
    const e = r.onEvent[0], c = e.counter;
    assert.ok(e.when.includes("origin:enemy"), `${r.label}: «foe/creature Casts» — только враги, иначе окно и ячейка уходят на каждое сотворение союзников`);
    if (c.mod == null && c.statistic == null) assert.equal(c.rank, undefined, `${r.label}: ранг — ранг ячейки`);
    const back = rules.validateRule(formToRule(ruleToForm(v.rule)));
    assert.deepEqual(back.rule.onEvent.map(({ apply, ...x }) => x), v.rule.onEvent.map(({ apply, ...x }) => x), `${u}: round-trip`);
    assert.deepEqual(JSON.parse(JSON.stringify(v.rule.onEvent).replace(/,"policy":"max"/g, "")), r.onEvent, `${u}: валидатор ничего не теряет`);
  }
  assert.deepEqual(rules.buildCatalog([{ v: 1, bySource: all }]).errors, []);
});

test("каталог M4.9: условие триггера отдельно от траты — «знает/подготовил» в when, тратится любая ячейка (Sephone, King of Biting Ants, Delvarnis)", () => {
  const withKnow = slotted.filter(([, r]) => r.onEvent[0].when.some((w) => /spell-cast:(prepared|known)/.test(w))).map(([, r]) => r.onEvent[0]);
  assert.equal(withKnow.length, 3);
  for (const e of withKnow) assert.equal(e.counter.expend.spell, "any", "условие — в when, а не в том, что тратится");
  assert.deepEqual(withKnow.map((e) => e.when.find((w) => /spell-cast:/.test(w))).sort(), ["spell-cast:known", "spell-cast:known", "spell-cast:prepared"]);
  const [delv] = bySlotLabel("Counterspell").filter((e) => e.counter.mod === 18);
  assert.deepEqual([delv.counter.expend.rank, delv.counter.mod], ["same", 18], "Delvarnis: «slot of the same level», +18");
  assert.deepEqual(bySlotLabel("Master's Counterspell")[0].counter.expend, { spell: "any", rank: "min" }, "Master's: любая ячейка не ниже ранга, from не задан (подготовленный и спонтанный)");
  assert.equal(bySlotLabel("Master's Counterspell")[0].when.length, 1, "«that you have prepared» у Master's — текст окна, а не when (спонтанному такое условие не подходит)");
});

test("каталог M4.9: Life to Unlife — ранг ячейки равен рангу сорванного (контр-ранг закреплён), Религия, 30 фт, divine+healing; Escape — не ниже и телепортация; Scoff — dispel-magic; Counter Thought — mental", () => {
  const [life] = bySlotLabel("Life to Unlife");
  assert.deepEqual(life.counter.expend, { from: "prepared", spell: "any", rank: "same" });
  assert.equal(life.counter.statistic, "religion");
  assert.equal(life.range, 30);
  assert.deepEqual(life.when, ["origin:enemy", "origin:item:trait:divine", "origin:item:trait:healing"]);
  const [esc] = bySlotLabel("Counter Escape");
  assert.deepEqual([esc.counter.mod, esc.counter.expend, esc.when.at(-1)], [11, { spell: "any", rank: "min" }, "origin:item:trait:teleportation"]);
  const scoff = bySlotLabel("Scoff at the Divine");
  assert.equal(scoff.length, 3);
  for (const s of scoff) assert.deepEqual([s.counter.expend, s.range, s.when.at(-1)], [{ spell: { slug: "dispel-magic" } }, 30, "origin:item:trait:divine"]);
  assert.deepEqual(bySlotLabel("Counter Thought")[0].counter.expend, { spell: { trait: "mental" } });
  assert.deepEqual(bySlotLabel("Flexible Counterspell")[0].counter, { mod: 27, expend: { from: "prepared", spell: "any", rank: "min" } });
  assert.deepEqual(bySlotLabel("Spellstealing Counter").map((e) => [e.counter.mod, e.counter.expend]), [[35, { spell: "any", rank: "same" }], [35, { spell: "any", rank: "same" }]]);
  assert.equal(bySlotLabel("Counterspell (Spontaneous)").length, 2);
  for (const e of bySlotLabel("Counterspell (Spontaneous)")) assert.deepEqual(e.counter.expend, { from: "slot", spell: "same" });
  assert.equal(bySlotLabel("Counterspell (Prepared)").length, 2);
});

test("каталог M4.9 против descEn: вся группа «Trigger … cast + expend + (spell slot | prepared spell)» покрыта записью с expend или названа исключением; тексты записей не расходятся", { skip: !existsSync(itemsPath) }, () => {
  const strip = (s) => s.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const group = JSON.parse(readFileSync(itemsPath, "utf8")).items.filter((i) => {
    if (i.type === "spell" || i.type === "equipment") return false;
    const t = strip(i.descEn ?? ""), tr = /Trigger\s*([^]*?)(?:Requirements|Effect|Frequency|$)/i.exec(t);
    return tr && /cast/i.test(tr[1]) && /expend/i.test(t) && /slot|prepared/i.test(t);
  });
  const missing = group.filter((i) => !all[i.uuid]?.onEvent?.[0]?.counter?.expend && !SLOT_EXCLUDED.has(i.name));
  assert.deepEqual(missing.map((i) => `${i.name} ${i.uuid}`), [], "в группе появились документы без записи expend и не из списка исключений");
  assert.equal(group.filter((i) => all[i.uuid]?.onEvent?.[0]?.counter?.expend).length, 30);
  for (const [u, r] of slotted) {
    const t = strip(group.find((i) => i.uuid === u)?.descEn ?? ""), c = r.onEvent[0].counter, x = c.expend;
    assert.ok(t, `${r.label}: нет в группе по описанию`);
    if (c.mod != null) assert.ok(t.includes(`+${c.mod}`), `${r.label}: модификатор`);
    if (x.from === "prepared") assert.ok(/expends? (?:any |a )?prepared spell/i.test(t), `${r.label}: подготовленное`);
    if (x.from === "slot") assert.ok(/spell slots?/i.test(t) && !/expends? (?:any |a )?prepared spell/i.test(t), `${r.label}: ячейка`);
    if (x.spell === "same") assert.ok(/(that|the) same spell|you could use to cast the triggering spell|spell in its repertoire/i.test(t), `${r.label}: то же заклинание`);
    if (x.rank === "same") assert.ok(/same (?:rank|level)/i.test(t), `${r.label}: тот же ранг`);
    if (x.rank === "min") assert.ok(/same (?:rank |level )?or higher|at least as high|equal or greater/i.test(t), `${r.label}: не ниже`);
    if (r.onEvent[0].when.includes("spell-cast:known")) assert.ok(/knows/i.test(t), r.label);
    if (r.onEvent[0].when.includes("spell-cast:prepared")) assert.ok(/has prepared/i.test(t), r.label);
  }
});
