// Запрет hold в рантайме недугов (plan-affliction-linger-hold.md §3, H-C): запись held при смене стадии, лечение, откат, stageLock. Без Foundry.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const settings = {};
let msgs, uuids, created, now, hooks = {};
const warned = [];
const setDeep = (o, path, v) => { const ks = path.split("."), last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };
const isPlain = (x) => x && typeof x === "object" && !Array.isArray(x);
const merge = (t, s) => { for (const [k, v] of Object.entries(s)) t[k] = isPlain(v) && isPlain(t[k]) ? merge(t[k], v) : structuredClone(v); return t; };
const call = (n, ...a) => (hooks[n] ?? []).every((f) => f(...a) !== false);
const condBase = (slug) => ({ uuid: null, _stats: { compendiumSource: `Compendium.pf2e.conditionitems.Item.${slug}` }, name: slug, img: "i.svg", system: { value: { isValued: true } }, toObject() { return { name: slug, type: "condition", system: { slug, value: { isValued: true, value: null } } }; } });
globalThis.game = {
  user: { isActiveGM: true, id: "gm" },
  settings: { get: (_m, k) => settings[k] },
  i18n: { localize: (k) => k, format: (k) => k },
  modules: { get: () => null },
  time: { get worldTime() { return now; } },
  combats: [], actors: [], scenes: { contents: [] },
  messages: { get: (id) => msgs.get(id), get contents() { return [...msgs.values()]; } },
  pf2e: { ConditionManager: { conditions: new Map(), getCondition: condBase,
    async updateConditionValue(id, actor, v) { const d = actor.items.find((i) => i.id === id); if (d && call("preUpdateItem", d, { "system.value.value": v })) d.system.value.value = v; } } }
};
globalThis.ui = { notifications: { warn(k) { warned.push(k); }, info() {} } };
globalThis.fromUuid = async (u) => uuids.get(u) ?? null;
globalThis.fromUuidSync = (u) => uuids.get(u) ?? null;
globalThis.foundry = { data: { regionBehaviors: { RegionBehaviorType: class {} }, fields: new Proxy({}, { get: () => class {} }) }, utils: { deepClone: (o) => structuredClone(o), setProperty: setDeep, getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), hasProperty: (o, p) => p.split(".").every(function (k) { return o != null && k in Object(o) && ((o = o[k]), true); }), escapeHTML: (s) => s } };
globalThis.CONFIG = { PF2E: { damageTypes: { poison: 1, void: 1, bleed: 1 } }, Canvas: { polygonBackends: { move: { testCollision: () => false } } }, Dice: { rolls: [class DamageRoll { constructor(f) { this.f = f; } async evaluate() { this.total = 5; return this; } alter() { return this; } }] } };
globalThis.ChatMessage = { create: async (d) => { const m = { id: `H${created.length + 1}`, ...d, async delete() { msgs.delete(this.id); } }; created.push(m); msgs.set(m.id, m); return m; }, getSpeaker: ({ actor }) => ({ actor: actor.id }), getWhisperRecipients: () => [] };

const { MOD } = await import("../scripts/util.mjs");
const rules = await import("../scripts/rules.mjs");
const A = await import("../scripts/affliction.mjs");
const run = await import("../scripts/affliction-run.mjs");
const hold = await import("../scripts/condition-hold.mjs");
const { applyOps, removeByKey } = await import("../scripts/apply.mjs");
const validate = rules.validateRule;

globalThis.Hooks = { on: (n, f) => { (hooks[n] ??= []).push(f); }, once() {} };
hold.init(); run.init();
const installed = hooks;

beforeEach(() => {
  Object.assign(settings, { "mode.challenge": "auto", "mode.effect": "auto", "mode.apply": "auto", "mode.macro": "auto", "mode.limits": "auto", useToolbeltTargetHelper: false, yieldToAutomations: false, resumeMinutes: 30 });
  msgs = new Map(); uuids = new Map(); created = []; warned.length = 0; now = 1000;
  hooks = installed; game.combats = []; run.resetTracked();
});

const stg = (conditions, o = {}) => ({ duration: { value: 1, unit: "rounds" }, damage: [], conditions, ...o });
const DEF = (o = {}) => ({ name: "Filth Fever", kind: "disease", save: { statistic: "fortitude", dc: 22 }, maxDuration: null, holds: [{ slug: "sickened" }],
  stages: [stg([{ slug: "sickened", value: 2 }]), stg([{ slug: "sickened", value: 1 }]), stg([])], ...o });
