// «Изменить выбор» при Поддержании (plan-sustain-reshape.md): валидатор, чистые функции, шёпот, reshapeRun, откаты.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOD } from "../scripts/util.mjs";
import { validateRule } from "../scripts/rules.mjs";
import * as sustain from "../scripts/sustain.mjs";
import { undoOps, hasOwnChoice, optionsOf } from "../scripts/apply.mjs";

globalThis.foundry = { data: { regionBehaviors: { RegionBehaviorType: class {} }, fields: new Proxy({}, { get: () => class {} }) }, utils: {} };   // zone.mjs берёт базовые классы при импорте
const { reshapeRule, reshapeChoices, reshapeMoment, onReshape, reshapeRun, onCreateMessage } = await import("../scripts/use.mjs");

const KEY = sustain.anchorKey("M1");
const PEST = "Compendium.pf2e.spell-effects.Item.ydsLEGjY89Akc4oZ", ANIMAL = "Compendium.pf2e-automato.effects.Item.h68Fr3fht1319txv";
const cat = JSON.parse(readFileSync(new URL("../rules/catalog.json", import.meta.url), "utf8"));
const DFF = cat.bySource["Compendium.pf2e.spells-srd.Item.BhJtCTLbngvZm8EA"];
const settings = {}, registry = new Map();
let msgs, sent, world, n, flags, pid = 0;
const setDeep = (o, path, v) => { const ks = path.split("."), last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };
const getDeep = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const merge = (a, b) => { for (const [k, v] of Object.entries(b ?? {})) a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] && typeof a[k] === "object" ? a[k] : {}, v) : v; return a; };
const tick = () => new Promise((r) => setTimeout(r, 20));

function mkActor(uuid) {
  const items = [];
  items.has = (id) => items.some((i) => i.id === id);
  const actor = {
    uuid, name: uuid, items, getActiveTokens: () => [{ uuid: `Tok.${uuid}` }], getRollOptions: () => [],
    async createEmbeddedDocuments(_, datas) {
      const out = [];
      for (const d of datas) {
        if (flags.blockNew && d._stats?.compendiumSource === flags.blockNew) continue;   // pf2e выкинул документ (иммунитет)
        const it = { ...structuredClone(d), id: `${uuid}.i${++n}`, uuid: `${uuid}.Item.i${n}`, actor, isExpired: false };
        it.update = async (ch) => { for (const [p, v] of Object.entries(ch)) setDeep(it, p, v); };
        it.toObject = () => { const { actor: _a, update: _u, delete: _d, toObject: _t, ...rest } = it; return structuredClone(rest); };
        it.delete = async (opts) => { items.splice(items.indexOf(it), 1); registry.delete(it.uuid); await sustain.onDeleteItem(it, opts); };
        registry.set(it.uuid, it); items.push(it); out.push(it);
      }
      return out;
    },
    get itemTypes() { return { condition: items.filter((i) => i.type === "condition"), effect: items.filter((i) => i.type === "effect") }; }
  };
  registry.set(uuid, actor);
  return actor;
}

const effectDoc = (name, rules = []) => ({ type: "effect", name, toObject: () => ({ name, type: "effect", system: { rules: structuredClone(rules), context: {}, level: { value: 1 }, duration: { value: 1, unit: "minutes" } }, flags: {}, _stats: {} }) });
const spell = { type: "spell", name: "Форма леса (лист)", slug: "darkened-forest-form", uuid: "Item.s", img: "s.svg", rank: 1, system: { duration: { value: "1 minute", sustained: true }, traits: { value: [] } }, getRollOptions: (p) => [`${p}:rank:1`], spellcasting: { statistic: { dc: { value: 21 } } } };

function mkMsg(id, extra = {}) {
  const m = { id, flags: {}, ...extra, async update(d) { for (const [p, v] of Object.entries(d)) setDeep(this, p, v); }, async delete() { msgs.delete(id); } };
  msgs.set(id, m); return m;
}

