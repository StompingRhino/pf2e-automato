// Контрзаклинание (M4), шаги 1–2: таблица противодействия, поле counter записи onEvent, удержание карточки сотворения без диспетчера. Без Foundry.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const settings = {};
let msgs, uuids, created, users;
const setDeep = (o, path, v) => { const ks = path.split("."), last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };
const getDeep = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
globalThis.game = {
  user: { isActiveGM: true, id: "gm" },
  get users() { return users; },
  settings: { get: (_m, k) => settings[k] },
  i18n: { localize: (k) => k, format: (k) => k },
  modules: { get: () => null },
  messages: { get: (id) => msgs.get(id), get contents() { return [...msgs.values()]; } },
  pf2e: { ConditionManager: { conditions: new Map() } },
  combats: []
};
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.fromUuid = async (u) => uuids.get(u) ?? null;
globalThis.fromUuidSync = (u) => uuids.get(u) ?? null;
globalThis.foundry = { data: { regionBehaviors: { RegionBehaviorType: class {} }, fields: new Proxy({}, { get: () => class {} }) }, utils: { deepClone: (o) => structuredClone(o), setProperty: setDeep, getProperty: getDeep, mergeObject: (a, b) => Object.assign(a, b), escapeHTML: (s) => String(s) } };
globalThis.CONFIG = { PF2E: {}, Canvas: { polygonBackends: { move: { testCollision: () => false } } } };
const updates = [];
const mkDoc = (m) => Object.assign(m, { async update(d) { updates.push(d); for (const [k, v] of Object.entries(d)) { if (k.startsWith("flags.") && v && typeof v === "object" && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) setDeep(m, `${k}.${k2}`, v2); else setDeep(m, k, v); } }, async delete() { msgs.delete(this.id); } });
globalThis.ChatMessage = { create: async (d) => { const m = mkDoc({ id: `H${created.length + 1}`, ...d }); created.push(m); msgs.set(m.id, m); return m; }, getSpeaker: () => ({}), getWhisperRecipients: () => [] };

const { MOD } = await import("../scripts/util.mjs");
const rules = await import("../scripts/rules.mjs");
const ev = await import("../scripts/events.mjs");
const hold = await import("../scripts/hold.mjs");
const use = await import("../scripts/use.mjs");
const saves = await import("../scripts/saves.mjs");
const { counteractOutcome } = await import("../scripts/counterspell.mjs");
const { holdPlaque } = await import("../scripts/damage-gate.mjs");
const { dispatchBuiltin } = await import("../scripts/builtin/index.mjs");
const { findCard } = await import("../scripts/builtin/basic-damage.mjs");
const maneuver = await import("../scripts/builtin/maneuver.mjs");
const variableCast = await import("../scripts/builtin/variable-cast.mjs");
const { ruleToForm, formToRule } = await import("../scripts/sheet.mjs");
const validate = rules.validateRule;

beforeEach(() => {
  Object.assign(settings, { "mode.challenge": "auto", "mode.effect": "auto", "mode.apply": "auto", "mode.macro": "auto", "mode.damageGate": "auto", "mode.zone": "auto", useToolbeltTargetHelper: false, yieldToAutomations: false, resumeMinutes: 30 });
  msgs = new Map(); uuids = new Map(); created = []; updates.length = 0; users = { activeGM: { id: "gm" } };
  hold.replayers.clear();
});

/** Сообщение сотворения с флагом удержания; gate — произвольное состояние флага. */
const mkCast = (id, gate, extra = {}) => { const m = mkDoc({ id, flags: { pf2e: { context: { type: "spell-cast" }, origin: { type: "spell" } }, [MOD]: { gate: structuredClone(gate) } }, rolls: [], timestamp: Date.now(), ...extra }); msgs.set(id, m); return m; };
const COUNTER = { hold: "counter" };
const CANCELLED = { hold: false, cancelled: true, counter: true };

/* ---------- шаг 1: чистое ---------- */

test("counteractOutcome: крит. провал не срывает; провал — ранг ниже контр-ранга; успех — до +1; крит. успех — до +3", () => {
  const o = (degree, counterRank, targetRank) => counteractOutcome({ degree, counterRank, targetRank });
  assert.deepEqual(o(0, 5, 1), { counteracted: false, maxRank: null });
  assert.deepEqual([o(1, 3, 2).counteracted, o(1, 3, 3).counteracted], [true, false]);
  assert.deepEqual([o(2, 3, 4).counteracted, o(2, 3, 5).counteracted], [true, false]);
  assert.deepEqual([o(3, 3, 6).counteracted, o(3, 3, 7).counteracted], [true, false]);
  assert.deepEqual([o(1, 3, 2).maxRank, o(2, 3, 1).maxRank, o(3, 3, 1).maxRank], [2, 4, 6]);
  assert.equal(o(7, 3, 1).counteracted, false, "степень вне 0..3 — не срывает");
});

const entry = (counter, extra = {}) => ({ v: 1, onEvent: [{ on: "spell-cast", side: "near", range: 30, cost: "reaction", counter, ...extra }] });
const errs = (rule) => validate(rule).errors?.map(String) ?? [];

test("валидатор counter: допустимые формы; запись без apply с cost проходит", () => {
  for (const c of [{ mod: 7, rank: 3 }, { statistic: "counteract", rank: { half: "actor" } }, { statistic: "spell-attack", rank: 2 }, { statistic: "arcana", rank: 4 }]) {
    const v = validate(entry(c));
    assert.equal(v.ok, true, JSON.stringify(c) + " " + errs(entry(c)).join(";"));
    assert.deepEqual(v.rule.onEvent[0].counter, c);
    assert.equal(v.rule.onEvent[0].cost, "reaction");
    assert.equal(v.rule.onEvent[0].apply, undefined);
  }
  assert.equal(validate(entry({ mod: 7, rank: 3 }, { apply: [{ to: "self", note: "x" }] })).ok, false, "apply диспетчер не исполняет — до фазы 2 отклоняется");
  assert.equal(validate(entry({ mod: 7, rank: 3 }, { use: true })).ok, false, "use — тоже");
  assert.equal(validate(entry({ mod: 7, rank: 3, expend: "same-spell" })).ok, false, "expend — объект {spell, …}, строка не форма");
  assert.equal(validate(entry({ mod: 7, rank: 3 }, { aura: "frightful-aura", range: undefined })).ok, true, "зона — аура вместо range");
});

test("валидатор counter: только spell-cast + near + reaction, mod xor statistic, ранг обязателен, лишние ключи нет", () => {
  const bad = (rule, label) => assert.equal(validate(rule).ok, false, label);
  bad({ v: 1, onEvent: [{ on: "spell-cast", side: "self", cost: "reaction", counter: { mod: 7, rank: 3 } }] }, "side self");
  bad({ v: 1, onEvent: [{ on: "turn-start", side: "near", range: 30, cost: "reaction", counter: { mod: 7, rank: 3 } }] }, "on не spell-cast");
  bad({ v: 1, onEvent: [{ on: "spell-cast", side: "near", range: 30, counter: { mod: 7, rank: 3 } }] }, "без cost");
  bad(entry({ mod: 7 }), "без ранга");
  bad(entry({ rank: 3 }), "без mod и statistic");
  bad(entry({ mod: 7, statistic: "arcana", rank: 3 }), "и mod, и statistic");
  bad(entry({ mod: 1.5, rank: 3 }), "mod не целое");
  bad(entry({ mod: 7, rank: 0 }), "ранг 0");
  bad(entry({ mod: 7, rank: 11 }), "ранг 11");
  bad(entry({ mod: 7, rank: { half: "item" } }), "half item");
  bad(entry({ mod: 7, rank: 3, expend: "any" }), "expend вне списка");
  bad(entry({ mod: 7, rank: 3, x: 1 }), "лишний ключ");
  bad({ v: 1, onEvent: [{ on: "spell-cast", side: "near", range: 30, cost: "reaction" }] }, "near+spell-cast без counter");
  assert.ok(errs(entry({ mod: 7 })).some((e) => e.length > 0));
});

test("round-trip листа: counter едет через форму как есть, без counter — не появляется", () => {
  const rule = validate(entry({ statistic: "counteract", rank: { half: "actor" } })).rule;
  const back = formToRule(ruleToForm(rule));
  assert.deepEqual(back.onEvent[0].counter, rule.onEvent[0].counter);
  assert.equal(back.onEvent[0].cost, "reaction");
  assert.equal("counter" in formToRule(ruleToForm(validate({ v: 1, onEvent: [{ on: "damage-roll", apply: [{ to: "self", note: "x" }] }] }).rule)).onEvent[0], false);
  assert.equal(validate(back).ok, true);
});

/* ---------- шаг 2: удержание ---------- */

test("предикаты: counter-удержание и сорванное — одно сообщение; Святилище и переброс — не counter", () => {
  assert.deepEqual([hold.isHeld(mkCast("a", COUNTER)), hold.isCounterHold(mkCast("a", COUNTER)), hold.isCounterGate(mkCast("a", COUNTER)), hold.isSanctuaryHold(mkCast("a", COUNTER))], [true, true, true, false]);
  assert.equal(hold.isCounterGate(mkCast("b", CANCELLED)), true);
  assert.equal(hold.isCounterGate(mkCast("c", { hold: false, cancelled: true })), false, "отменённая атака — не сорванное сотворение");
  assert.equal(hold.isCounterGate(mkCast("d", { hold: true })), false);
  assert.equal(hold.isCounterGate(mkCast("e", { hold: "reroll" })), false);
  assert.equal(hold.isCounterGate(mkCast("f", { hold: false, replayed: true, cancelled: false })), false);
});

test("resolve: release -> флаги, replay один раз, повторный выпуск — ничего", async () => {
  const m = mkCast("R1", COUNTER);
  let calls = 0;
  hold.replayers.add(async (x) => { calls++; assert.equal(x, m); });
  const r = await hold.resolve(m, "release");
  assert.deepEqual(r.prev, { hold: "counter", cancelled: false });
  assert.deepEqual([hold.isHeld(m), hold.isCounterGate(m), m.flags[MOD].gate.replayed, calls], [false, false, true, 1]);
  assert.equal(await hold.resolve(m, "release"), null);
  assert.equal(calls, 1);
});

test("resolve: cancel — ничего не исполняется (replay не зовётся), сорвано; «Вернуть» (release) выпускает ровно один раз", async () => {
  const m = mkCast("R2", COUNTER);
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  await hold.resolve(m, "cancel");
  assert.deepEqual([hold.isHeld(m), hold.isCancelled(m), hold.isCounterGate(m), calls], [false, true, true, 0]);
  assert.equal(await hold.resolve(m, "cancel"), null, "повторная отмена — ничего");
  await hold.resolve(m, "release");   // «Вернуть»
  assert.deepEqual([hold.isCounterGate(m), hold.isCancelled(m), calls], [false, false, 1]);
  assert.equal(await hold.resolve(m, "release"), null);
  assert.equal(calls, 1, "после «Вернуть» — один раз");
});

test("resolve: отменённая атака (не counter) release не выпускает; counter-удержания разных сообщений не слипаются", async () => {
  const atk = mkCast("A", { hold: false, cancelled: true });
  assert.equal(await hold.resolve(atk, "release"), null);
  const a = mkCast("X1", COUNTER, { actor: { uuid: "Actor.w" } }), b = mkCast("X2", COUNTER, { actor: { uuid: "Actor.w" } });
  hold.replayers.add(async () => {});
  await hold.resolve(a, "release");
  assert.equal(hold.isCounterHold(b), true, "второе заклинание того же мага осталось удержанным");
});

test("resolveManual: кнопки ГМа — выпустить / отменить / вернуть для counter; чужие сообщения игнорируются", async () => {
  const m = mkCast("M1", COUNTER);
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  await hold.resolveManual("M1", "cancel");
  assert.equal(hold.isCounterGate(m), true);
  assert.equal(calls, 0);
  await hold.resolveManual("M1", "release");
  assert.deepEqual([hold.isCounterGate(m), calls], [false, 1]);
  assert.equal(await hold.resolveManual("M1", "release"), null);
  assert.equal(await hold.resolveManual("нет", "release"), null);
});

test("onDeleteHost: удалена карточка проверки без решения — counter-удержание выпускается", async () => {
  const m = mkCast("D1", COUNTER);
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  await hold.onDeleteHost({ flags: { [MOD]: { use: { state: { event: "D1:Actor.x.Item.y:0" } } } } });
  assert.deepEqual([hold.isHeld(m), calls], [false, 1]);
});

test("onDeleteHost: удалена уже решённая карточка проверки (done) — сотворение, ждущее следующего кандидата, не выпускается", async () => {
  const m = mkCast("D2", COUNTER);
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  await hold.onDeleteHost({ flags: { [MOD]: { use: { state: { event: "D2:Actor.x.Item.y:0", counter: { done: true } } } } } });
  assert.deepEqual([hold.isHeld(m), calls], [true, 0]);
});

test("sweepCounter: зависшее удержание старше порога выпускается, свежее — остаётся; сорванное не трогается", async () => {
  const old = mkCast("S1", COUNTER, { timestamp: Date.now() - hold.COUNTER_STUCK_MS - 1000 });
  const fresh = mkCast("S2", COUNTER, { timestamp: Date.now() });
  const cancelled = mkCast("S3", CANCELLED, { timestamp: Date.now() - 999999 });
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  await hold.sweepCounter();
  assert.deepEqual([hold.isHeld(old), hold.isHeld(fresh), hold.isCounterGate(cancelled), calls], [false, true, true, 1]);
});

test("плашка: удержано — «Выпустить»/«Отменить»; сорвано — «Вернуть»; Святилище и отмена атаки — как прежде", () => {
  assert.deepEqual(holdPlaque(mkCast("P1", COUNTER)), { text: "hold.counterWaiting", buttons: ["release", "cancel"] });
  assert.deepEqual(holdPlaque(mkCast("P2", CANCELLED)), { text: "hold.counterCancelled", buttons: ["release"] });
  assert.deepEqual(holdPlaque(mkCast("P3", { hold: true })), { text: "hold.waiting", buttons: ["release", "cancel"] });
  assert.deepEqual(holdPlaque(mkCast("P4", { hold: false, cancelled: true })), { text: "hold.cancelled", buttons: [] });
});

/* ---------- потребители карточки сотворения: при удержании и срыве молчат ---------- */

test("events.onMessage: counter-удержание не обрабатывается и не «выпускается как зависшее»", async () => {
  const m = mkCast("E1", COUNTER, { actor: { uuid: "Actor.w", name: "w", items: [] }, speaker: { actor: "w" } });
  hold.replayers.add(async () => { throw new Error("replay не должен звониться"); });
  await ev.onMessage(m);
  assert.deepEqual([hold.isCounterHold(m), created.length, updates.length], [true, 0, 0]);
});

const useSnap = (rule, state = {}) => ({ kind: "use", rule, state, targets: [], item: { uuid: "Item.x", name: "Огненный шар", type: "spell" }, actor: "Actor.w", confidence: "high" });

test("use: runUse/onCreateMessage молчат при counter-удержании и срыве; после выпуска исполняется ровно один раз", async () => {
  for (const gate of [COUNTER, CANCELLED]) {
    const m = mkCast("U1", gate);
    m.flags[MOD].use = useSnap({ v: 1, onUse: { targets: "selected" } });
    await use.runUse("U1");
    await use.onCreateMessage(m);
    assert.equal(m.flags[MOD].use.state.done, undefined, `${JSON.stringify(gate)}: исполнение не стартовало`);
    assert.equal(updates.length, 0);
  }
  const m = msgs.get("U1");
  await hold.resolve(m, "release", { wait: false });
  await use.runUse("U1");
  assert.equal(m.flags[MOD].use.state.done, true, "после выпуска — исполнено");
});