const chRule = (def, stage = 1) => ({ v: 1, onUse: { targets: "selected", challenge: { statistic: "fortitude", dc: { value: 22 }, byDegree: { failure: [{ to: "target", affliction: { stage, def } }] } } } });
const startStep = (def, stage = 1) => { const r = validate(chRule(def, stage)); assert.deepEqual(r.errors, []); return { to: "target", affliction: { stage, def: r.rule.onUse.challenge.byDegree.failure[0].affliction.def } }; };

function mkActor(uuid, name = uuid) {
  let n = 0;
  const items = Object.assign([], { has(id) { return items.some((i) => i.id === id); } });
  const actor = {
    uuid, name, id: uuid.split(".").pop(), level: 5, attributes: { immunities: [] }, items, isDead: false,
    get itemTypes() { return { condition: items.filter((i) => i.type === "condition"), effect: items.filter((i) => i.type === "effect") }; },
    tokens: [], getActiveTokens() { return this.tokens; }, async applyDamage() {},
    async createEmbeddedDocuments(_, datas) {
      return datas.map((d) => {
        const it = { ...structuredClone(d), id: `i${++n}`, uuid: `${uuid}.Item.i${n}`, actor, parent: actor, isLocked: false, slug: d.system?.slug ?? d.name };
        it.toObject = () => ({ ...structuredClone({ name: it.name, type: it.type, system: it.system, flags: it.flags }), _id: it.id });
        it.delete = async () => { if (!call("preDeleteItem", it)) return; items.splice(items.indexOf(it), 1); call("deleteItem", it); };
        it.update = async (up) => {
          for (const [p, v] of Object.entries(up)) {
            const i = p.indexOf(".==");
            if (i >= 0) setDeep(it, `${p.slice(0, i)}.${p.slice(i + 3)}`, structuredClone(v?.value ?? v));   // ForcedReplacement-заглушка util.forcedReplace
            else { const cur = foundry.utils.getProperty(it, p); setDeep(it, p, isPlain(v) && isPlain(cur) ? merge(cur, v) : structuredClone(v)); }
          }
        };
        uuids.set(it.uuid, it); items.push(it);
        return it;
      });
    },
    async deleteEmbeddedDocuments(_, ids) { for (const id of ids) await items.find((i) => i.id === id)?.delete(); }
  };
  uuids.set(uuid, actor);
  return actor;
}
const mkToken = (id, actor) => { const t = { id, uuid: `Scene.s.Token.${id}`, name: id, actor, disposition: -1 }; actor.tokens = [t]; uuids.set(t.uuid, t); return t; };
let mid = 0;
const mkMsg = (rule) => { const m = { id: `M${++mid}`, flags: { [MOD]: { use: { actor: "Actor.author", token: null, item: { uuid: "Item.x", name: "x" }, rule, dc: null, targets: [{ key: "t1", uuid: "Scene.s.Token.t1" }], state: {} } } }, async update() {} }; msgs.set(m.id, m); return m; };
const setup = () => { const v = mkActor("Actor.victim", "Гоблин"); mkToken("t1", v); return v; };
async function expose(v, def, degree = 1) {
  const step = startStep(def), m = mkMsg(validate(chRule(step.affliction.def)).rule);
  return applyOps(m, "t1", [step], { scope: "challenge", degree, originActor: mkActor("Actor.author") });
}
const shift = (v, slug, degree) => applyOps(mkMsg(validate(chRule(DEF())).rule), "t1", [{ to: "target", stageDelta: { slug } }], { scope: "challenge", degree });
const carrier = (v, slug) => v.items.find((i) => i.flags?.[MOD]?.meta?.key === `affl:${slug}`);
const heldOf = (c) => c.flags[MOD].meta.affliction.held;
const cond = (v, slug) => v.items.find((i) => i.type === "condition" && i.slug === slug);
const settle = () => new Promise((r) => setTimeout(r, 5));