function setup() {
  registry.clear(); sent = []; n = 0; msgs = new Map(); flags = {}; world = { combat: { id: "c1", round: 2, combatant: null } };
  Object.assign(settings, { "mode.effect": "button", "mode.challenge": "button", "mode.zone": "auto", "mode.macro": "off" });
  globalThis.game = {
    modules: { get: () => null }, user: { isActiveGM: true, isGM: true, id: "gm" }, users: [{ id: "gm", isGM: true }],
    i18n: { localize: (k) => k, format: (k) => k, has: () => false }, settings: { get: (_m, k) => settings[k] },
    get combat() { return world.combat; },
    messages: { get: (id) => msgs.get(id), find: (fn) => [...msgs.values()].find(fn), get contents() { return [...msgs.values()]; } },
    scenes: { contents: [], get: () => null },
    pf2e: { actions: { get: () => ({ use: async () => {} }) } }
  };
  Object.defineProperty(game, "combats", { configurable: true, get: () => Object.assign(world.combat ? [{ ...world.combat, combatants: [{ actor: registry.get("Actor.a") }] }] : [], { get: (id) => (world.combat?.id === id ? { ...world.combat, combatant: world.combat.combatant } : null) }) });
  globalThis.foundry = { utils: { getProperty: getDeep, setProperty: setDeep, deepClone: (o) => structuredClone(o), mergeObject: (a, b) => merge(a, b) } };
  globalThis.CONFIG = { PF2E: { Item: { documentClasses: { effect: { validTraits: {} } } } } };
  globalThis.fromUuid = async (u) => registry.get(u) ?? null;
  globalThis.fromUuidSync = (u) => registry.get(u) ?? null;
  globalThis.ChatMessage = {
    getSpeaker: () => ({}), deleteDocuments: async (ids) => { for (const id of ids) msgs.delete(id); },
    create: async (d) => { const m = mkMsg(`P${++pid}`, structuredClone(d)); sent.push(m); onCreateMessage(m); return m; }   // как хук createChatMessage: исполнение без ожидания
  };
  globalThis.ui = { notifications: { warn: (t) => sent.warns?.push(t) } };
  registry.set("Item.s", spell);
  registry.set(PEST, effectDoc("Pest Form")); registry.set(ANIMAL, effectDoc("Animal Form"));
}
const teardown = () => { for (const k of ["game", "foundry", "fromUuid", "fromUuidSync", "ChatMessage", "ui", "CONFIG"]) delete globalThis[k]; };

const rule = () => validateRule(structuredClone(DFF)).rule;

/** Сотворение R2 уже исполнено: якорь на авторе и эффект Pest Form с привязкой (как после applyOps), сообщение M1 с ops. */
async function scene({ rank = 2, last = { combat: "c1", round: 2 } } = {}) {
  setup();
  sent.warns = [];
  const author = mkActor("Actor.a");
  const { item: anchor } = await sustain.attach(author, author, { key: KEY, msg: "M1", item: spell, at: last });
  const [pest] = await author.createEmbeddedDocuments("Item", [{ ...effectDoc("Pest Form").toObject(), flags: { [MOD]: { meta: { key: "M1:self:1", source: "apply", message: "M1", sustainOf: KEY, sustainBy: author.uuid } } }, _stats: { compendiumSource: PEST } }]);
  mkMsg("M1", { flags: { pf2e: { origin: { castRank: rank } }, [MOD]: { use: { v: 1, kind: "use", rule: rule(), actor: author.uuid, token: null, item: { uuid: "Item.s", name: spell.name, type: "spell" }, targets: [], state: { apply: { self: { ops: [
    { op: "chose", key: "M1:self:0", value: "pest" }, { op: "created", item: pest.uuid }, { op: "anchor", item: anchor.uuid, actor: author.uuid, key: KEY }] } } } } } } });
  return { author, anchor, pest };
}
const bound = (a) => a.items.filter((i) => i.flags?.[MOD]?.meta?.sustainOf === KEY);
const whisperOf = () => [...msgs.values()].find((m) => m.flags?.[MOD]?.sustainReshape);
const sustainedNow = (author, anchor, pos = { combat: "c1", round: 2 }) => ({ anchor, actor: author, pos });