test("use: runRegion и кнопки applyUse/createZone/applyDerived — отказ при counter-удержании", async () => {
  const m = mkCast("U2", COUNTER);
  m.flags[MOD].use = useSnap({ v: 1, onUse: { targets: "area", apply: [{ to: "target", condition: { slug: "frightened", value: 1 } }], zone: { duration: { seconds: 6 }, condition: { slug: "concealed" } } } });
  const region = { uuid: "Scene.s.Region.r", flags: { pf2e: { messageId: "U2" } }, parent: { tokens: { contents: [] } } };
  await use.runRegion(region, m);
  assert.equal(m.flags[MOD].use.state.area, undefined, "цели области не взяты");
  assert.equal(m.flags[MOD].use.state.zone, undefined, "зона не создана");
  assert.equal(updates.length, 0);
  for (const f of [use.applyUse, use.createZone, use.applyDerived]) await assert.rejects(Promise.resolve().then(() => f("U2", region.uuid)), /контрзаклинанием/);
});

test("saves: rollSave/runChallenge/recordResult/applyByDegree молчат при counter-удержании и срыве", async () => {
  for (const gate of [COUNTER, CANCELLED]) {
    const m = mkCast("V1", gate);
    m.flags[MOD].use = useSnap({ v: 1, onUse: { targets: "selected", challenge: { statistic: "reflex", dc: { value: 20 }, basic: true, byDegree: { failure: [{ to: "target", condition: { slug: "frightened", value: 1 } }] } } } });
    assert.equal(await saves.rollSave({ name: "a" }, m.flags[MOD].use.rule.onUse.challenge, { message: m, tokenKey: "t" }), null);
    assert.deepEqual(await saves.runChallenge(m), []);
    assert.deepEqual(await saves.recordResult("V1", "t", { degree: 1, total: 10 }), { ok: false, reason: "countered" });
    assert.deepEqual(await saves.applyByDegree("V1", "all"), []);
    assert.equal(m.flags[MOD].use.state.challenge, undefined, "результатов нет");
    assert.equal(updates.length, 0);
  }
});

test("builtin-диспетчер: при counter-удержании идёт только цена (метамагия), остальное молчит; сорванное и выпущенное — по обычным правилам", async () => {
  const seen = [];
  const hooks = [["spellshape", () => seen.push("spellshape")], ["damage-link", () => seen.push("damage-link")], ["hunt-prey", () => seen.push("hunt-prey")]];
  const wait = () => new Promise((r) => setTimeout(r, 5));
  assert.equal(dispatchBuiltin(mkCast("B1", COUNTER), hooks), true);
  await wait();
  assert.deepEqual(seen, ["spellshape"]);
  seen.length = 0;
  assert.equal(dispatchBuiltin(mkCast("B2", { hold: true }), hooks), false, "Святилище — по-прежнему всё молчит");
  await wait();
  assert.deepEqual(seen, []);
  assert.equal(dispatchBuiltin(mkCast("B3", { hold: false, replayed: true }), hooks), true);
  await wait();
  assert.deepEqual(seen, ["spellshape", "damage-link", "hunt-prey"]);
});

test("basic-damage.findCard: бросок урона не привязывается к удержанной/сорванной карточке (молча, без ближайшей старой)", () => {
  const card = (id, gate, ts) => ({ id, timestamp: ts, flags: { [MOD]: { use: { actor: "Actor.w", item: { uuid: "Item.fb" }, state: {} }, ...(gate && { gate }) } } });
  const q = { actor: "Actor.w", uuid: "Item.fb", at: 100 };
  assert.equal(findCard([card("c1", null, 10), card("c2", COUNTER, 50)], q), null);
  assert.equal(findCard([card("c1", null, 10), card("c2", CANCELLED, 50)], q), null);
  assert.equal(findCard([card("c1", null, 10), card("c2", { hold: false, replayed: true }, 50)], q).id, "c2");
});

test("maneuver.bind: при counter-удержании кнопки манёвров не строятся", () => {
  const mk = (gate) => ({ id: "MN", flags: { pf2e: { context: { type: "spell-cast" }, origin: { rollOptions: ["origin:action:slug:cast-a-spell"] } }, [MOD]: { gate } }, actor: { isOwner: true }, item: null });
  const html = { querySelector() { throw new Error("дошли до построения кнопок"); } };
  assert.throws(() => maneuver.bind(mk(null), html), /дошли/, "без удержания путь до построения открыт");
  maneuver.bind(mk(COUNTER), html);
  maneuver.bind(mk(CANCELLED), html);
});

test("variable-cast.released: не бросает снаряды при удержании, без отметки, без флага выпуска и не автору", async () => {
  const base = (gate, cast, isAuthor = true) => ({ isAuthor, flags: { [MOD]: { gate, cast }, pf2e: { origin: { uuid: "Item.mm", type: "spell" } } }, async update() { throw new Error("update не должен звониться"); } });
  const rel = { flags: { [MOD]: { gate: { replayed: true } } } };
  await variableCast.released(base(COUNTER, { actions: 2, missilesHeld: true }), rel.flags ? { flags: rel.flags } : null);   // удержано снова
  await variableCast.released(base({ hold: false, replayed: true }, { actions: 2 }), { flags: rel.flags });                  // нет отметки missilesHeld
  await variableCast.released(base({ hold: false }, { actions: 2, missilesHeld: true }), { flags: { [MOD]: { gate: { hold: false } } } });   // не выпуск
  await variableCast.released(base({ hold: false, replayed: true }, { actions: 2, missilesHeld: true }, false), { flags: rel.flags });       // не автор
});

test("events.onPreCreate: сообщение, родившееся с удержанием counter, получает noAutoDamageRoll Workbench; markCounterHold ставит оба флага", () => {
  const mk = (gate) => { const m = { flags: { [MOD]: { gate } }, updateSource(d) { setDeep(m, "x", 1); this.src = d; } }; return m; };
  const a = mk(COUNTER);
  ev.onPreCreate(a);
  assert.deepEqual(a.src.flags["xdy-pf2e-workbench"], { noAutoDamageRoll: true });
  assert.equal(a.src.flags[MOD].gate.hold, "counter");
  const b = { flags: {}, updateSource(d) { this.src = d; } };
  ev.markCounterHold(b);
  assert.equal(b.src.flags["xdy-pf2e-workbench"].noAutoDamageRoll, true);
  const c = mk({ hold: true });
  ev.onPreCreate(c);
  assert.equal(c.src, undefined, "Святилище этим путём не идёт");
});

test("lang: ключи плашки и ошибка counter есть в ru и en", async () => {
  const { readFileSync } = await import("node:fs");
  for (const l of ["ru", "en"]) {
    const j = JSON.parse(readFileSync(new URL(`../lang/${l}/events.json`, import.meta.url), "utf8")).PF2E_AUTOMATO;
    for (const k of ["restore", "counterWaiting", "counterCancelled"]) assert.ok(j.hold[k], `${l} hold.${k}`);
    assert.ok(j.rules.err.ev.counter, `${l} err.ev.counter`);
  }
});

/* ---------- доработка по замечаниям Критика ---------- */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withHost = (castId, applied = {}) => { const h = mkDoc({ id: `host-${castId}`, flags: { [MOD]: { use: { state: { event: `${castId}:Actor.x.Item.y:0`, challenge: { applied } } } } } }); msgs.set(h.id, h); return h; };

test("sweepCounter: удержание старше resumeMinutes снимается без replay и без replayed (старое заклинание не исполняется)", async () => {
  const stale = mkCast("T1", COUNTER, { timestamp: Date.now() - 31 * 60_000 });
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  await hold.sweepCounter();
  assert.deepEqual([hold.isHeld(stale), hold.isCounterGate(stale), stale.flags[MOD].gate.replayed, calls], [false, false, undefined, 0]);
  await variableCast.released(stale, { flags: { [MOD]: { gate: { hold: false, stale: true } } } });   // доброса снарядов нет: replayed не стоит
});

test("sweepCounter: карточка проверки ждёт броска — удержание не выпускается; применена — выпускается", async () => {
  const m = mkCast("T2", COUNTER, { timestamp: Date.now() - hold.COUNTER_STUCK_MS - 1000 });
  const host = withHost("T2");
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  await hold.sweepCounter();
  assert.deepEqual([hold.isCounterHold(m), calls], [true, 0]);
  host.flags[MOD].use.state.challenge.applied = { tok: true };
  await hold.sweepCounter();
  assert.deepEqual([hold.isHeld(m), calls], [false, 1]);
});

test("armCounter: таймер при создании/откате выпускает удержание; хост ждёт — не выпускает; решение до срока гасит таймер", async () => {
  const a = mkCast("T3", COUNTER), b = mkCast("T4", COUNTER), c = mkCast("T5", COUNTER);
  withHost("T4");
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  hold.armCounter(a, 15); hold.armCounter(b, 15); hold.armCounter(c, 15);
  await hold.resolve(c, "cancel");   // решили до срока
  await wait(80);
  assert.deepEqual([hold.isHeld(a), hold.isCounterHold(b), hold.isCancelled(c), calls], [false, true, true, 1]);
  const d = mkCast("T6", { hold: true });
  hold.armCounter(d, 5);   // не counter — таймер не ставится
  await wait(30);
  assert.equal(hold.isSanctuaryHold(d), true);
});

test("recordOneRoll: по удержанной/сорванной карточке не пишет eligible и результаты", async () => {
  const { recordOneRoll } = await import("../scripts/checks.mjs");
  for (const gate of [COUNTER, CANCELLED]) {
    const m = mkCast("R1", gate);
    m.flags[MOD].use = useSnap({ v: 1, onUse: { targets: "selected", challenge: { statistic: "reflex", dc: { value: 20 } } } });
    assert.deepEqual(await recordOneRoll(m, { total: 10, key: "t" }), { ok: false, keys: [] });
    assert.equal(m.flags[MOD].use.state.challenge, undefined);
    assert.equal(updates.length, 0);
  }
});

test("variable-cast.released: две вкладки автора — доброс один (флаг снимается под очередью)", async () => {
  const m = mkCast("W1", { hold: false, replayed: true }, { isAuthor: true });
  m.flags[MOD].cast = { actions: 2, missilesHeld: true };
  m.flags.pf2e.origin = { uuid: "Item.mm", type: "spell" };
  const ch = { flags: { [MOD]: { gate: { replayed: true } } } };
  await Promise.all([variableCast.released(m, ch), variableCast.released(m, ch)]);
  assert.equal(updates.filter((u) => u[`flags.${MOD}.cast.missilesHeld`] === false).length, 1);
});

test("«Отменить»: мгновенный шаблон этого сотворения удаляется, чужой и с длительностью — остаются", async () => {
  const mkRegion = (id, messageId) => ({ id, flags: { pf2e: { messageId } }, uuid: `R.${id}`, parent: { regions: { has: () => true } }, async delete() { regs.splice(regs.findIndex((r) => r.id === id), 1); }, async update() {}, behaviors: [] });
  const regs = [mkRegion("r1", "X1"), mkRegion("r2", "other")];
  globalThis.game.scenes = { get: () => null, contents: [{ regions: { get contents() { return regs; } } }] };
  globalThis.game.actors = [];
  try {
    const m = mkCast("X1", COUNTER, { item: { system: { duration: { value: "" } } } });
    await hold.resolve(m, "cancel");
    assert.deepEqual(regs.map((r) => r.id), ["r2"]);
    regs.push(mkRegion("r3", "X2"));
    const m2 = mkCast("X2", COUNTER, { item: { system: { duration: { value: "1 minute" } } } });
    await hold.resolve(m2, "cancel");
    assert.deepEqual(regs.map((r) => r.id), ["r2", "r3"], "область с длительностью остаётся");
  } finally { delete globalThis.game.scenes; delete globalThis.game.actors; }
});

test("Мастерская: у spell-cast с counter сторона near доступна, запись переживает смену события и round-trip; без counter — нет", async () => {
  const au = await import("../scripts/workshop/automation.mjs");
  const rule = validate(entry({ statistic: "counteract", rank: { half: "actor" } })).rule;
  const f = ruleToForm(rule), e = f.ev[0];
  assert.ok(au.evSides(e).includes("near"));
  au.evOnChanged(e, "spell-cast");
  assert.equal(e.side, "near", "near не сброшена");
  const back = validate(formToRule(f));
  assert.equal(back.ok, true, (back.errors ?? []).join(";"));
  assert.deepEqual(back.rule.onEvent[0].counter, rule.onEvent[0].counter);
  assert.equal(back.rule.onEvent[0].side, "near");
  const bare = { on: "spell-cast", side: "near" };
  assert.equal(au.evSides(bare).includes("near"), false);
  au.evOnChanged(bare, "spell-cast");
  assert.equal(bare.side, "self");
  const turn = { on: "turn-start", side: "near", counter: undefined };
  au.evOnChanged(turn, "damage-roll");
  assert.equal(turn.side, "self");
});

test("валидатор: near + spell-cast без counter — одна ошибка", () => {
  const rule = { v: 1, onEvent: [{ on: "spell-cast", side: "near", range: 30, cost: "reaction", apply: [{ to: "self", note: "x" }] }] };
  const e = validate(rule).errors ?? [];
  assert.equal(e.length, 1, e.map(String).join(";"));
});

/* ---------- шаги 3–4: диспетчер, исход «сорвано», вычисляемые условия ---------- */

const cs = await import("../scripts/counterspell.mjs");

const BTNS = `<section class="card-buttons"><button data-action="spell-save">Спасбросок</button><section class="owner-buttons"><button data-action="spell-damage">Урон</button></section></section>`;
const HTML = `<div class="chat-card"><header>Огненный шар</header><section class="card-content">описание</section>${BTNS}<footer>конец</footer></div>`;

test("stripButtons: блок кнопок со вложенными секциями убирается целиком; без блока и div-вариант", () => {
  assert.equal(hold.stripButtons(HTML), `<div class="chat-card"><header>Огненный шар</header><section class="card-content">описание</section><footer>конец</footer></div>`);
  assert.equal(hold.stripButtons(`<div class="card-buttons"><button>x</button></div><p>y</p>`), "<p>y</p>");
  assert.equal(hold.stripButtons(`${BTNS}<p>a</p>${BTNS}`), "<p>a</p>", "несколько блоков");
  assert.equal(hold.stripButtons("<p>нет кнопок</p>"), "<p>нет кнопок</p>");
  assert.equal(hold.stripButtons(undefined), "");
});

test("срыв: content без кнопок, оригинал во флаге; «Вернуть» восстанавливает content; плашка называет, кто сорвал", async () => {
  const m = mkCast("C1", COUNTER, { content: HTML });
  hold.replayers.add(async () => {});
  await hold.resolveManual("C1", "cancel", { item: "Контрзаклинание", actor: "Маг" });
  assert.equal(m.content.includes("card-buttons"), false);
  assert.equal(m.flags[MOD].counterContent, HTML);
  assert.deepEqual(m.flags[MOD].gate.by, { item: "Контрзаклинание", actor: "Маг" });
  assert.deepEqual(holdPlaque(m), { text: "hold.counterCancelledBy", buttons: ["release"], vars: { item: "Контрзаклинание", actor: "Маг" } });
  await hold.resolveManual("C1", "release");
  assert.equal(m.content, HTML);
  assert.equal(m.flags[MOD].counterContent, null);
  assert.equal(m.flags[MOD].gate.by, null);
  assert.deepEqual(holdPlaque(mkCast("C2", CANCELLED)), { text: "hold.counterCancelled", buttons: ["release"] }, "без by — прежний текст");
});

test("ручной «Отменить» удержанной карточки тоже убирает кнопки; без content (нечего убирать) не падает", async () => {
  const m = mkCast("C3", COUNTER, { content: HTML }), bare = mkCast("C4", COUNTER);
  await hold.resolveManual("C3", "cancel");
  await hold.resolveManual("C4", "cancel");
  assert.equal(m.content.includes("card-buttons"), false);
  assert.equal(bare.flags[MOD].counterContent, undefined);
});

/* --- вычисляемое --- */