test("стадия 1: held = {floor: значение стадии, id состояния}; подъём стадии значение не опускает, floor — по стадии", async () => {
  const v = setup();
  await expose(v, DEF());
  const c = carrier(v, "filth-fever"), s = cond(v, "sickened");
  assert.deepEqual(heldOf(c), { sickened: { floor: 2, id: s.id } });
  assert.equal(hold.floorOf(v, "sickened"), 2);
  await run.applyStage(c, 2, { damage: false, quiet: true });
  assert.equal(s.system.value.value, 2);   // стадия выросла, значение вниз не идёт (п.1)
  assert.deepEqual(heldOf(c), { sickened: { floor: 1, id: s.id } });
  assert.deepEqual(warned, []);   // свои операции — unchecked, без предупреждений
});

const GROW = () => DEF({ stages: [stg([{ slug: "sickened", value: 1 }]), stg([{ slug: "sickened", value: 3 }]), stg([{ slug: "sickened", value: 2 }])] });

test("спуск стадии опускает документ носителя на разницу значений стадий; понижение в журнале made, откат возвращает", async () => {
  const v = setup();
  await expose(v, GROW());
  const c = carrier(v, "filth-fever"), s = cond(v, "sickened");
  await run.applyStage(c, 2, { damage: false, quiet: true });
  assert.equal(s.system.value.value, 3);
  const { made } = await run.applyStage(c, 1, { damage: false, quiet: true });   // old 2 > n 1: 3 - (3-1) = 1
  assert.equal(s.system.value.value, 1);
  assert.deepEqual(heldOf(c), { sickened: { floor: 1, id: s.id } });
  assert.deepEqual(made.map((x) => x.prev), [3]);
  await run.afflictionUnmake(made);
  assert.equal(s.system.value.value, 3);
});

test("спуск стадии: не ниже floor другого носителя", async () => {
  const v = setup();
  await expose(v, GROW());
  await expose(v, DEF({ name: "Ghoul Fever", stages: [stg([{ slug: "sickened", value: 2 }]), stg([]), stg([])] }));
  const c = carrier(v, "filth-fever"), s = cond(v, "sickened");
  await run.applyStage(c, 2, { damage: false, quiet: true });
  await run.applyStage(c, 1, { damage: false, quiet: true });
  assert.equal(s.system.value.value, 2);   // 3 - 2 = 1, но Ghoul Fever держит 2
});

test("чужое большее значение (испуг 3 от Запугивания) спуском стадии не понижается: недуг создаёт и держит свой документ", async () => {
  const v = setup();
  const [foreign] = await v.createEmbeddedDocuments("Item", [{ name: "sickened", type: "condition", system: { slug: "sickened", value: { isValued: true, value: 3 } } }]);
  await expose(v, GROW());
  const c = carrier(v, "filth-fever"), own = heldOf(c).sickened.id;
  assert.notEqual(own, foreign.id);   // чужую копию в held не пишем
  await run.applyStage(c, 2, { damage: false, quiet: true });
  await run.applyStage(c, 1, { damage: false, quiet: true });
  assert.equal(foreign.system.value.value, 3);
  assert.equal(v.items.find((i) => i.id === own).system.value.value, 1);
  assert.equal(hold.floorOf(v, "sickened"), 1);
});

test("зона + недуг на равном значении: выход из зоны снимает копию зоны без блока, недуг держит свою; излечение снимает свою", async () => {
  const v = setup();
  await v.createEmbeddedDocuments("Item", [{ name: "sickened", type: "condition", flags: { [MOD]: { meta: { key: "zone:Region.r1" } } }, system: { slug: "sickened", value: { isValued: true, value: 1 } } }]);
  await expose(v, GROW());
  const c = carrier(v, "filth-fever"), own = v.items.find((i) => i.id === heldOf(c).sickened.id);
  assert.match(own.flags[MOD].meta.key, /^affl:filth-fever:/);
  await removeByKey(v, "zone:Region.r1");
  assert.deepEqual(warned, []);
  assert.equal(v.items.filter((i) => i.slug === "sickened").length, 1);
  assert.equal(cond(v, "sickened"), own);
  await shift(v, "filth-fever", 3);
  await settle();
  assert.equal(cond(v, "sickened"), undefined);
});

test("стадия без состояния снимает запрет и запись", async () => {
  const v = setup();
  await expose(v, DEF());
  const c = carrier(v, "filth-fever");
  await run.applyStage(c, 3, { damage: false, quiet: true });
  assert.deepEqual(heldOf(c), {});
  assert.equal(hold.floorOf(v, "sickened"), null);
});