test("валидатор: reshape только self + choose-options + sustain:true, без pulse/check; каталог DFF проходит", () => {
  const apply = [{ to: "self", choose: { from: "options", options: [{ value: "a" }, { value: "b" }] } }, { to: "self", when: ["choice:a"], effect: { uuid: "Compendium.x.Item.e" }, sustain: true }];
  const ok = (onUse) => validateRule({ v: 1, onUse });
  assert.equal(ok({ targets: "self", reshape: true, apply }).rule.onUse.reshape, true);
  assert.equal(ok({ targets: "self", apply }).rule.onUse.reshape, undefined);
  const bad = [{ targets: "selected", reshape: true, apply }, { targets: "self", reshape: "yes", apply }, { targets: "self", reshape: true, apply: [apply[1]] },
    { targets: "self", reshape: true, apply: [apply[0], { to: "self", effect: { uuid: "Compendium.x.Item.e" } }] },
    { targets: "self", reshape: true, check: { statistic: "athletics", byDegree: {} }, apply }];
  for (const b of bad) assert.ok(JSON.stringify(ok(b).errors).includes("use.reshape"), JSON.stringify(b));
  assert.equal(DFF.onUse.reshape, true);
  const v = validateRule(structuredClone(DFF));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.rule.onUse.reshape, true);
});

test("reshapeRule: choose первым (chooseIndex), далее шаги себе с sustain:true; нет choose — null", () => {
  const rs = reshapeRule(rule());
  assert.equal(rs.chooseIndex, 0);
  assert.equal(rs.rule.onUse.apply.length, 4);
  assert.ok(rs.rule.onUse.apply[0].choose);
  assert.ok(rs.rule.onUse.apply.slice(1).every((s) => s.sustain === true && s.to === "self"));
  assert.equal(rs.rule.onUse.targets, "self");
  assert.equal(reshapeRule({ onUse: { apply: [{ to: "self", effect: { uuid: "x" }, sustain: true }] } }), null);
});

test("hasOwnChoice и reshapeChoices: порог показа и исключение действующего варианта", () => {
  assert.equal(hasOwnChoice({ system: { rules: [{ key: "BattleForm" }] } }), false);
  assert.equal(hasOwnChoice({ system: { rules: [{ key: "ChoiceSet", choices: [] }] } }), true);
  assert.equal(hasOwnChoice({ system: { rules: [{ key: "ChoiceSet", selection: "x" }] } }), false);
  const o = (...v) => v.map((value) => ({ value }));
  assert.equal(reshapeChoices(o("pest"), "pest", new Set()).show, false);                       // DFF ранг 1: единственный вариант без выбора внутри
  assert.equal(reshapeChoices(o("animal"), "animal", new Set(["animal"])).show, true);          // единственный, но с ChoiceSet внутри
  assert.deepEqual(reshapeChoices(o("pest", "animal"), "pest", new Set(["animal"])).choices.map((c) => c.value), ["animal"]);   // pest без выбора — исключён
  assert.deepEqual(reshapeChoices(o("pest", "animal"), "animal", new Set(["animal"])).choices.map((c) => c.value), ["pest", "animal"]);   // Animal -> Animal разрешён
  assert.equal(reshapeChoices(o("pest", "animal", "elemental"), null).show, true);
});

test("optionsOf: фильтр when по рангу сотворения, подписи", () => {
  const ch = rule().onUse.apply[0].choose;
  const at = (r) => optionsOf(ch, new Set([`origin:item:rank:${r}`, `item:rank:${r}`])).map((x) => x.value);
  assert.deepEqual(at(1), ["pest"]); assert.deepEqual(at(2), ["pest", "animal"]); assert.deepEqual(at(5), ["pest", "animal", "elemental"]);
});

test("reshapeMoment: вне боя — всегда; в бою — раунд Поддержания и ход автора", () => {
  const p = { combat: "c1", round: 2 };
  assert.equal(reshapeMoment({ combat: null, round: null }, p, null), null);
  assert.equal(reshapeMoment(p, p, p), null);
  assert.equal(reshapeMoment(p, { combat: "c1", round: 3 }, p), "needSustain");
  assert.equal(reshapeMoment(p, p, { combat: "c1", round: 1 }), "needSustain");
  assert.equal(reshapeMoment(p, p, p, false), "wrongTurn");
});

test("шёпот: ранг сотворения 1 — нет; ранг 2 — один, прежний шёпот якоря заменяется", async () => {
  try {
    let s = await scene({ rank: 1 });
    await onReshape(sustainedNow(s.author, s.anchor));
    assert.equal(whisperOf(), undefined);
    s = await scene({ rank: 2 });
    await onReshape(sustainedNow(s.author, s.anchor));
    await onReshape(sustainedNow(s.author, s.anchor));
    const all = [...msgs.values()].filter((m) => m.flags?.[MOD]?.sustainReshape);
    assert.equal(all.length, 1);
    const h = all[0].flags[MOD].sustainReshape;
    assert.deepEqual(h.choices.map((c) => c.value), ["animal"]);   // pest — действующий, без своего выбора
    assert.equal(h.title, spell.name);
    assert.match(all[0].content, /data-af-reshape/);
  } finally { teardown(); }
});