test("targetRankOf / counterRankOf / triggerText", () => {
  assert.equal(cs.targetRankOf({ flags: { pf2e: { origin: { castRank: 5 } } }, item: { rank: 3 } }), 5, "усиленное сотворение");
  assert.equal(cs.targetRankOf({ flags: { pf2e: { origin: {} } }, item: { rank: 3 } }), 3);
  assert.equal(cs.counterRankOf({ rank: 4 }, { level: 20 }), 4);
  assert.deepEqual([1, 2, 3, 9, 10, 0].map((level) => cs.counterRankOf({ rank: { half: "actor" } }, { level })), [1, 1, 2, 5, 5, 1], "уровень/2 вверх, минимум 1");
  const item = { system: { description: { value: `<p><strong>Trigger</strong> A creature Casts a @UUID[Compendium.x]{Spell} you can see</p><hr><p>text</p>` } } };
  assert.equal(cs.triggerText(item), "A creature Casts a Spell you can see");
  assert.equal(cs.triggerText({ system: { description: { value: "<p>нет</p>" } } }), "");
});

const SC = { id: "s", grid: { size: 100, distance: 5 }, tokens: [] };
const FIRE = ["origin:action:slug:cast-a-spell", "origin:item:trait:fire"];
function mkAct(uuid, { rule = null, alliance = "opposition", level = 6, spent = false } = {}) {
  const items = [], actor = { uuid, name: uuid, id: uuid.split(".").pop(), items, type: "npc", itemTypes: { action: [], effect: [] }, alliance, level, isDead: false, hasPlayerOwner: false, getSelfRollOptions: (p) => [`${p}:${alliance}`], getRollOptions: () => [],
    getFlag: () => (spent ? { combat: "CB", round: 1 } : null) };
  if (rule) { const f = { type: "feat", id: "f1", uuid: `${uuid}.Item.f1`, name: "Контрзаклинание", slug: "counterspell", system: {}, flags: { [MOD]: { rule } }, actor, parent: actor }; items.push(f); uuids.set(f.uuid, f); }
  if (spent) game.combats = [{ id: "CB", round: 1, active: true, started: true, scene: {}, combatants: [{ actor }] }];
  uuids.set(uuid, actor);
  return actor;
}
const mkTk = (id, actor, x, y) => { const t = { id, uuid: `Scene.s.Token.${id}`, name: id, actor, x, y, width: 1, height: 1, hidden: false, parent: SC }; SC.tokens.push(t); uuids.set(t.uuid, t); return t; };
const cRule = (extra = {}, counter = { mod: 7, rank: 3 }) => validate({ v: 1, onEvent: [{ on: "spell-cast", side: "near", range: 30, cost: "reaction", counter, ...extra }] }).rule;
function castMsg(id, caster, ctok, { options = FIRE, targets = [], rank } = {}) {
  const m = mkDoc({ id, actor: caster, token: ctok, item: { name: "Огненный шар", rank: 3, spellcasting: { statistic: { dc: { value: 24 } } } }, rolls: [], timestamp: Date.now(),
    flags: { pf2e: { origin: { type: "spell", rollOptions: options, ...(rank && { castRank: rank }) } }, [MOD]: { use: { targets: targets.map((t) => ({ uuid: t.uuid })) } } } });
  msgs.set(id, m);
  return m;
}
beforeEach(() => { SC.tokens.length = 0; game.combats = []; CONFIG.Canvas.polygonBackends.move.testCollision = () => false; });

test("counterOptions: черты заклинания, враг/союзник, «единственная цель — вы», «вы или союзник в N фт»", () => {
  const owner = mkAct("Actor.o", { alliance: "party" }), foe = mkAct("Actor.f"), ally = mkAct("Actor.a", { alliance: "party" }), far = mkAct("Actor.far", { alliance: "party" });
  const me = mkTk("o", owner, 0, 0), tFoe = mkTk("f", foe, 500, 0), tAlly = mkTk("a", ally, 200, 0), tFar = mkTk("far", far, 1000, 0);
  const msg = castMsg("O1", foe, tFoe);
  const opts = (targets, when = null) => cs.counterOptions({ message: msg, owner, ownerToken: me, caster: foe, targets, when });
  assert.ok(opts([]).has("origin:item:trait:fire") && opts([]).has("target") && opts([]).has("origin:enemy"));
  assert.equal(opts([]).has("origin:ally"), false);
  assert.ok(opts([me]).has("spell-cast:targets-self-only"));
  assert.equal(opts([me, tAlly]).has("spell-cast:targets-self-only"), false, "целей две");
  assert.equal(opts([tAlly]).has("spell-cast:targets-self-only"), false);
  const when = [["spell-cast:targets-me-or-ally:15"]];
  assert.ok(opts([me], when).has("spell-cast:targets-me-or-ally:15"), "сам");
  assert.ok(opts([tAlly], when).has("spell-cast:targets-me-or-ally:15"), "союзник в 10 фт");
  assert.equal(opts([tFar], when).has("spell-cast:targets-me-or-ally:15"), false, "союзник далеко");
  assert.equal(opts([tFoe], when).has("spell-cast:targets-me-or-ally:15"), false, "враг рядом — не союзник");
  assert.equal(opts([me]).has("spell-cast:targets-me-or-ally:15"), false, "N, которого нет в when, не считаем");
  assert.ok(cs.counterOptions({ message: msg, owner, ownerToken: me, caster: ally, targets: [] }).has("origin:ally"));
});

test("candidates: дистанция, стена, when, реакция потрачена, свой токен и свой актёр исключены; порядок по расстоянию", () => {
  const caster = mkAct("Actor.c", { alliance: "party" });
  const tc = mkTk("c", caster, 0, 0);
  mkTk("c2", caster, 100, 0);   // второй токен того же актёра
  const mk = (id, x, o) => mkTk(id, mkAct(`Actor.${id}`, o), x, 0);
  mk("mid", 600, { rule: cRule() });       // зазор 5 клеток: 30 фт
  mk("near", 300, { rule: cRule() });      // 15 фт
  mk("far", 800, { rule: cRule() });       // 40 фт — вне
  mk("spent", 200, { rule: cRule(), spent: true });
  mk("when", 200, { rule: cRule({ when: ["origin:item:trait:divine"] }) });
  mk("wall", 400, { rule: cRule() });
  mk("noRule", 200);
  CONFIG.Canvas.polygonBackends.move.testCollision = (a) => Math.abs(a.x - 450) < 1;   // луч от центра токена wall (x=400 -> 450 px)
  globalThis.canvas = { scene: SC };   // стены проверяются только на просматриваемой сцене
  const list = cs.candidates(castMsg("K1", caster, tc));
  delete globalThis.canvas;
  assert.deepEqual(list.map((c) => c.token.id), ["near", "mid"], "wall за стеной; spent/when/far/noRule/свой — нет");
  assert.deepEqual(list.map((c) => c.dist), [15, 30]);
  assert.equal(list[0].entry.counter.mod, 7);
});

test("candidates: when с чертой проходит при нужной черте; не карточка сотворения / нет токена заклинателя — пусто", () => {
  const caster = mkAct("Actor.c", { alliance: "party" }), tc = mkTk("c", caster, 0, 0);
  mkTk("w", mkAct("Actor.w", { rule: cRule({ when: ["origin:item:trait:divine"] }) }), 200, 0);
  assert.equal(cs.candidates(castMsg("K2", caster, tc)).length, 0);
  assert.equal(cs.candidates(castMsg("K3", caster, tc, { options: [...FIRE, "origin:item:trait:divine"] })).length, 1);
  assert.deepEqual(cs.candidates(castMsg("K4", caster, null, { options: [...FIRE, "origin:item:trait:divine"] })), []);
  const atk = castMsg("K5", caster, tc, { options: [...FIRE, "origin:item:trait:divine"] }); atk.flags.pf2e.context = { type: "attack-roll" };
  assert.deepEqual(cs.candidates(atk), [], "бросок атаки — не сотворение");
});

test("onPreCreate: флаг удержания только при кандидатах; без них / режимы выключены / нет ГМа / уже удержана — карточка не тронута", () => {
  const caster = mkAct("Actor.c", { alliance: "party" }), tc = mkTk("c", caster, 0, 0);
  const pre = (m) => { m.updateSource = (d) => { m.src = d; }; cs.onPreCreate(m); return m.src?.flags?.[MOD]?.gate?.hold ?? null; };
  assert.equal(pre(castMsg("N1", caster, tc)), null, "нет кандидатов: карточка уходит мгновенно");
  mkTk("w", mkAct("Actor.w", { rule: cRule() }), 200, 0);
  const m = castMsg("N2", caster, tc);
  assert.equal(pre(m), "counter");
  assert.equal(m.src.flags[MOD].gate.manual, undefined, "диспетчер не пропускает");
  settings["mode.challenge"] = "off";
  assert.equal(pre(castMsg("N3", caster, tc)), null, "проверки выключены");
  settings["mode.challenge"] = "auto"; settings["mode.effect"] = "off";
  assert.equal(pre(castMsg("N4", caster, tc)), null);
  settings["mode.effect"] = "auto"; users = {};
  assert.equal(pre(castMsg("N5", caster, tc)), null, "нет активного ГМа");
  users = { activeGM: { id: "gm" } };
  const held = castMsg("N6", caster, tc); held.flags[MOD].gate = { hold: true };
  assert.equal(pre(held), null, "уже удержана (Святилище) — не трогаем");
  const bad = castMsg("N7", caster, tc); bad.updateSource = () => { throw new Error("boom"); };
  cs.onPreCreate(bad);   // сбой — молча
});

test("markCounterHold: manual — только для ручного удержания живых сценариев", () => {
  const m = { flags: {}, updateSource(d) { this.src = d; } };
  ev.markCounterHold(m, true);
  assert.deepEqual(m.src.flags[MOD].gate, { hold: "counter", manual: true });
  ev.markCounterHold(m);
  assert.deepEqual(m.src.flags[MOD].gate, { hold: "counter" });
});

test("runEntry: запись counter при выключенных проверках — тишина до окна (реакция цела)", async () => {
  const caster = mkAct("Actor.c", { alliance: "party" }), tc = mkTk("c", caster, 0, 0), owner = mkAct("Actor.w", { rule: cRule() });
  mkTk("w", owner, 200, 0);
  const found = ev.eventItems(owner)[0], cast = castMsg("G1", caster, tc);
  settings["mode.challenge"] = "off";
  assert.equal(await ev.runEntry({ id: "G1", message: cast, other: caster, options: new Set() }, owner, found, { i: 0, entry: found.rule.onEvent[0] }), null);
  assert.equal(created.length, 0);
});

/* --- run: окно, реакция, карточка проверки --- */

const build = (owner, item) => (r) => ({ kind: "use", rule: r, state: {}, targets: [], item: { name: item.name }, actor: owner.uuid });

test("run: окно -> spend -> карточка проверки (mod, СЛ заклинания, контр-ранг {half}, ранг сотворения, ключ окна); отказ и сбой траты — null", async () => {
  const owner = mkAct("Actor.o", { level: 8, alliance: "party" }), tOwner = mkTk("o", owner, 0, 0), caster = mkAct("Actor.c"), tc = mkTk("c", caster, 300, 0);
  const cast = castMsg("RN", caster, tc, { rank: 5 });
  cast.flags[MOD].gate = { hold: "counter" };
  const item = { name: "Контрзаклинание", system: { description: { value: "<p><strong>Trigger</strong> Casts</p>" } } };
  const entry = { counter: { mod: 11, rank: { half: "actor" } } };
  let spent = 0, asked = null;
  const ev0 = { message: cast, other: caster, ownerToken: tOwner };
  const go = (ask, spend) => cs.run({ ev: ev0, owner, item, entry, key: "RN:k:0", spend, build: build(owner, item), ask });
  assert.equal(await go(async () => null, async () => { spent++; return true; }), null, "окно закрыто");
  assert.equal(await go(async () => "yes", async () => false), null, "реакцию успели потратить");
  assert.equal(spent, 0);
  const id = await go(async (_u, title, prompt, choices, ms) => { asked = { title, prompt, ms }; return "yes"; }, async () => { spent++; return true; });
  assert.equal(spent, 1);
  assert.equal(asked.ms, cs.WINDOW_MS);
  assert.match(asked.prompt, /counter\.prompt.*counter\.trigger/, "условие способности — текстом из описания");
  const use = msgs.get(id).flags[MOD].use;
  assert.equal(use.state.event, "RN:k:0");
  assert.deepEqual(use.state.counter, { cast: "RN", counterRank: 4, targetRank: 5, spell: "Огненный шар", by: { item: "Контрзаклинание", actor: "Actor.o" }, caster: { token: "Scene.s.Token.c", actor: "Actor.c" } });
  assert.deepEqual(use.rule.onUse.check, { statistic: "counteract", label: "Контрзаклинание", mod: 11, vs: { dc: 24 }, rollerRole: "author", basic: false, byDegree: {} });
  assert.deepEqual(use.targets.map((t) => [t.key, t.name]), [["o", "Actor.c"]], "цель карточки — токен владельца (права, сокеты), подпись строки — заклинатель");
  assert.equal(msgs.get(id).flags.pf2e.origin.castRank, 5, "ранг сорванного — для формул шагов (@item.rank)");
  assert.equal(use.dc, 24);
  const sk = await cs.run({ ev: ev0, owner, item, entry: { counter: { statistic: "arcana", rank: 2 } }, key: "RN:k:1", spend: async () => true, build: build(owner, item), ask: async () => "yes" });
  const ck = msgs.get(sk).flags[MOD].use.rule.onUse.check;
  assert.deepEqual([ck.statistic, ck.mod], ["arcana", undefined], "навык — статистика владельца, без плоского mod");
  cast.item = { name: "X", rank: 1 };   // нет записи колдовства — СЛ по уровню заклинателя
  const lv = await cs.run({ ev: ev0, owner, item, entry, key: "RN:k:2", spend: async () => true, build: build(owner, item), ask: async () => "yes" });
  assert.equal(msgs.get(lv).flags[MOD].use.dc, 22);
});

test("run: сотворение уже не удержано (ГМ выпустил/сработала страховка) — окно не открывается, реакция не тратится; решили, пока ждало окно, — трата не идёт", async () => {
  const owner = mkAct("Actor.o", { level: 8 }), tOwner = mkTk("o", owner, 0, 0), caster = mkAct("Actor.c"), tc = mkTk("c", caster, 300, 0);
  const cast = castMsg("RH", caster, tc, { rank: 3 });
  const item = { name: "Контрзаклинание", system: { description: { value: "" } } }, entry = { counter: { mod: 11, rank: 3 } };
  let asked = 0, spent = 0;
  const go = (ask) => cs.run({ ev: { message: cast, other: caster, ownerToken: tOwner }, owner, item, entry, key: "RH:k:0", spend: async () => { spent++; return true; }, build: build(owner, item), ask });
  assert.equal(await go(async () => { asked++; return "yes"; }), null, "без удержания");
  assert.deepEqual([asked, spent], [0, 0]);
  cast.flags[MOD].gate = { hold: "counter" };
  assert.equal(await go(async () => { await hold.resolveManual("RH", "release"); return "yes"; }), null, "выпущено, пока ждало окно");
  assert.equal(spent, 0);
  assert.equal(created.length, 0, "карточки проверки нет");
});

test("canCounteract: statistic counteract без записи колдовства — нельзя, ГМу один шёпот; mod, навык и актёр с записью — можно", () => {
  users = Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } });
  const noEntry = mkAct("Actor.ne"), withEntry = { ...mkAct("Actor.we"), spellcasting: { some: (f) => [{ counteraction: {} }].some(f) } };
  assert.equal(cs.canCounteract(noEntry, { statistic: "counteract", rank: 1 }), false);
  assert.equal(cs.canCounteract(noEntry, { rank: 1, mod: 5 }), true);
  assert.equal(cs.canCounteract(noEntry, { statistic: "arcana", rank: 1 }), true);
  assert.equal(cs.canCounteract(withEntry, { statistic: "counteract", rank: 1 }), true);
  cs.canCounteract(noEntry, { statistic: "counteract", rank: 1 });
  assert.equal(created.length, 1, "предупреждение один раз");
  assert.match(created[0].content, /events\.counter\.noEntry/);
});

