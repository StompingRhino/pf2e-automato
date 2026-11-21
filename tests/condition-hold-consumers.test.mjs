import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = { settings: { get: () => "auto" }, i18n: { localize: (k) => k, format: (k) => k }, keyboard: { isModifierActive: () => false }, modules: { get: () => null } };
const { frightenedPlan, retchPlan, retchPossible } = await import("../scripts/turn-conditions.mjs");
const { applyCondition, removeCondition, undoOps } = await import("../scripts/apply.mjs");
const { init } = await import("../scripts/condition-hold.mjs");

const MOD = "pf2e-automato";
const carrier = (held) => ({ id: "car", type: "effect", name: "Недуг", flags: { [MOD]: { meta: { affliction: { held } } } } });

test("frightenedPlan: не ниже floor; на floor — без изменений; без floor — как раньше", () => {
  const p = frightenedPlan([{ id: "a", value: 3, floor: 2 }, { id: "b", value: 2, floor: 2 }, { id: "c", value: 1 }]);
  assert.deepEqual(p, [{ id: "a", to: 2 }, { id: "c", to: 0 }]);
});

test("retchPlan: не ниже floor; retchPossible при keep (floor = значение) — нет, при present выше 1 — да", () => {
  assert.deepEqual(retchPlan([{ id: "a", value: 3, floor: 2 }], 3), [{ id: "a", to: 2 }]);
  assert.deepEqual(retchPlan([{ id: "a", value: 2, floor: 2 }], 3), []);
  assert.equal(retchPossible([{ value: 2, floor: 2 }]), false);
  assert.equal(retchPossible([{ value: 3, floor: 1 }]), true);   // present: можно до 1
  assert.equal(retchPossible([{ value: 1 }]), true);             // без удержания
});

function world(held, value, slug = "sickened") {
  const calls = [], items = [];
  const actor = { uuid: "Actor.t", items, get itemTypes() { return { condition: items.filter((i) => i.type === "condition") }; },
    async decreaseCondition(c) { calls.push(["remove", c.id]); items.splice(items.indexOf(c), 1); } };
  const cond = { id: "s1", type: "condition", slug, system: { value: { value } }, isLocked: false, parent: actor, actor };
  items.push(carrier(held(cond)), cond);
  globalThis.game.pf2e = { ConditionManager: { updateConditionValue: async (id, _a, to) => { calls.push(["set", id, to]); cond.system.value.value = to; } } };
  return { actor, cond, calls };
}

test("reduceCondition (policy reduce): до floor, не снимает; на floor — пропуск; без held — снимает", async () => {
  let w = world((c) => ({ sickened: { floor: 2, id: c.id } }), 4);
  let r = await applyCondition(w.actor, { slug: "sickened", value: 3, policy: "reduce" }, { key: "k" });
  assert.equal(r.op, "raised"); assert.deepEqual(w.calls, [["set", "s1", 2]]);
  r = await applyCondition(w.actor, { slug: "sickened", value: 1, policy: "reduce" }, { key: "k2" });
  assert.equal(r.op, "skipped");
  w = world(() => ({}), 1);
  r = await applyCondition(w.actor, { slug: "sickened", value: 1, policy: "reduce" }, { key: "k" });
  assert.equal(r.op, "removed");
});

test("removeCondition при floor: снижает до floor (откат вернёт prev), не снимает; на floor — skipped", async () => {
  let w = world((c) => ({ sickened: { floor: 1, id: c.id } }), 3);
  const r = await removeCondition(w.actor, "sickened");
  assert.deepEqual([r.op, r.prev], ["removed", 3]); assert.deepEqual(w.calls, [["set", "s1", 1]]);
  assert.equal((await removeCondition(w.actor, "sickened")).op, "skipped");
  w = world(() => ({}), 3);
  assert.equal((await removeCondition(w.actor, "sickened")).op, "removed"); assert.deepEqual(w.calls, [["remove", "s1"]]);
});

test("undoOps: откат снимает удерживаемое состояние несмотря на floor; обычное удаление — блокируется", async () => {
  const hooks = {}, warns = [];
  globalThis.Hooks = { on: (n, f) => { hooks[n] = f; } };
  globalThis.ui = { notifications: { warn: (t) => warns.push(t) } };
  globalThis.CONFIG = { PF2E: { conditionTypes: {} } };
  globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o) } };
  init();
  const w = world((c) => ({ sickened: { floor: 2, id: c.id } }), 2);
  w.cond.uuid = "Actor.t.Item.s1";
  w.cond.delete = async (opts) => { if (hooks.preDeleteItem(w.cond) === false) return; w.actor.items.splice(w.actor.items.indexOf(w.cond), 1); };
  globalThis.fromUuid = async (u) => (u === w.cond.uuid ? w.cond : null);
  await w.cond.delete();   // ручное снятие — запрещено
  assert.ok(w.actor.items.includes(w.cond)); assert.equal(warns.length, 1);
  const msg = { flags: { [MOD]: { use: { state: { apply: { T: { ops: [{ op: "created", item: w.cond.uuid }] } } } } } }, update: async () => {} };
  await undoOps(msg, "T");
  assert.ok(!w.actor.items.includes(w.cond)); assert.equal(warns.length, 1);   // откат снял без предупреждения
  delete globalThis.fromUuid;
});