test("effect=off: шёпота нет и смена отказана", async () => {
  try {
    const s = await scene();
    settings["mode.effect"] = "off";
    await onReshape(sustainedNow(s.author, s.anchor));
    assert.equal(whisperOf(), undefined);
    settings["mode.effect"] = "button";
    await onReshape(sustainedNow(s.author, s.anchor));
    const w = whisperOf();
    settings["mode.effect"] = "off";
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm" }), { denied: "off" });
    assert.equal(bound(s.author)[0].uuid, s.pest.uuid);
  } finally { teardown(); }
});

test("смена pest -> animal при effect=button: старый снят, новый привязан к тому же якорю, якорь один; карточка исполнена, флаг reshaped", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    const w = whisperOf();
    const r = await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm" });
    assert.deepEqual(r, { reshaped: true });
    const b = bound(s.author);
    assert.equal(b.length, 1);
    assert.equal(b[0]._stats.compendiumSource, ANIMAL);
    assert.equal(b[0].system.level.value, 2);   // круг сотворения
    assert.equal(sustain.anchorsOf(s.author).length, 1);
    assert.deepEqual(sustain.findAnchor(s.author, KEY).flags[MOD].sustain.actors, [s.author.uuid]);
    assert.equal(sustain.findAnchor(s.author, KEY).flags[MOD].sustain.reshaped, true);
    assert.equal(msgs.get(w.id).flags[MOD].sustainReshape.reshaped, true);
    const card = sent.find((m) => m.flags?.[MOD]?.use?.state?.reshape), u = card.flags[MOD].use;
    assert.equal(u.kind, "use"); assert.equal(u.confidence, "high");
    assert.equal(card.author, "gm"); assert.deepEqual(card.flags.pf2e, { origin: { castRank: 2 } });
    assert.deepEqual(u.state.apply.self.ops.map((o) => o.op), ["effRemoved", "chose", "created", "reshaped"]);
    assert.equal(u.state.apply.self.ops[0].key, KEY); assert.equal(u.state.apply.self.ops[0].actor, s.author.uuid);
    assert.equal(u.state.done, true);
    // повторный клик по тому же шёпоту
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "pest", { userId: "gm" }), { denied: "done" });
  } finally { teardown(); }
});

test("значение вне вариантов ранга / действующий вариант без своего выбора — отказ, ничего не снято", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    const w = whisperOf();
    for (const v of ["elemental", "pest", "bogus"]) assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, v, { userId: "gm" }), { denied: "badChoice" });
    assert.equal(bound(s.author)[0].uuid, s.pest.uuid);
  } finally { teardown(); }
});

test("preChoice вне вариантов после when — отказ шага (applyOps): ни chose, ни эффекта", async () => {
  try {
    const s = await scene({ rank: 1 });
    const { applyOps } = await import("../scripts/apply.mjs");
    const rs = reshapeRule(rule());
    const mk = (value) => mkMsg("X" + value, { flags: { pf2e: { origin: { castRank: 1 } }, [MOD]: { use: { v: 1, kind: "use", rule: rs.rule, actor: s.author.uuid, item: { uuid: "Item.s" }, targets: [], state: { sustainKey: KEY, reshape: { force: true, preChoice: { index: 0, value } } } } } } });
    const before = s.author.items.length;
    const bad = mk("animal");   // ранг 1: animal не проходит when
    const ops = await applyOps(bad, "self", rs.rule.onUse.apply, { scope: "apply" });
    assert.equal(ops.length, 0); assert.equal(s.author.items.length, before);
  } finally { teardown(); }
});

test("момент Поддержания: не поддержано в раунде / не ход автора — отказ; Alt обходит", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    const w = whisperOf();
    world.combat = { id: "c1", round: 3, combatant: null };   // раунд сменился, Поддержания в нём не было
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm" }), { denied: "needSustain" });
    world.combat = { id: "c1", round: 2, combatant: { actor: { uuid: "Actor.other" } } };
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm" }), { denied: "wrongTurn" });
    assert.equal(bound(s.author)[0].uuid, s.pest.uuid);
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm", alt: true }), { reshaped: true });
  } finally { teardown(); }
});