test("candidates: скрытый ГМом контрзаклинатель не отсекается", () => {
  const owner = mkAct("Actor.o", { alliance: "party" }), caster = mkAct("Actor.c"), tc = mkTk("c", caster, 300, 0), t = mkTk("o", owner, 0, 0);
  t.hidden = true;
  assert.equal(cs.candidates(castMsg("KH", caster, tc)).length >= 0, true);
  assert.equal(cs.candidates.toString().includes("t.hidden"), false);
});

/* --- диспетчер: цепочка --- */

const hostFor = (castId, state = {}) => { const h = mkDoc({ id: `host-${castId}-${msgs.size}`, flags: { [MOD]: { use: { dc: 24, state: { event: `${castId}:Actor.x.Item.f1:0`, ...state } } } } }); msgs.set(h.id, h); return h; };
const fakeCand = (n) => ({ owner: { uuid: `Actor.${n}`, name: n }, token: { id: n }, found: { item: { uuid: `Actor.${n}.Item.f1`, name: "Контрзаклинание" } }, i: 0, entry: {}, options: new Set() });
const nope = async () => { throw new Error("не должен"); };

test("advance: отказ первого -> второй; карточка проверки второго создана — цепочка ждёт броска, удержание не снято", async () => {
  const m = mkCast("Z1", COUNTER, { actor: { uuid: "Actor.c" }, token: { id: "t" } });
  const asked = [];
  const run = async (e, owner, found, entry, log) => {
    asked.push([owner.name, e.key]);
    if (owner.name !== "b") return null;   // a отказался
    const h = hostFor("Z1"); log.push({ key: e.key, recs: [], host: h.id });
  };
  await cs.advance("Z1", { run, list: () => [fakeCand("a"), fakeCand("b"), fakeCand("c")] });
  assert.deepEqual(asked.map((x) => x[0]), ["a", "b"], "c не спрашивали: проверка b ждёт");
  assert.equal(asked[0][1], "Z1:Actor.a.Item.f1:0", "ключ окна = id сотворения: hold.hostOf найдёт карточку");
  assert.equal(hold.isCounterHold(m), true);
  assert.equal(m.flags[MOD].events.length, 1, "журнал записи — на карточке сотворения");
  assert.ok(hold.hostOf(m));
});

test("advance: все отказались / кандидатов нет — выпуск (replay один раз); уже решено или проверка ждёт — ничего", async () => {
  const m = mkCast("Z2", COUNTER, { actor: { uuid: "Actor.c" }, token: { id: "t" } });
  let replays = 0;
  hold.replayers.add(async () => { replays++; });
  await cs.advance("Z2", { run: async () => null, list: () => [fakeCand("a"), fakeCand("b")] });
  assert.deepEqual([hold.isHeld(m), m.flags[MOD].gate.replayed, replays], [false, true, 1]);
  const none = mkCast("Z3", COUNTER);
  await cs.advance("Z3", { run: nope, list: () => [] });
  assert.equal(hold.isHeld(none), false, "кандидатов не осталось — выпуск: сомнение выпускаем");
  const waiting = mkCast("Z4", COUNTER); hostFor("Z4");
  await cs.advance("Z4", { run: nope, list: () => [fakeCand("a")] });
  assert.equal(hold.isCounterHold(waiting), true, "проверка уже ждёт броска");
  await cs.advance("нет", {});
  mkCast("Z5", { hold: false, replayed: true });
  await cs.advance("Z5", { run: nope, list: () => [fakeCand("a")] });
  assert.equal(replays, 2);
});

test("advance: ГМ решил вручную, пока ждали окно, — следующий кандидат не спрашивается, выпуска нет", async () => {
  const m = mkCast("Z6", COUNTER, { actor: { uuid: "Actor.c" }, token: { id: "t" } });
  const asked = [];
  await cs.advance("Z6", { list: () => [fakeCand("a"), fakeCand("b")], run: async (e, owner) => { asked.push(owner.name); await hold.resolveManual("Z6", "cancel"); } });
  assert.deepEqual(asked, ["a"]);
  assert.equal(hold.isCancelled(m) && hold.isCounterGate(m), true, "осталось сорванным, не выпущено");
});

test("onCreate: ручное удержание (gate.manual) и не-ГМ не обрабатываются", async () => {
  const man = mkCast("Z7", { hold: "counter", manual: true });
  hold.replayers.add(async () => {});
  await cs.onCreate(man);
  assert.equal(hold.isCounterHold(man), true);
  game.user.isActiveGM = false;
  const m = mkCast("Z8", COUNTER);
  await cs.onCreate(m);
  game.user.isActiveGM = true;
  assert.equal(hold.isCounterHold(m), true);
});

/* --- исход --- */

const resolvedHost = (castId, { degree, total = 25, dc = 24, counterRank = 3, targetRank = 3 }) => hostFor(castId, {
  counter: { cast: castId, counterRank, targetRank, spell: "Огненный шар", by: { item: "Контрзаклинание", actor: "Маг" } }, challenge: { results: { t1: { degree, total, dc } } }
});

test("onResult: успех по рангу -> сорвано (cancel), плашка «кем», итог строкой, карточка проверки помечена; цепочка не продолжается", async () => {
  const m = mkCast("Y1", COUNTER, { content: HTML });
  const h = resolvedHost("Y1", { degree: 2, targetRank: 4 });   // успех: до контр-ранга +1 = 4
  let next = 0;
  await cs.onResult(h.id, { next: async () => { next++; } });
  assert.deepEqual([hold.isCancelled(m), hold.isCounterHold(m), next], [true, false, 0]);
  assert.equal(m.content.includes("card-buttons"), false);
  assert.deepEqual(m.flags[MOD].gate.by, { item: "Контрзаклинание", actor: "Маг" });
  assert.equal(h.flags[MOD].use.state.counter.done, true);
  assert.equal(created.length, 1, "итоговая строка");
  assert.match(created[0].content, /events\.counter\.resultYes/);
  assert.equal(hold.hostOf(m), null, "карточка с исходом — след, не ожидание");
});

test("onResult: итоговая карточка по метаигре pf2e — итог/степень по results, СЛ по dcs (или заклинатель-PC); исход виден всегда", async () => {
  const fmt = game.i18n.format, pf = game.pf2e.settings;
  game.i18n.format = (k, v) => `${k}${JSON.stringify(v ?? {})}`;
  try {
    for (const [id, meta, pc, want] of [["M1", { dcs: false, results: false }, false, { detail: false, dc: false }], ["M2", { dcs: false, results: true }, false, { detail: true, dc: false }], ["M3", { dcs: true, results: true }, false, { detail: true, dc: true }], ["M4", { dcs: false, results: true }, true, { detail: true, dc: true }]]) {
      game.pf2e.settings = { ...(pf ?? {}), metagame: meta };
      mkCast(id, COUNTER);
      const h = resolvedHost(id, { degree: 2, targetRank: 4 });
      h.flags[MOD].use.state.counter.caster = { actor: `Actor.mg${id}` };
      uuids.set(`Actor.mg${id}`, { hasPlayerOwner: pc });
      await cs.onResult(h.id, { next: async () => {} });
      const t = created.at(-1).content;
      assert.equal(t.includes("resultDetail"), want.detail, `${id} детали`);
      assert.equal(t.includes("resultDc"), want.dc, `${id} СЛ`);
      assert.match(t, /resultYes/);
    }
  } finally { game.i18n.format = fmt; game.pf2e.settings = pf; }
});

test("onResult: не хватило степени / крит. провал -> следующий кандидат, сотворение удержано; повтор итога игнорируется", async () => {
  for (const [id, degree, targetRank] of [["Y2", 1, 3], ["Y3", 0, 1], ["Y4", 2, 5], ["Y5", 3, 7]]) {
    const m = mkCast(id, COUNTER), h = resolvedHost(id, { degree, targetRank });
    const nexts = [];
    await cs.onResult(h.id, { next: async (c) => nexts.push(c) });
    await cs.onResult(h.id, { next: async (c) => nexts.push(c) });
    assert.deepEqual([nexts, hold.isCounterHold(m), hold.isCancelled(m)], [[id], true, false], id);
    assert.match(created.at(-1).content, /resultNo/);
  }
});

test("onResult: переброс решённой проверки меняет исход — шёпот ГМу (уже исполнено / Отменить / Вернуть), исход не переигрывается; тот же исход — тишина", async () => {
  users = Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } });
  const m = mkCast("YR", { hold: false, replayed: true });
  const h = resolvedHost("YR", { degree: 3, targetRank: 3 });
  h.flags[MOD].use.state.counter.done = true;
  h.flags[MOD].use.state.counter.degree = 0;   // был крит. провал
  await cs.onResult(h.id, { next: nope });
  assert.equal(created.length, 1);
  assert.match(created[0].content, /events\.counter\.rerollLate/, "выпущенное сотворение: «Отменить» нет — снять последствия вручную");
  assert.equal(h.flags[MOD].use.state.counter.degree, 3);
  await cs.onResult(h.id, { next: nope });
  assert.equal(created.length, 1, "повтор — тишина");
  h.flags[MOD].use.state.challenge.results.t1.degree = 2;   // успех при ранге 3 против 3: срывает так же, как крит. успех
  await cs.onResult(h.id, { next: nope });
  assert.equal(created.length, 1, "исход не изменился");
  h.flags[MOD].use.state.challenge.results.t1.degree = 0;
  await cs.onResult(h.id, { next: nope });
  assert.equal(created.length, 1, "выпущено и теперь не сорвано — делать нечего");
  assert.equal(hold.isHeld(m), false);
  m.flags[MOD].gate = structuredClone(CANCELLED);   // сорвано -> переброс «не сорвано»: «Вернуть»
  h.flags[MOD].use.state.counter.degree = 3;
  await cs.onResult(h.id, { next: nope });
  assert.match(created[1].content, /events\.counter\.rerollNo/);
  m.flags[MOD].gate = structuredClone(COUNTER);   // ещё удержано -> переброс «сорвано»: «Отменить»
  h.flags[MOD].use.state.challenge.results.t1.degree = 3;
  await cs.onResult(h.id, { next: nope });
  assert.match(created[2].content, /events\.counter\.rerollYes/);
});

test("onResult: крит. успех срывает ранг до +3 включительно", async () => {
  const m = mkCast("Y6", COUNTER), h = resolvedHost("Y6", { degree: 3, targetRank: 6 });
  await cs.onResult(h.id, { next: nope });
  assert.equal(hold.isCancelled(m), true);
});

test("onResult: сотворение решено вручную / карточки нет / результата нет / не ГМ — ничего не делает", async () => {
  const done = mkCast("Y7", { hold: false, replayed: true }), h = resolvedHost("Y7", { degree: 3 });
  await cs.onResult(h.id, { next: nope });
  assert.deepEqual([done.flags[MOD].gate.cancelled, created.length], [undefined, 0]);
  await cs.onResult(resolvedHost("Gone", { degree: 3 }).id, { next: nope });
  const m = mkCast("Y8", COUNTER), h3 = hostFor("Y8", { counter: { cast: "Y8", counterRank: 3, targetRank: 3, by: { item: "x", actor: "y" } } });
  await cs.onResult(h3.id, { next: nope });
  assert.equal(hold.isCounterHold(m), true, "нет результата — ждём");
  game.user.isActiveGM = false;
  await cs.onResult(resolvedHost("Y8", { degree: 3 }).id, { next: nope });
  game.user.isActiveGM = true;
  assert.equal(hold.isCounterHold(m), true);
});

test("цепочка целиком: первый провалил проверку -> второй; второй сорвал -> один срыв, третьего не спрашиваем", async () => {
  const m = mkCast("Y9", COUNTER, { content: HTML, actor: { uuid: "Actor.c" }, token: { id: "t" } });
  const asked = [], list = () => [fakeCand("a"), fakeCand("b"), fakeCand("c")];
  const counter = { cast: "Y9", counterRank: 3, targetRank: 3, spell: "S", by: { item: "I", actor: "A" } };
  const run = async (e, owner, found, entry, log) => {   // как runEntry: уже спрошенного не спрашивает
    if (asked.includes(owner.name)) return null;
    asked.push(owner.name);
    const h = hostFor("Y9", { counter: { ...counter } }); log.push({ key: e.key, recs: [], host: h.id });
  };
  const roll = (degree) => {
    const h = [...msgs.values()].filter((x) => String(x.flags?.[MOD]?.use?.state?.event).startsWith("Y9:") && !x.flags[MOD].use.state.counter.done).at(-1);
    h.flags[MOD].use.state.challenge = { results: { t: { degree, total: 10, dc: 24 } } };
    return cs.onResult(h.id, { next: (id) => cs.advance(id, { run, list }) });
  };
  hold.replayers.add(async () => { throw new Error("replay не должен звониться"); });
  await cs.advance("Y9", { run, list });
  assert.deepEqual(asked, ["a"]);
  await roll(1);   // ранг 3 против контр-ранга 3 при провале не срывается
  assert.deepEqual(asked, ["a", "b"]);
  assert.equal(hold.isCounterHold(m), true);
  await roll(3);
  assert.deepEqual([asked, hold.isCancelled(m), m.content.includes("card-buttons")], [["a", "b"], true, false]);
  assert.equal(created.filter((x) => /resultYes/.test(x.content)).length, 1, "срыв один раз");
});

test("saves.recordResult -> onResult: итог броска проверки реакции срывает удержанное сотворение", async () => {
  const m = mkCast("V1", COUNTER, { content: HTML });
  const h = hostFor("V1", { counter: { cast: "V1", counterRank: 3, targetRank: 3, spell: "S", by: { item: "I", actor: "A" } } });
  h.flags[MOD].use.rule = { v: 1, onUse: { targets: "selected", check: { statistic: "counteract", rollerRole: "author" } } };
  const r = await saves.recordResult(h.id, "t1", { degree: 2, total: 26, dc: 24 });
  assert.equal(r.ok, true);
  assert.deepEqual([hold.isCancelled(m), h.flags[MOD].use.state.counter.done], [true, true]);
});

test("lang: events.counter.* и hold.counterCancelledBy парны в ru и en, подстановки совпадают", async () => {
  const { readFileSync } = await import("node:fs");
  const j = (l) => JSON.parse(readFileSync(new URL(`../lang/${l}/events.json`, import.meta.url), "utf8")).PF2E_AUTOMATO;
  const [ru, en] = [j("ru"), j("en")], vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join();
  assert.deepEqual(Object.keys(ru.events.counter).sort(), Object.keys(en.events.counter).sort());
  assert.deepEqual(Object.keys(ru.events.counter).sort(), ["choose", "expends", "host", "noEntry", "noSlot", "payPrepared", "paySlot", "pick", "prompt", "rerollLate", "rerollNo", "rerollYes", "resultDc", "resultDetail", "resultNo", "resultYes", "revertDamage", "trigger", "use"]);
  for (const k of Object.keys(ru.events.counter)) assert.equal(vars(ru.events.counter[k]), vars(en.events.counter[k]), `подстановки counter.${k}`);
  assert.equal(vars(ru.hold.counterCancelledBy), vars(en.hold.counterCancelledBy));
  assert.equal(vars(ru.hold.counterCancelledBy), "actor,item");
});

/* ---------- M4.8: последствия по исходу, иммунитет, частота, range any ---------- */

const apply = await import("../scripts/apply.mjs");
const { setSocket } = await import("../scripts/util.mjs");
const merge = (a, b) => { const out = structuredClone(a), m = (x, y) => { for (const [k, v] of Object.entries(y)) x[k] = v && typeof v === "object" && !Array.isArray(v) && x[k] && typeof x[k] === "object" ? m(x[k], v) : v; return x; }; return m(out, b); };
foundry.utils.mergeObject = merge;
foundry.utils.getProperty ??= getDeep;