test("from: 3 — на стадиях 1–2 запрета нет", async () => {
  const v = setup();
  const def = DEF({ holds: [{ slug: "sickened", from: 3 }], stages: [stg([{ slug: "sickened", value: 1 }]), stg([{ slug: "sickened", value: 1 }]), stg([{ slug: "sickened", value: 2 }])] });
  await expose(v, def);
  const c = carrier(v, "filth-fever");
  assert.deepEqual(heldOf(c) ?? {}, {});
  await run.applyStage(c, 2, { damage: false, quiet: true });
  assert.equal(hold.floorOf(v, "sickened"), null);
  await run.applyStage(c, 3, { damage: false, quiet: true });
  assert.equal(hold.floorOf(v, "sickened"), 2);
});

test("лечение: носитель и состояние снимаются без тоста (запрет не мешает)", async () => {
  const v = setup();
  await expose(v, DEF());
  assert.equal(hold.violation(v, cond(v, "sickened"), { delete: true })?.how, "remove");   // руками снять нельзя
  await shift(v, "filth-fever", 3);   // крит. успех: -2 с первой стадии -> недуг снят
  await settle();
  assert.equal(carrier(v, "filth-fever"), undefined);
  assert.equal(cond(v, "sickened"), undefined);
  assert.deepEqual(warned, []);
});

test("два недуга на одном slug: излечение одного оставляет документ другого", async () => {
  const v = setup();
  await expose(v, DEF());
  await expose(v, DEF({ name: "Ghoul Fever", stages: [stg([{ slug: "sickened", value: 1 }]), stg([]), stg([])] }));
  const b = carrier(v, "ghoul-fever"), s = v.items.find((i) => i.id === heldOf(b).sickened.id);
  assert.equal(v.items.filter((i) => i.slug === "sickened").length, 2);   // у каждого недуга свой документ (pf2e действует максимум)
  await shift(v, "filth-fever", 3);
  await settle();
  assert.equal(carrier(v, "filth-fever"), undefined);
  assert.equal(cond(v, "sickened"), s);
  await shift(v, "ghoul-fever", 3);
  await settle();
  assert.equal(cond(v, "sickened"), undefined);
});

test("откат: slug, появившийся на новой стадии, исчезает из held; floor снят", async () => {
  const v = setup();
  await expose(v, DEF({ stages: [stg([]), stg([{ slug: "sickened", value: 1 }]), stg([])] }));
  const c = carrier(v, "filth-fever");
  assert.equal(hold.floorOf(v, "sickened"), null);
  const prev = { stage: 1, aff: structuredClone(c.flags[MOD].meta.affliction) };
  c.system.badge.value = 2;
  const { made } = await run.applyStage(c, 2, { damage: false, quiet: true });
  assert.equal(hold.floorOf(v, "sickened"), 1);
  await run.afflictionUndo(c, prev, made);
  assert.deepEqual(heldOf(c), {});
  assert.equal(hold.floorOf(v, "sickened"), null);
  assert.equal(cond(v, "sickened"), undefined);
  assert.deepEqual(warned, []);
});

test("stageLock: startMeta.locked, advance не опускает ниже 1, успех оставляет носитель и выкладывает строку", async () => {
  const def = DEF({ stageLock: true });
  assert.equal(A.startMeta(def, 1, { dc: 20, now: 0 }).locked, true);
  assert.equal(A.startMeta(DEF(), 1, { dc: 20, now: 0 }).locked, false);
  assert.deepEqual(A.advance(2, -2, def, true), { stage: 1, cleared: false, repeated: false, locked: true });
  assert.equal(A.advance(1, -1, def).cleared, true);   // без блокировки — снят
  const v = setup();
  await expose(v, def, 1);
  await run.applyStage(carrier(v, "filth-fever"), 1, { damage: false, quiet: true });
  created.length = 0;
  await shift(v, "filth-fever", 3);
  const c = carrier(v, "filth-fever");
  assert.equal(c.system.badge.value, 1);
  assert.ok(created.some((m) => /stageLocked/.test(m.content)));
});

test("mode.limits=off: floorOf = null даже при живой записи held", async () => {
  const v = setup();
  await expose(v, DEF());
  assert.equal(hold.floorOf(v, "sickened"), 2);
  settings["mode.limits"] = "off";
  assert.equal(hold.floorOf(v, "sickened"), null);
});