test("новый эффект не создан (окно ChoiceSet закрыто/иммунитет): прежний возвращён на тот же якорь, карточка удалена, шёпот доступен", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    const w = whisperOf();
    flags.blockNew = ANIMAL;
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm" }), { denied: "failed" });
    const b = bound(s.author);
    assert.equal(b.length, 1); assert.equal(b[0]._stats.compendiumSource, PEST);
    assert.equal(sustain.anchorsOf(s.author).length, 1);
    assert.ok(!sent.some((m) => msgs.has(m.id) && m.flags?.[MOD]?.use?.state?.reshape));   // служебная карточка убрана
    assert.ok(!msgs.get(w.id).flags[MOD].sustainReshape.reshaped);
    flags.blockNew = null;
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm" }), { reshaped: true });   // кнопка снова работает
  } finally { teardown(); }
});

test("«Прекратить Поддержание» после смены снимает новый эффект", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    await reshapeRun(s.author.uuid, KEY, whisperOf().id, "animal", { userId: "gm" });
    await sustain.run(s.author.uuid, KEY, "dismiss");
    assert.equal(bound(s.author).length, 0);
    assert.equal(sustain.anchorsOf(s.author).length, 0);
  } finally { teardown(); }
});

test("откат карточки смены: созданное снято, старое возвращено на якорь; повторный откат/не по порядку/после конца — отказ без изменений", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    await reshapeRun(s.author.uuid, KEY, whisperOf().id, "animal", { userId: "gm" });
    const card = sent.find((m) => m.flags?.[MOD]?.use?.state?.reshape);
    await undoOps(msgs.get(card.id), "self");
    const b = bound(s.author);
    assert.equal(b.length, 1); assert.equal(b[0]._stats.compendiumSource, PEST);
    assert.equal(sustain.anchorsOf(s.author).length, 1);
    // новая смена, затем откат первой карточки — отказ
    const w2 = (await onReshape(sustainedNow(s.author, s.anchor)), whisperOf());
    await reshapeRun(s.author.uuid, KEY, w2.id, "animal", { userId: "gm" });
    const first = msgs.get(card.id), second = sent.filter((m) => m.flags?.[MOD]?.use?.state?.reshape).at(-1);
    first.flags[MOD].use.state.apply = { self: { ops: [{ op: "effRemoved", actor: s.author.uuid, key: KEY, data: [effectDoc("Old").toObject()] }, { op: "reshaped", actor: s.author.uuid, key: KEY, keys: ["gone:key"] }] } };
    const before = s.author.items.length;
    assert.deepEqual(await undoOps(first, "self"), { undone: 0 });
    assert.equal(s.author.items.length, before);
    // после конца Поддержания — отказ
    await sustain.run(s.author.uuid, KEY, "dismiss");
    assert.deepEqual(await undoOps(msgs.get(second.id), "self"), { undone: 0 });
    assert.equal(s.author.items.length, 0);
  } finally { teardown(); }
});

test("откат карточки сотворения после смены: привязанное сменой снято и якорь убран, независимо от created сотворения", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    await reshapeRun(s.author.uuid, KEY, whisperOf().id, "animal", { userId: "gm" });
    assert.equal(bound(s.author).length, 1);
    const ops = msgs.get("M1").flags[MOD].use.state.apply.self.ops;
    ops.splice(ops.findIndex((o) => o.op === "anchor"), 1);   // якорь поставил автоякорь сотворения — op "anchor" в карточке нет
    await undoOps(msgs.get("M1"), "self");
    assert.equal(bound(s.author).length, 0);
    assert.equal(sustain.anchorsOf(s.author).length, 0);
  } finally { teardown(); }
});

test("откат карточки сотворения без смены: created снят, prune убирает якорь", async () => {
  try {
    const s = await scene();
    await undoOps(msgs.get("M1"), "self");
    assert.equal(bound(s.author).length, 0);
    assert.equal(sustain.anchorsOf(s.author).length, 0);
  } finally { teardown(); }
});

test("неудачная смена (прежний пересоздан с новым uuid, флага reshaped нет): откат сотворения снимает форму и якорь", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    flags.blockNew = ANIMAL;
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, whisperOf().id, "animal", { userId: "gm" }), { denied: "failed" });
    assert.notEqual(bound(s.author)[0].uuid, s.pest.uuid);
    assert.ok(!sustain.findAnchor(s.author, KEY).flags[MOD].sustain.reshaped);
    await undoOps(msgs.get("M1"), "self");
    assert.equal(bound(s.author).length, 0);
    assert.equal(sustain.anchorsOf(s.author).length, 0);
  } finally { teardown(); }
});