/** Актёр, которому можно создавать эффекты и наносить урон: hits — применённый урон, у каждого — формула броска. */
function mkTarget(a) {
  a.hits = []; a.itemTypes = { action: [], effect: [], condition: [] }; a.attributes = {};
  a.applyDamage = async (d) => { a.hits.push({ total: d.damage.total, formula: d.damage.formula, done: a.watch?.() }); };
  a.createEmbeddedDocuments = async (_t, data) => data.map((d) => {
    const n = a.items.length + 1, it = { ...d, id: `i${n}`, uuid: `${a.uuid}.Item.i${n}`, actor: a, parent: a, async delete() { a.items.splice(a.items.indexOf(it), 1); uuids.delete(it.uuid); } };
    a.items.push(it); uuids.set(it.uuid, it); return it;
  });
  return a;
}
const dmgRolls = () => {
  CONFIG.PF2E.damageTypes = { void: {}, mental: {} };
  CONFIG.Dice = { rolls: [class DamageRoll { constructor(f) { this.formula = f; } async evaluate() { this.total = 7; return this; } alter() { return this; } }] };
  game.pf2e.ConditionManager.getCondition = () => ({ toObject: () => ({ name: "Persistent", type: "condition", system: {}, flags: {} }) });
};
const IMMUNITY = { slug: "kara", scope: "slug", duration: { value: 24, unit: "hours" } };
const PERS = { to: "target", persistent: { formula: "1d10", damageType: "void" } }, HIT = { to: "self", damage: { formula: "(@item.rank)d8", damageType: "mental" } };
const buildT = (owner, item, tok) => (r) => ({ kind: "use", rule: r, state: {}, targets: [], item: { name: item.name }, actor: owner.uuid, token: tok.uuid });
/** Сценарий: владелец с записью counter, заклинатель сотворяет заклинание ранга rank; -> { owner, caster, cast, host, tOwner, tc } */
async function scenario(counter, { rank = 3, id = "E1" } = {}) {
  dmgRolls();
  const owner = mkTarget(mkAct("Actor.o", { level: 8, alliance: "party" })), tOwner = mkTk("o", owner, 0, 0);
  const caster = mkTarget(mkAct("Actor.c")), tc = mkTk("c", caster, 300, 0);
  const cast = castMsg(id, caster, tc, { rank }); cast.flags[MOD].gate = { hold: "counter" }; cast.content = HTML;
  const item = { name: "Кара", system: { description: { value: "" } } };
  const hid = await cs.run({ ev: { message: cast, other: caster, otherToken: tc, ownerToken: tOwner }, owner, item, entry: { counter }, key: `${id}:k:0`, spend: async () => true, build: buildT(owner, item, tOwner), ask: async () => "yes" });
  return { owner, caster, cast, host: msgs.get(hid), tOwner, tc };
}

test("stepsByDegree: onCounter — степени срыва, onFail — остальные, иммунитет — только несрыв (успех без срыва по рангу тоже)", () => {
  const c = { onCounter: [PERS], onFail: [{ to: "self", note: "n" }], immunity: IMMUNITY };
  let r = cs.stepsByDegree(c, 4, 3);   // контр-ранг 4 против ранга 3: срывают провал, успех, крит. успех
  assert.deepEqual(r.byDegree, { criticalFailure: c.onFail, failure: [PERS], success: [PERS], criticalSuccess: [PERS] });
  assert.deepEqual(r.immunity.degrees, ["criticalFailure"], "только крит. провал");
  r = cs.stepsByDegree(c, 3, 5);   // ранг заклинания выше: срывает только крит. успех; успех и провал — не срыв, иммунитет при них тоже
  assert.deepEqual(r.immunity.degrees, ["criticalFailure", "failure", "success"]);
  assert.deepEqual([r.byDegree.success, r.byDegree.criticalSuccess], [c.onFail, c.onCounter]);
  assert.equal(cs.stepsByDegree(c, 3, 9).immunity.degrees, undefined, "не срывает ни одна степень: иммунитет при любой");
  assert.deepEqual(cs.stepsByDegree({ onCounter: [PERS] }, 3, 3), { byDegree: { success: [PERS], criticalSuccess: [PERS] }, immunity: null });
  assert.notEqual(r.byDegree.criticalSuccess, c.onCounter, "шаги копируются: правка карточки не меняет каталог");
});

test("валидатор counter (M4.8): onCounter/onFail/immunity, статистика-массив, range any, запреты", () => {
  const ok = (counter, extra = {}) => validate(entry(counter, extra));
  const c = { mod: 5, rank: 2, onCounter: [PERS, { to: "self", note: "x" }], onFail: [{ to: "target", condition: { slug: "stunned", value: 1 } }], immunity: IMMUNITY };
  const v = ok(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.rule.onEvent[0].counter.immunity, IMMUNITY);
  assert.deepEqual(ok({ mod: 5, rank: 2, onCounter: [], onFail: [] }).rule.onEvent[0].counter, { mod: 5, rank: 2 }, "пустые списки отбрасываются");
  assert.deepEqual(ok({ statistic: ["arcana", "nature"], rank: 1 }).rule.onEvent[0].counter.statistic, ["arcana", "nature"]);
  for (const bad of [["arcana"], ["a", "b", "c", "d", "e"], ["arcana", "arcana"], ["arcana", 5], []]) assert.equal(ok({ statistic: bad, rank: 1 }).ok, false, JSON.stringify(bad));
  for (const step of [{ to: "party", note: "x" }, { to: "allies", range: 10, note: "x" }, { to: "chosen", condition: { slug: "stunned" } }, { to: "self", choose: { from: "options", options: ["a", "b"] } },
    { to: "target", move: { mode: "push", distance: 10 } }, { to: "self", hold: "release" }, { to: "target", damage: { formula: "1d6", damageType: "fire", basic: true } }]) {
    assert.equal(ok({ mod: 5, rank: 2, onCounter: [step] }).ok, false, JSON.stringify(step));
  }
  assert.equal(ok({ mod: 5, rank: 2, immunity: { ...IMMUNITY, degrees: ["failure"] } }).ok, false, "степени считает run");
  assert.equal(ok({ mod: 5, rank: 2, immunity: { slug: "x" } }).ok, false, "нужен срок");
  const near = (e) => validate({ v: 1, onEvent: [{ on: "spell-cast", side: "near", cost: "reaction", counter: { mod: 5, rank: 2 }, ...e }] });
  assert.equal(near({ range: "any" }).rule.onEvent[0].range, "any");
  assert.equal(near({}).ok, false, "забытое поле не становится «везде»");
  assert.equal(near({ range: "anywhere" }).ok, false);
  assert.equal(near({ range: "any", aura: "x" }).ok, false);
  assert.equal(validate({ v: 1, onEvent: [{ on: "turn-start", side: "near", range: "any", apply: [{ to: "self", note: "x" }] }] }).ok, false, "any — только у counter");
  // counter несовместим с apply / challenge / check / use
  for (const extra of [{ apply: [{ to: "self", note: "x" }] }, { challenge: { statistic: "will", dc: { value: 20 } } }, { check: { statistic: "arcana", dc: { ofTargets: "level" } } }, { use: true }]) assert.equal(ok({ mod: 5, rank: 2 }, extra).ok, false, JSON.stringify(extra));
});

test("round-trip листа: range any, шаги, иммунитет и массив навыков переживают форму; числом тоже можно", () => {
  const rule = validate({ v: 1, onEvent: [{ on: "spell-cast", side: "near", range: "any", cost: "reaction", counter: { statistic: ["arcana", "nature"], rank: { half: "actor" }, onCounter: [PERS], onFail: [{ to: "self", note: "n" }], immunity: IMMUNITY } }] }).rule;
  const form = ruleToForm(rule);
  const back = validate(formToRule(form));
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.equal(back.rule.onEvent[0].range, "any");
  assert.deepEqual(back.rule.onEvent[0].counter, rule.onEvent[0].counter);
  const f2 = ruleToForm(rule); f2.ev[0].range = " 45 ";
  assert.equal(validate(formToRule(f2)).rule.onEvent[0].range, 45);
});

test("candidates: range any — кандидат на 500 фт; за стеной — нет (стены в силе); число — как раньше", () => {
  const caster = mkAct("Actor.c", { alliance: "party" }), tc = mkTk("c", caster, 0, 0);
  mkTk("far", mkAct("Actor.far", { rule: cRule({ range: "any" }) }), 10000, 0);   // 100 клеток = 500 фт
  mkTk("lim", mkAct("Actor.lim", { rule: cRule({ range: 30 }) }), 10000, 0);
  assert.deepEqual(cs.candidates(castMsg("R1", caster, tc)).map((c) => c.token.id), ["far"]);
  mkTk("wall", mkAct("Actor.wall", { rule: cRule({ range: "any" }) }), 4000, 0);
  CONFIG.Canvas.polygonBackends.move.testCollision = (a) => Math.abs(a.x - 4050) < 1;
  globalThis.canvas = { scene: SC };
  const ids = cs.candidates(castMsg("R2", caster, tc)).map((c) => c.token.id);
  delete globalThis.canvas;
  assert.deepEqual(ids, ["far"]);
});

test("run: последствия разложены по степеням карточки проверки, иммунитет — по степеням несрыва, ранг сорванного — в карточке, цель — владелец, заклинатель — в state", async () => {
  const s = await scenario({ mod: 11, rank: 4, onCounter: [PERS], onFail: [{ to: "self", note: "n" }], immunity: IMMUNITY }, { rank: 5 });
  const ck = s.host.flags[MOD].use.rule.onUse.check;
  assert.deepEqual(Object.keys(ck.byDegree).sort(), ["criticalFailure", "criticalSuccess", "failure", "success"], "ранг 5 против 4: срывают успех (до 5) и крит. успех");
  assert.deepEqual([ck.byDegree.success, ck.byDegree.failure], [[PERS], [{ to: "self", note: "n" }]]);
  assert.deepEqual(ck.immunity.degrees, ["criticalFailure", "failure"]);
  assert.equal(s.host.flags.pf2e.origin.castRank, 5);
  assert.deepEqual(s.host.flags[MOD].use.targets.map((t) => t.key), ["o"], "цель карточки — токен владельца: права строки, сокеты и скрытые итоги — как у любой проверки автора");
  assert.deepEqual(s.host.flags[MOD].use.state.counter.caster, { token: "Scene.s.Token.c", actor: "Actor.c" });
});

test("последствия срыва (Chastise-подобная): после counter.done — продолжительный урон заклинателю и урон владельцу обычным применением; ранг сорванного в формуле; иммунитета при срыве нет", async () => {
  const s = await scenario({ mod: 11, rank: 4, onCounter: [PERS, HIT], immunity: IMMUNITY }, { rank: 3 });
  s.owner.watch = () => s.host.flags[MOD].use.state.counter?.done;
  const r = await saves.recordResult(s.host.id, "o", { degree: 2, total: 26, dc: 24 });
  assert.equal(r.ok, true);
  assert.equal(hold.isCancelled(s.cast), true, "сорвано");
  assert.deepEqual(s.caster.items.map((i) => i.type), ["condition"], "продолжительный урон — на заклинателе");
  assert.equal(s.caster.items[0].system.persistent.damageType, "void");
  assert.equal(s.owner.items.some((i) => i.type === "condition"), false, "владелец продолжительного урона не получил");
  assert.deepEqual(s.owner.hits.map((h) => [h.formula, h.done]), [["(3d8)[mental]", true]], "ранг сорванного (3) в формуле; counter.done записан до применения");
  assert.equal(s.caster.items.some((i) => i.flags?.[MOD]?.immunity), false, "срыв — иммунитета нет");
  assert.equal(created.some((m) => /resultYes/.test(m.content)), true);
});

test("иммунитет по несрыву: успех без срыва (ранг заклинания выше) ставит иммунитет заклинателю и выпускает сотворение; повторное сотворение кандидата не даёт", async () => {
  const s = await scenario({ mod: 11, rank: 3, onCounter: [PERS], immunity: IMMUNITY }, { rank: 5 });
  await saves.recordResult(s.host.id, "o", { degree: 2, total: 26, dc: 24 });   // успех: до ранга 4, а заклинание 5 — не сорвано
  assert.equal(hold.isCancelled(s.cast), false);
  assert.equal(hold.isHeld(s.cast), false, "кандидатов больше нет — выпуск");
  const imm = s.caster.items.find((i) => i.flags?.[MOD]?.immunity);
  assert.equal(imm?.flags[MOD].immunity.slug, "kara");
  assert.equal(imm.system.context.origin.actor, "Actor.o");
  assert.equal(s.caster.items.some((i) => i.type === "condition"), false, "onCounter не исполнялся");
  const o2 = mkAct("Actor.o2", { rule: cRule({}, { mod: 5, rank: 3, immunity: IMMUNITY }) }); mkTk("o2", o2, 100, 0);
  assert.equal(cs.candidates(castMsg("E1b", s.caster, s.tc)).length, 0, "иммунный заклинатель: кандидат отсечён молча");
  s.caster.items.length = 0;
  assert.equal(cs.candidates(castMsg("E1c", s.caster, s.tc)).length, 1, "без иммунитета — кандидат");
});

test("иммунитет при крит. провале и провале по рангу; при срыве не ставится", async () => {
  for (const [degree, rank, imm] of [[0, 3, true], [1, 5, true], [3, 5, false]]) {
    const s = await scenario({ mod: 11, rank: 3, onCounter: [HIT], immunity: IMMUNITY }, { rank, id: `I${degree}${rank}` });
    await saves.recordResult(s.host.id, "o", { degree, total: 20, dc: 24 });
    assert.equal(s.caster.items.some((i) => i.flags?.[MOD]?.immunity), imm, `степень ${degree}, ранг ${rank}`);
  }
});

test("«Вернуть» сорванное откатывает последствия срыва; иммунитет от провала прежнего кандидата остаётся", async () => {
  const s = await scenario({ mod: 11, rank: 4, onCounter: [PERS], onFail: [{ to: "self", note: "n" }], immunity: IMMUNITY }, { rank: 3, id: "B1" });
  await saves.recordResult(s.host.id, "o", { degree: 3, total: 30, dc: 24 });
  assert.equal(s.caster.items.length, 1);
  assert.equal(msgs.get(s.host.id).flags[MOD].use.state.counter.done, true);
  assert.equal(hold.hostOf(s.cast), null, "hostOf решённую отбрасывает — карточку ищем по state.counter.cast");
  await hold.resolveManual("B1", "release");
  assert.equal(s.caster.items.length, 0, "продолжительный урон снят штатным откатом применения");
  assert.equal(hold.isCancelled(s.cast), false);
  const f = await scenario({ mod: 11, rank: 3, onCounter: [PERS], immunity: IMMUNITY }, { rank: 5, id: "B2" });
  await saves.recordResult(f.host.id, "o", { degree: 1, total: 10, dc: 24 });
  assert.equal(f.caster.items.some((i) => i.flags?.[MOD]?.immunity), true);
  f.cast.flags[MOD].gate = structuredClone(CANCELLED);   // другой кандидат сорвал, ГМ «возвращает»
  await hold.resolveManual("B2", "release");
  assert.equal(f.caster.items.some((i) => i.flags?.[MOD]?.immunity), true, "иммунитет от провала прежнего кандидата в силе");
});

test("переброс после применения: changedAfterApply, шаги не повторяются, ГМу шёпот", async () => {
  users = Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } });
  const s = await scenario({ mod: 11, rank: 4, onCounter: [PERS] }, { rank: 3, id: "P1" });
  await saves.recordResult(s.host.id, "o", { degree: 3, total: 30, dc: 24 });
  assert.equal(s.caster.items.length, 1);
  const r = await saves.recordResult(s.host.id, "o", { degree: 0, total: 4, dc: 24, isReroll: true, rollMessageId: "rr" });
  assert.deepEqual([r.ok, r.changed], [true, true]);
  const st = msgs.get(s.host.id).flags[MOD].use.state;
  assert.equal(st.challenge.results.o.changedAfterApply, true);
  assert.equal(st.counter.degree, 0);
  assert.equal(s.caster.items.length, 1, "повторно не применялось");
  assert.ok(created.some((m) => /rerollNo|changedAfterApply/.test(m.content)), "ГМ видит смену исхода");
  await hold.resolveManual("P1", "release");   // «Вернуть» после переброса: откатывается то, что было применено при срыве
  assert.equal(s.caster.items.length, 0, "применённое при срыве снято, хотя итог переброса — уже не срыв");
});

test("applyByDegree: нет токена заклинателя — шаги to:target не исполняются на владельце, шаги self — да", async () => {
  const s = await scenario({ mod: 11, rank: 4, onCounter: [PERS, HIT] }, { rank: 3, id: "G1" });
  uuids.delete("Scene.s.Token.c");
  await saves.recordResult(s.host.id, "o", { degree: 3, total: 30, dc: 24 });
  assert.equal(s.owner.items.some((i) => i.type === "condition"), false, "урон заклинателю не ушёл владельцу");
  assert.equal(s.owner.hits.length, 1, "шаги self исполнены");
});

/* --- частота --- */

function freqOwner(value = 1) {
  const owner = mkTarget(mkAct("Actor.w", { rule: cRule({ range: "any" }, { mod: 5, rank: 3 }) }));
  const item = owner.items[0];
  item.system = { frequency: { value, max: 1, per: "day" }, description: { value: "" } };
  item.update = async (d) => { item.system.frequency.value = d["system.frequency.value"]; item.upd = (item.upd ?? 0) + 1; };
  return { owner, item, tok: mkTk("w", owner, 200, 0) };
}

test("частота 1/день: исчерпана — кандидат отсечён молча; режим limits off — не проверяется", () => {
  const caster = mkAct("Actor.c", { alliance: "party" }), tc = mkTk("c", caster, 0, 0), { item } = freqOwner(1);
  assert.equal(cs.candidates(castMsg("F1", caster, tc)).length, 1);
  item.system.frequency.value = 0;
  assert.equal(cs.candidates(castMsg("F2", caster, tc)).length, 0);
  settings["mode.limits"] = "off";
  assert.equal(cs.candidates(castMsg("F3", caster, tc)).length, 1);
  delete settings["mode.limits"];
});

test("частота: два окна параллельно — 1/день не срабатывает дважды; трата в spend; отказ в окне частоту не тратит", async () => {
  dmgRolls();
  users = Object.assign([{ id: "p", isGM: false, active: true }], { activeGM: { id: "gm" } });
  const { owner, item } = freqOwner(1);
  owner.testUserPermission = () => true;
  const found = ev.eventItems(owner)[0], entry = found.rule.onEvent[0];
  const mkEv = (id, casterId) => { const c = mkAct(`Actor.${casterId}`, { alliance: "party" }), t = mkTk(casterId, c, 0, 0), m = castMsg(id, c, t, { rank: 2 }); m.flags[MOD].gate = { hold: "counter" }; return { id, message: m, other: c, otherToken: t, ownerToken: tokenOfOwner(), options: new Set() }; };
  const tokenOfOwner = () => SC.tokens.find((t) => t.actor === owner);
  setSocket({ executeAsUser: async () => null });
  assert.equal(await ev.runEntry(mkEv("Q0", "c0"), owner, found, { i: 0, entry }, []), null, "отказ в окне");
  assert.equal(item.system.frequency.value, 1, "частота при отказе цела");
  setSocket({ executeAsUser: async () => "yes" });
  const [la, lb] = [[], []];
  await Promise.all([ev.runEntry(mkEv("Q1", "ca"), owner, found, { i: 0, entry }, la), ev.runEntry(mkEv("Q2", "cb"), owner, found, { i: 0, entry }, lb)]);
  assert.equal(item.system.frequency.value, 0);
  assert.equal(item.upd, 1, "списано один раз");
  assert.equal([...la, ...lb].filter((r) => r.host).length, 1, "карточка проверки одна: второе окно получило отказ spend()");
  setSocket(null);
});

test("заметки: note без when — в плане строки карточки проверки; note с when — шёпотом при нужной степени, без имени заклинателя у to:self", async () => {
  const { buildViewModel } = await import("../scripts/chat.mjs");
  const s = await scenario({ mod: 11, rank: 4, onCounter: [{ to: "self", note: "Щит получает урон" }] }, { rank: 3, id: "N1" });
  const m = msgs.get(s.host.id);
  m.flags[MOD].use.state.challenge = { results: { o: { degree: 3, total: 30, dc: 24 } } };
  const env = { t: (k) => k, mode: () => "auto", isOwner: () => true, isActorOwner: () => true, isPc: () => false, isActorPc: () => false, immune: () => false, tokenName: () => "x", statLabel: (x) => x, checkDc: () => 24, conditionLabel: (x) => x, uuidName: () => null, itemBasic: () => false };
  assert.ok(JSON.stringify(buildViewModel(m, { isGM: true, id: "gm" }, env)).includes("Щит получает урон"));
  const step = [{ to: "self", note: "Аура гаснет", when: ["outcome:criticalFailure"] }];
  await apply.applyOps(m, "o", step, { scope: "challenge", degree: 1, target: s.tc });
  assert.equal(created.some((c) => /Аура гаснет/.test(c.content)), false, "не крит. провал — заметки нет");
  const before = created.length;
  await apply.applyOps(m, "o", step, { scope: "challenge", degree: 0, target: s.tc });
  assert.equal(created.length, before + 1);
  assert.doesNotMatch(created.at(-1).content, /<b>/, "заметка о владельце (to:self) не подписана именем заклинателя");
});

/* ---------- правки после критики ---------- */

test("страховка: таймер armCounter и sweepCounter не выпускают сотворение, пока применяются последствия исхода (hostOf решённую не видит)", async () => {
  const m = mkCast("W1", { ...COUNTER }, { timestamp: Date.now() - hold.COUNTER_STUCK_MS - 1000 });
  const h = resolvedHost("W1", { degree: 3, targetRank: 3 });
  let calls = 0, heldDuring = null;
  hold.replayers.add(async () => { calls++; });
  await cs.onResult(h.id, {
    apply: async () => {   // урон с анимацией: страховка успевает сработать
      hold.armCounter(m, 5);
      await wait(40);
      await hold.sweepCounter();
      heldDuring = hold.isCounterHold(m);
    }
  });
  assert.deepEqual([heldDuring, calls], [true, 0], "во время применения выпуска нет");
  assert.deepEqual([hold.isCancelled(m), hold.isHeld(m), calls], [true, false, 0], "сорвано один раз, replay не было");
  hold.armCounter(mkCast("W2", COUNTER), 5);   // метка снята: обычная страховка работает как прежде
  await wait(40);
  assert.equal(calls, 1);
});

test("частота: два «да» подряд при асинхронном update — списание одно, spend второго отказывает; chargeFrequency на нуле — false; бронь снимается", async () => {
  dmgRolls();
  users = Object.assign([{ id: "p", isGM: false, active: true }], { activeGM: { id: "gm" } });
  const { owner, item } = freqOwner(1);
  item.update = async (d) => { await wait(20); item.system.frequency.value = d["system.frequency.value"]; item.upd = (item.upd ?? 0) + 1; };   // данные меняются не сразу
  owner.testUserPermission = () => true;
  const found = ev.eventItems(owner)[0], entry = found.rule.onEvent[0];
  const tokenOfOwner = () => SC.tokens.find((t) => t.actor === owner);
  const mkEv = (id, casterId) => { const c = mkAct(`Actor.${casterId}`, { alliance: "party" }), t = mkTk(casterId, c, 0, 0), m = castMsg(id, c, t, { rank: 2 }); m.flags[MOD].gate = { hold: "counter" }; return { id, message: m, other: c, otherToken: t, ownerToken: tokenOfOwner(), options: new Set() }; };
  setSocket({ executeAsUser: async () => "yes" });
  const [la, lb] = [[], []];
  await Promise.all([ev.runEntry(mkEv("QA", "cc"), owner, found, { i: 0, entry }, la), ev.runEntry(mkEv("QB", "cd"), owner, found, { i: 0, entry }, lb)]);
  assert.deepEqual([item.system.frequency.value, item.upd], [0, 1], "списано один раз");
  assert.equal([...la, ...lb].filter((r) => r.host).length, 1, "карточка проверки одна");
  assert.equal(await cs.chargeFrequency(item, []), false, "на нуле — отказ, а не молчаливый успех");
  assert.equal(await cs.chargeFrequency({ system: {} }, []), true, "предмет без частоты — списывать нечего, не отказ");
  assert.equal(cs.reserve(owner, item), false, "исчерпана — брони нет");
  item.system.frequency.value = 1;
  assert.equal(cs.reserve(owner, item), true);
  assert.equal(cs.reserve(owner, item), false, "уже забронировано");
  cs.unreserve(item);
  assert.equal(cs.reserve(owner, item), true, "бронь снята");
  cs.unreserve(item);
  // runEntry уже сериализует окна владельца очередью reaction:<uuid>; бронь — страховка там, где спенд идёт мимо неё: две одновременные последовательности «бронь -> списание»
  item.system.frequency.value = 1; item.upd = 0;
  const seq = async () => { if (!cs.reserve(owner, item)) return false; try { return await cs.chargeFrequency(item, []); } finally { cs.unreserve(item); } };
  assert.deepEqual(await Promise.all([seq(), seq()]), [true, false], "второй отказ, а не молчаливый успех");
  assert.deepEqual([item.system.frequency.value, item.upd], [0, 1]);
  setSocket(null);
});

test("заметка to:self с when: на обычной карточке подпись с именем цели остаётся (регресс общего applyOps), на карточке контрзаклинания — снята", async () => {
  const s = await scenario({ mod: 11, rank: 4, onCounter: [{ to: "self", note: "x" }] }, { rank: 3, id: "N2" });
  const m = msgs.get(s.host.id), step = [{ to: "self", note: "Аура гаснет", when: ["outcome:criticalFailure"] }];
  const st = m.flags[MOD].use.state, counter = st.counter;
  delete st.counter;   // обычная карточка проверки
  await apply.applyOps(m, "o", step, { scope: "challenge", degree: 0, target: s.tc });
  assert.match(created.at(-1).content, /<b>c<\/b>/, "обычная карточка: имя цели есть");
  st.counter = counter; st.challenge = { applied: {} };
  const n = created.length;
  await apply.applyOps(m, "o", step, { scope: "challenge", degree: 0, target: s.tc });
  assert.equal(created.length, n + 1);
  assert.doesNotMatch(created.at(-1).content, /<b>/);
});

test("«Вернуть» при мгновенном уроне срыва: шёпот ГМу «откатите кнопкой pf2e»; без урона — тишина; карточка помечена reverted", async () => {
  users = Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } });
  const a = await scenario({ mod: 11, rank: 4, onCounter: [HIT] }, { rank: 3, id: "D1" });
  await saves.recordResult(a.host.id, "o", { degree: 3, total: 30, dc: 24 });
  assert.equal(msgs.get(a.host.id).flags[MOD].use.state.challenge.applied.o.ops.some((o) => o.op === "damaged"), true, "урон применён и записан");
  await hold.resolveManual("D1", "release");
  assert.equal(created.filter((c) => /revertDamage/.test(c.content)).length, 1);
  assert.equal(msgs.get(a.host.id).flags[MOD].use.state.counter.reverted, true);
  const b = await scenario({ mod: 11, rank: 4, onCounter: [PERS] }, { rank: 3, id: "D2" });
  await saves.recordResult(b.host.id, "o", { degree: 3, total: 30, dc: 24 });
  const before = created.length;
  await hold.resolveManual("D2", "release");
  assert.equal(created.slice(before).some((c) => /revertDamage/.test(c.content)), false, "без урона шёпота нет");
});

test("после «Вернуть» карточка проверки не предлагает и не исполняет «Применить» (apply=button, срыв не был применён)", async () => {
  const { buildViewModel } = await import("../scripts/chat.mjs");
  settings["mode.apply"] = "button";
  const s = await scenario({ mod: 11, rank: 4, onCounter: [PERS] }, { rank: 3, id: "V1" });
  await saves.recordResult(s.host.id, "o", { degree: 3, total: 30, dc: 24 });
  assert.equal(hold.isCancelled(s.cast), true);
  const env = { t: (k) => k, mode: (k) => settings[`mode.${k}`], isOwner: () => true, isActorOwner: () => true, isPc: () => false, isActorPc: () => false, immune: () => false, tokenName: () => "x", statLabel: (x) => x, checkDc: () => 24, conditionLabel: (x) => x, uuidName: () => null, itemBasic: () => false };
  const canApply = () => JSON.stringify(buildViewModel(msgs.get(s.host.id), { isGM: true, id: "gm" }, env)).match(/"canApply":(true|false)/)?.[1];
  assert.equal(canApply(), "true", "до «Вернуть» кнопка есть");
  await hold.resolveManual("V1", "release");
  assert.equal(canApply(), "false", "после «Вернуть» кнопки нет");
  assert.deepEqual(await saves.applyByDegree(s.host.id, "o"), []);
  assert.equal(s.caster.items.length, 0, "продолжительный урон заклинателю не наложен");
  settings["mode.apply"] = "auto";
});

test("иммунитет-ограничение: исход «не сорвано» записан — следующий кандидат с тем же slug окна не получает, даже при apply=button (эффект ещё не поставлен)", async () => {
  settings["mode.apply"] = "button";
  const imm = { ...IMMUNITY, scope: "slug" };
  const s = await scenario({ mod: 11, rank: 3, onCounter: [PERS], immunity: imm }, { rank: 5, id: "S1" });
  const o2 = mkAct("Actor.o2", { rule: cRule({}, { mod: 5, rank: 3, immunity: imm }) }); mkTk("o2", o2, 100, 0);
  assert.equal(cs.candidates(s.cast).length, 1, "до исхода кандидат есть");
  await saves.recordResult(s.host.id, "o", { degree: 1, total: 10, dc: 24 });
  assert.equal(msgs.get(s.host.id).flags[MOD].use.state.counter.done, true);
  assert.equal(s.caster.items.some((i) => i.flags?.[MOD]?.immunity), false, "эффект иммунитета ещё не поставлен (ждёт «Применить»)");
  assert.equal(cs.candidates(s.cast).length, 0, "иммунитет уже действует как ограничение");
  assert.deepEqual([...cs.settledImmunities(s.caster)], ["kara"]);
  assert.equal(cs.candidates(castMsg("S2", s.caster, s.tc)).length, 0, "другое сотворение того же заклинателя — тоже (п. 4)");
  const host = msgs.get(s.host.id);
  host.timestamp = Date.now();
  assert.deepEqual([...cs.settledImmunities(s.caster, Date.now() + 25 * 3_600_000)], [], "срок 24 ч истёк");
  assert.deepEqual([...cs.settledImmunities(mkAct("Actor.other"))], [], "другой заклинатель");
  host.flags[MOD].use.state.counter.reverted = true;
  assert.deepEqual([...cs.settledImmunities(s.caster)], [], "«Вернуть» отменило исход");
  host.flags[MOD].use.state.counter.reverted = false;
  host.flags[MOD].use.state.challenge.undone = { o: true };
  assert.deepEqual([...cs.settledImmunities(s.caster)], [], "ГМ откатил применение — иммунитет не действует");
  delete host.flags[MOD].use.state.challenge.undone;
  host.flags[MOD].use.state.challenge.applied = { o: { ops: [] } };
  assert.deepEqual([...cs.settledImmunities(s.caster)], [], "применённое — эффект уже на заклинателе, его видит hasImmunity");
  settings["mode.apply"] = "auto";
});

test("onResult: метка whileApplying стоит от записи done до cancel/next — страховка не выпускает ни во время итоговой строки, ни в next", async () => {
  let calls = 0;
  hold.replayers.add(async () => { calls++; });
  const m = mkCast("W3", COUNTER, { timestamp: Date.now() - hold.COUNTER_STUCK_MS - 1000 });
  const h = resolvedHost("W3", { degree: 0, targetRank: 3 });
  let during = null;
  await cs.onResult(h.id, { next: async () => { await hold.sweepCounter(); during = hold.isCounterHold(m); } });
  assert.deepEqual([during, calls], [true, 0], "во время next выпуска нет");
  await hold.sweepCounter();
  assert.deepEqual([hold.isHeld(m), calls], [false, 1], "после метки страховка работает");
});