test("цепочка смен: откат №2, затем откат №1 (эффект №1 пересоздан с новым uuid) проходит и возвращает исходный эффект", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    await reshapeRun(s.author.uuid, KEY, whisperOf().id, "animal", { userId: "gm" });
    await onReshape(sustainedNow(s.author, s.anchor));
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, whisperOf().id, "pest", { userId: "gm" }), { reshaped: true });
    const [c1, c2] = sent.filter((m) => m.flags?.[MOD]?.use?.state?.reshape);
    assert.equal(bound(s.author)[0]._stats.compendiumSource, PEST);
    assert.deepEqual(await undoOps(msgs.get(c1.id), "self"), { undone: 0 });   // №1 при живой №2 — отказ
    assert.ok((await undoOps(msgs.get(c2.id), "self")).undone > 0);
    assert.equal(bound(s.author).length, 1); assert.equal(bound(s.author)[0]._stats.compendiumSource, ANIMAL);
    assert.ok((await undoOps(msgs.get(c1.id), "self")).undone > 0);
    assert.equal(bound(s.author).length, 1); assert.equal(bound(s.author)[0]._stats.compendiumSource, PEST);
    assert.equal(sustain.anchorsOf(s.author).length, 1);
  } finally { teardown(); }
});

test("якорь исчез, пока шла смена (откат сотворения ГМом): созданное снято, отказ gone, шёпот якоря удалён", async () => {
  try {
    const s = await scene();
    await onReshape(sustainedNow(s.author, s.anchor));
    const w = whisperOf(), create = ChatMessage.create;
    ChatMessage.create = async (d) => { const m = await create(d); await tick(); await s.anchor.delete({ [MOD]: { undo: true } }); return m; };
    assert.deepEqual(await reshapeRun(s.author.uuid, KEY, w.id, "animal", { userId: "gm" }), { denied: "gone" });
    assert.equal(s.author.items.length, 0);
    assert.equal(whisperOf(), undefined);
  } finally { teardown(); }
});

test("ранг сотворения хранится в якоре: у сообщения нет castRank — варианты по рангу сотворения", async () => {
  try {
    setup();
    const author = mkActor("Actor.a");
    const { item: anchor } = await sustain.attach(author, author, { key: KEY, msg: "M1", item: spell, castRank: 2 });
    assert.equal(anchor.flags[MOD].sustain.castRank, 2);
    await author.createEmbeddedDocuments("Item", [{ ...effectDoc("Pest Form").toObject(), flags: { [MOD]: { meta: { key: "M1:self:1", source: "apply", sustainOf: KEY, sustainBy: author.uuid } } }, _stats: { compendiumSource: PEST } }]);
    mkMsg("M1", { flags: { [MOD]: { use: { v: 1, kind: "use", rule: rule(), actor: author.uuid, item: { uuid: "Item.s" }, targets: [], state: {} } } } });   // у сообщения нет origin.castRank (вычищено): ранг предмета 1 дал бы «нет шёпота»
    await onReshape(sustainedNow(author, anchor));
    assert.deepEqual(whisperOf().flags[MOD].sustainReshape.choices.map((c) => c.value), ["animal"]);
  } finally { teardown(); }
});

test("обычный choose при сотворении: один вариант после when (круг 1) — без окна, эффект создан", async () => {
  setup();
  try {
    const author = mkActor("Actor.a");
    const { applyOps } = await import("../scripts/apply.mjs");
    const m = mkMsg("C1", { flags: { pf2e: { origin: { castRank: 1 } }, [MOD]: { use: { v: 1, kind: "use", rule: rule(), actor: author.uuid, item: { uuid: "Item.s" }, targets: [], state: {} } } } });
    const ops = await applyOps(m, "self", rule().onUse.apply, { scope: "apply" });   // окно вызвало бы askChoice без сокета/диалога — исключение
    assert.deepEqual(ops.filter((o) => o.op === "chose").map((o) => o.value), ["pest"]);
    assert.equal(author.items.filter((i) => i._stats?.compendiumSource === PEST).length, 1);
  } finally { teardown(); }
});