test("limits=off: частоту не проверяем и не списываем; частота turn/round вне боя на нуле — отказ ДО траты реакции", async () => {
  const { owner, item } = freqOwner(0);
  settings["mode.limits"] = "off";
  assert.equal(cs.reserve(owner, item), true);
  assert.equal(await cs.chargeFrequency(item, []), true);
  assert.equal(item.system.frequency.value, 0, "не списано");
  delete settings["mode.limits"];
  item.system.frequency.per = "turn";   // вне боя exhausted() её не видит
  assert.equal(cs.reserve(owner, item), false, "на нуле — отказ в reserve, реакция ещё не потрачена");
});

test("переброс после «Вернуть», снова срывающий: reverted снимается; не срывающий — остаётся", async () => {
  users = Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } });
  mkCast("RV", { hold: false, replayed: false });
  const h = resolvedHost("RV", { degree: 0, targetRank: 3 });
  Object.assign(h.flags[MOD].use.state.counter, { done: true, degree: 0, reverted: true });
  h.flags[MOD].use.state.challenge.results.t1.degree = 3;   // переброс: теперь срыв
  await cs.onResult(h.id);
  assert.deepEqual([h.flags[MOD].use.state.counter.degree, h.flags[MOD].use.state.counter.reverted], [3, false]);
  const k = resolvedHost("RV", { degree: 3, targetRank: 3 });
  Object.assign(k.flags[MOD].use.state.counter, { done: true, degree: 3, reverted: true });
  k.flags[MOD].use.state.challenge.results.t1.degree = 0;   // был срыв, теперь нет
  await cs.onResult(k.id);
  assert.equal(k.flags[MOD].use.state.counter.reverted, true);
});

/* ---------- M4.9: трата ячейки (counter.expend) ---------- */

const slotsLib = await import("../scripts/slots.mjs");
const sp = (id, slug, o = {}) => ({ id, slug, name: o.name ?? slug, rank: o.rank ?? 3, isCantrip: !!o.cantrip, isFocusSpell: !!o.focus, traits: new Set(o.traits ?? []), system: { location: { signature: !!o.sig, heightenedLevel: o.base } } });
/** Запись колдовства pf2e: kind prepared | spontaneous | innate | focus | items; slots {ранг: {max, value | prepared:[{id, expended}]}}; fail — "false" | "throw": consume отказывает. */
function mkEntry(id, { kind = "spontaneous", flexible = false, tradition = "arcane", slots = {}, spells = [], fail = null } = {}) {
  const sl = {};
  for (const [r, s] of Object.entries(slots)) sl[`slot${r}`] = structuredClone(s);
  const e = {
    id, name: `Запись ${id}`, tradition, isPrepared: kind === "prepared", isSpontaneous: kind === "spontaneous", isFlexible: flexible, isInnate: kind === "innate", isFocusPool: kind === "focus", isRitual: false,
    spells, consumed: [], counteraction: { entry: id }, system: { slots: sl, prepared: { value: kind } }, fail,
    async consume(spell, rank, slot) {
      e.consumed.push([spell.id, rank, slot]);
      if (e.fail === "throw") throw new Error("Slot not given for prepared spell");
      if (e.fail === "false") return false;
      const s = e.system.slots[`slot${rank}`];
      if (e.isPrepared && !e.isFlexible) s.prepared[slot].expended = true; else s.value -= 1;
      e.onConsume?.();
      return true;
    },
    async update(d) { for (const [k, v] of Object.entries(d)) setDeep(e, k, v); }
  };
  e.spells.setSlotExpendedState = async (rank, i, st) => { e.system.slots[`slot${rank}`].prepared[i].expended = st; return true; };   // как SpellCollection pf2e; у записи метод не ждёт update
  return e;
}
const pr = (id, expended = false) => ({ id, expended });
const FB = () => sp("fb", "fireball", { traits: ["fire"] }), MS = () => sp("ms", "mind-spike", { base: 2, rank: 2, traits: ["mental"] });
const asOwner = (entries) => ({ itemTypes: { spellcastingEntry: entries } });
const ids = (list) => list.map((o) => o.id);

test("slotChoices: то же заклинание / любое / slug / черта, ранг same|min, from по isPrepared (гибкая — подготовленная), коллапс по (запись, ранг), традиция способности", () => {
  const P = mkEntry("P", { kind: "prepared", slots: { 1: { max: 1, prepared: [pr("fb")] }, 3: { max: 3, prepared: [pr("fb"), pr("fb"), pr("ms", true)] }, 5: { max: 1, prepared: [pr("fb")] } }, spells: [FB(), MS()] });
  const S = mkEntry("S", { tradition: "occult", slots: { 2: { max: 1, value: 1 }, 3: { max: 2, value: 1 }, 4: { max: 1, value: 1 } }, spells: [FB(), MS()] });
  const FL = mkEntry("FL", { kind: "prepared", flexible: true, tradition: "primal", slots: { 3: { max: 2, value: 2 } }, spells: [Object.assign(FB(), { system: { location: { signature: true } } })] });
  const owner = asOwner([P, S, FL]), cast = { item: { slug: "fireball", rank: 3 }, flags: { pf2e: { origin: { castRank: 3 } } } };
  const ch = (expend, o = cast, item = null) => ids(cs.slotChoices(owner, item, expend, o));
  assert.deepEqual(ch({ from: "prepared", spell: "same" }), ["P:fb:1:0", "P:fb:3:0", "P:fb:5:0", "FL:fb:3:"], "две копии в слотах 3-го ранга — один вариант, первый неистраченный слот; гибкая запись — по счётчику");
  assert.deepEqual(ch({ from: "slot", spell: "same" }), ["S:fb:3:"], "спонтанная: ячейка только того ранга, на котором заклинание в репертуаре (не сигнатурное)");
  assert.deepEqual(ch({ spell: "same" }), ["P:fb:1:0", "P:fb:3:0", "P:fb:5:0", "S:fb:3:", "FL:fb:3:"]);
  assert.deepEqual(ch({ spell: "same", rank: "min" }), ["P:fb:3:0", "P:fb:5:0", "S:fb:3:", "FL:fb:3:"]);
  assert.deepEqual(ch({ from: "prepared", spell: "any", rank: "same" }, { ...cast, flags: { pf2e: { origin: { castRank: 5 } } } }), ["P:fb:5:0"]);
  assert.deepEqual(ch({ spell: "any", rank: "min" }, { ...cast, flags: { pf2e: { origin: { castRank: 4 } } } }), ["P:fb:5:0", "S:fb:4:"], "любая ячейка не ниже 4-го ранга; у гибкой записи 4-го ранга нет");
  assert.deepEqual(ch({ from: "slot", spell: "any" }), ["S:fb:2:", "S:fb:3:", "S:fb:4:"], "«a spell slot»: любой ранг со слотами, привязки к репертуару нет");
  assert.deepEqual(ch({ spell: { trait: "mental" } }), ["S:ms:2:"], "черта mental: ячейка, на которой можно сотворить такое заклинание; потраченное подготовленное не считается");
  assert.deepEqual(ch({ spell: { slug: "dispel-magic" } }), []);
  assert.deepEqual(ch({ spell: "same" }, { item: { slug: "zzz" } }), [], "в репертуаре/подготовленных такого нет");
  assert.deepEqual(ch({ spell: "same" }, { flags: { pf2e: { origin: { rollOptions: ["origin:item:slug:fireball"], castRank: 3 } } } }), ["P:fb:1:0", "P:fb:3:0", "P:fb:5:0", "S:fb:3:", "FL:fb:3:"], "slug — и по опции origin:item:slug");
  assert.deepEqual(ch({ spell: "same" }, cast, { system: { traits: { value: ["occult", "sorcerer"] } } }), ["S:fb:3:"], "черта традиции у способности — только записи этой традиции");
  assert.deepEqual(ch({ spell: "same" }, cast, { system: { traits: { value: ["archetype"] } } }).length, 5);
});

test("slotChoices / entriesOf: заговоры, заклинания фокуса, врождённое, очки фокуса, ритуалы и предметы (посохи, свитки) ячейку не тратят — вариантов нет", () => {
  const cantrip = sp("c", "ray-of-frost", { cantrip: true, rank: 1 }), focus = sp("f", "ray-of-frost", { focus: true, rank: 1 });
  const slots = { 1: { max: 2, value: 2 } }, none = { item: { slug: "ray-of-frost" }, flags: { pf2e: { origin: { castRank: 1 } } } };
  const spont = mkEntry("S", { slots, spells: [cantrip, focus] }), prepared = mkEntry("P", { kind: "prepared", slots: { 1: { max: 1, prepared: [pr("c")] } }, spells: [cantrip, focus] });
  assert.deepEqual(cs.slotChoices(asOwner([spont, prepared]), null, { spell: "same" }, none), [], "заговор в спонтанной записи: consume вернул бы true без траты");
  assert.deepEqual(cs.slotChoices(asOwner([spont, prepared]), null, { spell: "any" }, none), [], "«любая ячейка» тоже не берёт заговоры");
  const other = { item: { slug: "fireball" }, flags: { pf2e: { origin: { castRank: 1 } } } };
  const entries = ["innate", "focus", "items"].map((kind) => mkEntry(kind, { kind, slots, spells: [FB()] }));
  entries.push({ ...mkEntry("rit", { slots, spells: [FB()] }), isRitual: true });
  assert.deepEqual(cs.slotChoices(asOwner(entries), null, { spell: "any" }, other), []);
  assert.deepEqual(slotsLib.entriesOf(asOwner([...entries, spont])).map((e) => [e.id, e.spells.length]), [["S", 2]], "общий отбор: только prepared/spontaneous; заговоры и фокус в данных (условия), blockOptions их отсеивает");
  assert.equal(slotsLib.uniqueOptions([{ entry: "E", rank: 1, spell: "a" }, { entry: "E", rank: 1, spell: "b" }, { entry: "E", rank: 2, spell: "a" }], (o) => `${o.entry}:${o.rank}`).length, 2, "ключ задаёт вызывающий");
});

test("counterOptions: spell-cast:prepared (подготовлено у владельца) и spell-cast:known (в записи колдовства) — условие триггера, считается только если названо в when", () => {
  const P = mkEntry("P", { kind: "prepared", slots: { 3: { max: 2, prepared: [pr("fb", true), pr("xx")] } }, spells: [FB(), sp("xx", "other")] });
  const S = mkEntry("S", { slots: { 2: { max: 1, value: 1 } }, spells: [MS()] });
  const owner = Object.assign(mkAct("Actor.o", { alliance: "party" }), asOwner([P, S])), foe = mkAct("Actor.f");
  const msg = (slug) => ({ item: { slug }, flags: { pf2e: { origin: { rollOptions: [] } } } });
  const opts = (slug, when = [["spell-cast:prepared", "spell-cast:known"]]) => cs.counterOptions({ message: msg(slug), owner, ownerToken: null, caster: foe, targets: [], when });
  assert.deepEqual(["spell-cast:prepared", "spell-cast:known"].map((o) => opts("fireball").has(o)), [true, true], "подготовлено (даже потраченная копия — это условие триггера, не плата)");
  assert.deepEqual(["spell-cast:prepared", "spell-cast:known"].map((o) => opts("mind-spike").has(o)), [false, true], "репертуар спонтанной — «знает», но не «подготовил»");
  assert.deepEqual(["spell-cast:prepared", "spell-cast:known"].map((o) => opts("nothing").has(o)), [false, false]);
  assert.equal(opts("fireball", null).has("spell-cast:known"), false, "не названо в when — не считаем");
});

/** Владелец с записями колдовства и записью counter; токен w на (200, 0): заклинатель c на (0, 0). */
function slotOwner(entries, counter, { extra = {}, item = {} } = {}) {
  const owner = mkTarget(mkAct("Actor.w", { level: 8, alliance: "party", rule: cRule({ range: "any", when: ["origin:enemy"], ...extra }, counter) }));
  owner.itemTypes.spellcastingEntry = entries;
  owner.spellcasting = { get: (id) => entries.find((e) => e.id === id) };
  owner.items.get = (id) => entries.flatMap((e) => e.spells).find((s) => s.id === id);
  Object.assign(owner.items[0], item);
  return owner;
}
const slotCast = (id, caster, tc, rank = 3, slug = "fireball") => { const m = castMsg(id, caster, tc, { rank }); m.item.slug = slug; m.item.rank = rank; m.flags[MOD].gate = { hold: "counter" }; return m; };

test("candidates: нет подходящей ячейки — кандидат отсечён молча; есть — идёт; when spell-cast:prepared вычисляется из записи", () => {
  const caster = mkAct("Actor.c", { alliance: "opposition" }), tc = mkTk("c", caster, 0, 0);
  const S = mkEntry("S", { slots: { 3: { max: 1, value: 0 } }, spells: [FB()] });
  const owner = slotOwner([S], { expend: { from: "slot", spell: "same" } });
  mkTk("w", owner, 200, 0);
  assert.equal(cs.candidates(slotCast("D1", caster, tc)).length, 0, "ячейки кончились");
  S.system.slots.slot3.value = 1;
  assert.equal(cs.candidates(slotCast("D2", caster, tc)).length, 1);
  assert.equal(cs.candidates(slotCast("D3", caster, tc, 3, "other")).length, 0, "не то заклинание");
  const P = mkEntry("P", { kind: "prepared", slots: { 3: { max: 1, prepared: [pr("fb")] } }, spells: [FB()] });
  const o2 = slotOwner([P], { expend: { from: "prepared", spell: "any" } }, { extra: { when: ["origin:enemy", "spell-cast:prepared"] } });
  mkTk("w2", o2, 300, 0);
  assert.equal(cs.candidates(slotCast("D4", caster, tc)).map((c) => c.token.id).join(), "w,w2", "подготовлено — условие выполнено");
  assert.equal(cs.candidates(slotCast("D5", caster, tc, 3, "other")).length, 0, "не подготовлено — условия триггера нет, хотя ячейка («любое») есть");
});

test("run с expend: одна ячейка — строка «будет потрачено» и одна кнопка; несколько — кнопка на вариант; ячейка тратится через consume (запись, ранг, слот); контр-ранг — ранг ячейки; check.entry — запись", async () => {
  users = Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } });
  const caster = mkAct("Actor.c"), tc = mkTk("c", caster, 300, 0);
  const A = mkEntry("A", { kind: "prepared", slots: { 3: { max: 1, prepared: [pr("fb")] }, 5: { max: 1, prepared: [pr("fb")] } }, spells: [FB()] });
  const B = mkEntry("B", { tradition: "occult", slots: { 3: { max: 1, value: 1 } }, spells: [FB()] });
  const owner = slotOwner([A], { expend: { spell: "same", rank: "same" } }), item = { name: "Контрзаклинание", system: { description: { value: "" } } };
  const tOwner = mkTk("w", owner, 0, 0), found = ev.eventItems(owner)[0], entry = found.rule.onEvent[0];
  const go = (cast, ask, { ent = entry, own = owner, spend = async (pay) => !!(await pay()) } = {}) => cs.run({ ev: { message: cast, other: caster, ownerToken: tOwner, otherToken: tc }, owner: own, item, entry: ent, key: `${cast.id}:k:0`, spend, build: build(own, item), ask });
  let asked;
  const id1 = await go(slotCast("X1", caster, tc, 5), async (_u, _t, prompt, choices) => { asked = { prompt, choices }; return "yes"; });
  assert.match(asked.prompt, /counter\.expends/);
  assert.deepEqual(asked.choices.map((c) => c.value), ["yes"], "один вариант — одна кнопка");
  assert.deepEqual(A.consumed, [["fb", 5, 0]], "потрачено подготовленное 5-го ранга: запись, ранг, слот");
  const use1 = msgs.get(id1).flags[MOD].use;
  assert.equal(use1.state.counter.counterRank, 5, "контр-ранг — ранг потраченной ячейки");
  assert.equal(use1.rule.onUse.check.entry, "A", "проверка — counteraction записи, из которой потрачено");
  assert.equal(use1.rule.onUse.check.mod, undefined);
  // два варианта по (запись, ранг): кнопка на вариант
  A.consumed.length = 0; A.system.slots.slot5.prepared[0].expended = false;
  const asked2 = [];
  const two = await go(slotCast("X2", caster, tc, 3), async (_u, _t, prompt, choices) => { asked2.push({ prompt, choices }); return "A:fb:5:0"; }, { ent: { counter: { expend: { spell: "same", rank: "min" } } } });
  assert.deepEqual(asked2[0].choices.map((c) => c.value), ["A:fb:3:0", "A:fb:5:0"]);
  assert.match(asked2[0].prompt, /counter\.choose/);
  assert.deepEqual(A.consumed, [["fb", 5, 0]], "потрачен выбранный вариант");
  assert.equal(msgs.get(two).flags[MOD].use.state.counter.counterRank, 5);
  // закрытое окно / чужое значение — траты нет
  A.consumed.length = 0; A.system.slots.slot5.prepared[0].expended = false;
  const neg = (v, id) => go(slotCast(id, caster, tc, 3), async () => v, { ent: { counter: { expend: { spell: "same", rank: "min" } } } });
  assert.equal(await neg(null, "X3"), null);
  assert.equal(await neg("A:zzz:9:9", "X4"), null);
  assert.deepEqual(A.consumed, []);
  // явный counter.rank перекрывает ранг ячейки; mod и statistic — без check.entry
  const o3 = slotOwner([A], { expend: { spell: "same" } }); A.system.slots.slot5.prepared[0].expended = true;
  const c3 = async (counter, id) => msgs.get(await go(slotCast(id, caster, tc, 3), async () => "yes", { ent: { counter }, own: o3 })).flags[MOD].use;
  const u3 = await c3({ expend: { spell: "same" }, rank: 7 }, "X5");
  assert.equal(u3.state.counter.counterRank, 7);
  A.system.slots.slot3.prepared[0].expended = false;
  assert.equal((await c3({ expend: { spell: "same" }, mod: 11 }, "X6")).rule.onUse.check.entry, undefined);
  A.system.slots.slot3.prepared[0].expended = false;
  const st = (await c3({ expend: { spell: "same" }, statistic: "religion" }, "X7")).rule.onUse.check;
  assert.deepEqual([st.entry, st.statistic], [undefined, "religion"]);
  // спонтанная запись: счётчик, слот не указывается
  const oB = slotOwner([B], { expend: { spell: "same" } });
  await go(slotCast("X8", caster, tc, 3), async () => "yes", { own: oB });
  assert.deepEqual(B.consumed, [["fb", 3, undefined]]);
});

test("run с expend: 0 вариантов к моменту окна (ячейку потратили, пока кандидат ждал очередь) — тихий null без окна; consume отказал или бросил — шёпот noSlot и отказ до траты реакции", async () => {
  users = Object.assign([{ id: "gm", isGM: true }], { activeGM: { id: "gm" } });
  const caster = mkAct("Actor.c"), tc = mkTk("c", caster, 300, 0);
  const S = mkEntry("S", { slots: { 3: { max: 1, value: 1 } }, spells: [FB()] });
  const owner = slotOwner([S], { expend: { spell: "same" } }), item = { name: "Контрзаклинание", system: { description: { value: "" } } };
  const tOwner = mkTk("w", owner, 0, 0), entry = ev.eventItems(owner)[0].rule.onEvent[0];
  let asked = 0, reactions = 0;
  const go = (id) => cs.run({ ev: { message: slotCast(id, caster, tc), other: caster, ownerToken: tOwner, otherToken: tc }, owner, item, entry, key: `${id}:k:0`, spend: async (pay) => { const op = await pay(); if (op) reactions++; return !!op; }, build: build(owner, item), ask: async () => { asked++; return "yes"; } });
  S.system.slots.slot3.value = 0;
  assert.equal(await go("Z1"), null);
  assert.deepEqual([asked, created.length, reactions], [0, 0, 0], "окна и шёпота нет");
  S.system.slots.slot3.value = 1; S.fail = "false";
  assert.equal(await go("Z2"), null);
  assert.deepEqual([asked, reactions], [1, 0], "реакция не потрачена");
  assert.match(created.at(-1).content, /counter\.noSlot/);
  const n = created.length; S.fail = "throw";
  assert.equal(await go("Z3"), null, "ErrorPF2e из consume не вылетает наружу");
  assert.equal(created.length, n + 1);
  S.fail = null;
  assert.ok(await go("Z4"), "после сбоя ячейка цела — следующая попытка проходит");
  assert.equal(S.system.slots.slot3.value, 0);
});

/** Владелец-копия для runEntry (окно через сокет, частота у предмета); возвращает всё нужное. */
function runSetup(entries, counter, { freq = null } = {}) {
  dmgRolls();
  users = Object.assign([{ id: "p", isGM: false, active: true }], { activeGM: { id: "gm" } });
  const owner = slotOwner(entries, counter);
  owner.testUserPermission = () => true;
  const item = owner.items[0];
  item.system = { description: { value: "" }, ...(freq && { frequency: { value: 1, max: 1, per: "day" } }) };
  if (freq) item.update = async (d) => { await freq(d, item); };
  const found = ev.eventItems(owner)[0], tOwner = mkTk("w", owner, 200, 0);
  const mkEv = (id) => { const caster = mkAct(`Actor.c${id}`, { alliance: "opposition" }), tc = mkTk(`c${id}`, caster, 0, 0), m = slotCast(id, caster, tc); return { id, message: m, other: caster, otherToken: tc, ownerToken: tOwner, options: new Set() }; };
  return { owner, item, found, entry: found.rule.onEvent[0], mkEv };
}

test("runEntry с expend: трата записывается в журнал slotExpended (prev), карточка проверки создана; отказ, потеря удержания после траты и сбой после траты возвращают ячейку", async () => {
  const S = mkEntry("S", { slots: { 3: { max: 2, value: 2 } }, spells: [FB()] });
  const { owner, item, found, entry, mkEv } = runSetup([S], { expend: { spell: "same" } });
  setSocket({ executeAsUser: async () => "yes" });
  const log = [], e1 = mkEv("R1");
  await ev.runEntry(e1, owner, found, { i: 0, entry }, log);
  assert.equal(S.system.slots.slot3.value, 1);
  assert.deepEqual(log[0].recs[0].ops, [{ op: "slotExpended", actor: "Actor.w", entry: "S", rank: 3, slot: null, spell: "fb", prev: 2 }]);
  assert.ok(log[0].host, "карточка проверки создана");
  assert.equal(msgs.get(log[0].host).flags[MOD].use.rule.onUse.check.entry, "S");
  // удержание ушло, пока шла трата: ячейка возвращается, записей в журнале нет, карточки нет
  const e2 = mkEv("R2"), log2 = [];
  S.onConsume = () => { e2.message.flags[MOD].gate = { hold: false }; };
  assert.equal(await ev.runEntry(e2, owner, found, { i: 0, entry }, log2), null);
  S.onConsume = null;
  assert.equal(S.system.slots.slot3.value, 1, "ячейка вернулась");
  assert.deepEqual(log2.flatMap((r) => r.recs), []);
  // сбой списания частоты после траты ячейки: ячейка не пропадает
  const S2 = mkEntry("S2", { slots: { 3: { max: 1, value: 1 } }, spells: [FB()] });
  const f = runSetup([S2], { expend: { spell: "same" } }, { freq: async () => { throw new Error("update failed"); } });
  await assert.rejects(ev.runEntry(f.mkEv("R3"), f.owner, f.found, { i: 0, entry: f.entry }, []), /update failed/);
  assert.equal(S2.system.slots.slot3.value, 1, "ячейка возвращена откатом");
  setSocket(null);
});

test("undoSpent: ячейка возвращается, только если состояние всё ещё наше (подготовленное — expended, счётчик — prev−1); реакция — как раньше", async () => {
  const P = mkEntry("P", { kind: "prepared", slots: { 3: { max: 1, prepared: [pr("fb", true)] } }, spells: [FB()] });
  const S = mkEntry("S", { slots: { 3: { max: 2, value: 1 } }, spells: [FB()] });
  const owner = slotOwner([P, S], { expend: { spell: "same" } });
  const op = (entry, slot, prev) => ({ op: "slotExpended", actor: "Actor.w", entry, rank: 3, slot, spell: "fb", prev });
  assert.equal(await apply.undoSpent(op("P", 0, null)), true);
  assert.equal(P.system.slots.slot3.prepared[0].expended, false);
  assert.equal(await apply.undoSpent(op("P", 0, null)), false, "уже не потрачено");
  assert.equal(await apply.undoSpent(op("S", null, 2)), true);
  assert.equal(S.system.slots.slot3.value, 2);
  S.system.slots.slot3.value = 0;   // после нас потратили ещё
  assert.equal(await apply.undoSpent(op("S", null, 2)), false);
  assert.equal(S.system.slots.slot3.value, 0);
  assert.equal(await apply.undoSpent({ op: "slotExpended", actor: "Actor.none", entry: "S", rank: 3, slot: null, prev: 2 }), false);
  const set = [];
  owner.getFlag = () => ({ combat: "C1", round: 2 }); owner.unsetFlag = async () => { set.push("unset"); };
  assert.equal(await apply.undoSpent({ op: "reactionSpent", actor: "Actor.w", prev: null, set: { combat: "C1", round: 2 } }), true);
  assert.equal(await apply.undoSpent({ op: "reactionSpent", actor: "Actor.w", prev: null, set: { combat: "C1", round: 3 } }), false, "флаг уже не наш");
  assert.deepEqual(set, ["unset"]);
});

test("очередь: окно не держит ownerQueue (решение damaged стоит в ней), трата реакции и ячейки — ждёт ownerQueue", async () => {
  const { ownerQueue } = await import("../scripts/builtin/lib.mjs");
  const S = mkEntry("S", { slots: { 3: { max: 1, value: 1 } }, spells: [FB()] });
  const { owner, found, entry, mkEv } = runSetup([S], { expend: { spell: "same" } });
  let asked = 0, release;
  setSocket({ executeAsUser: async () => { asked++; return "yes"; } });
  const busy = ownerQueue(owner.uuid, () => new Promise((r) => { release = r; }));
  const run = ev.runEntry(mkEv("QQ1"), owner, found, { i: 0, entry }, []);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(asked, 1, "окно открылось, пока ownerQueue занята (иначе взаимоблокировка с damaged)");
  assert.equal(S.system.slots.slot3.value, 1, "а трата ждёт очередь реакций владельца");
  release(); await busy; await run;
  assert.equal(S.system.slots.slot3.value, 0);
  setSocket(null);
});

test("удержание выпущено во время записи реакции/частоты: трата откатывается, карточки нет", async () => {
  const S = mkEntry("S", { slots: { 3: { max: 1, value: 1 } }, spells: [FB()] });
  let e1;
  const { owner, item, found, entry, mkEv } = runSetup([S], { expend: { spell: "same" } }, { freq: async (d, it) => { it.system.frequency.value = d["system.frequency.value"]; e1.message.flags[MOD].gate = { hold: false }; } });
  setSocket({ executeAsUser: async () => "yes" });
  e1 = mkEv("RL1");
  const log = [];
  assert.equal(await ev.runEntry(e1, owner, found, { i: 0, entry }, log), null);
  assert.equal(S.system.slots.slot3.value, 1, "ячейка вернулась");
  assert.equal(item.system.frequency.value, 1, "частота вернулась");
  assert.deepEqual(log.flatMap((r) => r.recs), []);
  setSocket(null);
});

test("гибкая запись: сотворяется только дневная коллекция (signature); заговор не тратит, но считается условием prepared/known", () => {
  const sig = sp("s", "fireball", { sig: true, traits: ["fire"] }), book = sp("b", "fireball2", { traits: [] });
  const FL = mkEntry("FL", { kind: "prepared", flexible: true, slots: { 3: { max: 2, value: 2 } }, spells: [sig, book] });
  const owner = asOwner([FL]), cast = (slug) => ({ item: { slug, rank: 3 }, flags: { pf2e: { origin: { castRank: 3 } } } });
  assert.deepEqual(ids(cs.slotChoices(owner, null, { spell: "any" }, cast("x"))), ["FL:s:3:"], "из книги — не вариант траты");
  const mk = (e) => Object.assign(mkAct("Actor.o", { alliance: "party" }), asOwner([e]));
  const opts = (o, slug) => cs.counterOptions({ message: { item: { slug }, flags: { pf2e: { origin: { rollOptions: [] } } } }, owner: o, ownerToken: null, caster: mkAct("Actor.f"), targets: [], when: [["spell-cast:prepared", "spell-cast:known"]] });
  assert.deepEqual(["spell-cast:prepared", "spell-cast:known"].map((o) => opts(mk(FL), "fireball").has(o)), [true, true]);
  assert.deepEqual(["spell-cast:prepared", "spell-cast:known"].map((o) => opts(mk(FL), "fireball2").has(o)), [false, true], "только из книги: известно, но не подготовлено");
  const ct = sp("c", "ray-of-frost", { cantrip: true, rank: 1 });
  const P = mkEntry("P", { kind: "prepared", slots: { 1: { max: 1, prepared: [pr("zz")] } }, spells: [ct, sp("zz", "zz")] });
  assert.deepEqual(["spell-cast:prepared", "spell-cast:known"].map((o) => opts(mk(P), "ray-of-frost").has(o)), [true, true], "заговор — условие триггера выполнено");
});

test("undoSpent подготовленного слота ждёт запись (spells.setSlotExpendedState), а не запись-обёртку без await", async () => {
  const P = mkEntry("P", { kind: "prepared", slots: { 3: { max: 1, prepared: [pr("fb", true)] } }, spells: [FB()] });
  let wrote = false;
  P.setSlotExpendedState = () => { throw new Error("обёртка записи не ждёт update"); };
  P.spells.setSlotExpendedState = async (rank, i, st) => { await new Promise((r) => setTimeout(r, 10)); P.system.slots[`slot${rank}`].prepared[i].expended = st; wrote = true; };
  slotOwner([P], { expend: { spell: "same" } });
  assert.equal(await apply.undoSpent({ op: "slotExpended", actor: "Actor.w", entry: "P", rank: 3, slot: 0, spell: "fb", prev: null }), true);
  assert.equal(wrote, true);
});

test("валидатор expend: формы, ровно одно из mod/statistic — только без expend, ранг обязателен только без expend", () => {
  const ok = (counter) => validate(entry(counter));
  for (const c of [{ expend: { spell: "same" } }, { expend: { from: "prepared", spell: "any", rank: "min" } }, { expend: { from: "slot", spell: { slug: "dispel-magic" } } }, { expend: { spell: { trait: "mental" } }, mod: 5 },
    { expend: { spell: "any", rank: "same" }, statistic: "religion", rank: 3 }]) {
    const v = ok(c);
    assert.equal(v.ok, true, JSON.stringify(c) + JSON.stringify(v.errors));
    assert.deepEqual(v.rule.onEvent[0].counter, c, "ничего не теряется");
  }
  for (const bad of [{ expend: {} }, { expend: "same" }, { expend: { spell: "some" } }, { expend: { spell: { slug: "a", trait: "b" } } }, { expend: { spell: {} } }, { expend: { spell: { slug: "A B" } } }, { expend: { spell: "same", from: "innate" } },
    { expend: { spell: "same", rank: "max" } }, { expend: { spell: "same", x: 1 } }, { expend: { spell: "same" }, mod: 5, statistic: "arcana" }, { expend: { spell: "same" }, rank: 0 }, { expend: { spell: "same" }, mod: 1.5 }]) assert.equal(ok(bad).ok, false, JSON.stringify(bad));
  assert.equal(ok({ mod: 5 }).ok, false, "без expend ранг обязателен");
  assert.equal(ok({ rank: 2 }).ok, false, "без expend нужно mod или statistic");
  assert.equal(ok({ mod: 5, statistic: "arcana", rank: 2 }).ok, false);
  const r = ruleToForm(validate(entry({ expend: { from: "prepared", spell: "same" } })).rule);
  assert.deepEqual(validate(formToRule(r)).rule.onEvent[0].counter, { expend: { from: "prepared", spell: "same" } }, "лист не теряет expend");
});
