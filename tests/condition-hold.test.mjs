import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.game ??= {};
const { readHeld, floorOf, violation, newValue, unchecked, toastDue, init } = await import("../scripts/condition-hold.mjs");

const cond = (id, slug, value = 1) => ({ id, type: "condition", slug, system: { value: { value } } });
const carrier = (id, held) => ({ id, type: "effect", name: "Носитель", flags: { "pf2e-automato": { meta: { affliction: { held } } } } });
const actorOf = (...items) => ({ items, uuid: "Actor.a" });

test("floorOf: берёт floor живой записи; осиротевший id не держит", () => {
  const a = actorOf(carrier("c", { sickened: { floor: 2, id: "s1" }, drained: { floor: 1, id: "gone" } }), cond("s1", "sickened", 2));
  assert.equal(floorOf(a, "sickened"), 2);
  assert.equal(floorOf(a, "drained"), null);
  const r = readHeld(a);
  assert.deepEqual(r.orphans.map((o) => o.slugs), [["drained"]]);
});

test("снятие и снижение ниже floor — нарушение; повышение и равное — нет", () => {
  const s = cond("s1", "sickened", 2), a = actorOf(carrier("c", { sickened: { floor: 2, id: "s1" } }), s);
  assert.equal(violation(a, s, { delete: true }).how, "remove");
  assert.equal(violation(a, s, { value: 1 }).how, "reduce");
  assert.equal(violation(a, s, { value: 2 }), null);
  assert.equal(violation(a, s, { value: 3 }), null);
});

test("обёрнутое состояние (не UNLINKED): удаление тоже наше (каскад обёртки обходит restrict pf2e), снижение — наше", () => {
  const c = cond("k1", "clumsy", 2), a = actorOf(carrier("c", { clumsy: { floor: 2, id: "k1" } }), c);
  assert.equal(violation(a, c, { delete: true }).how, "remove");
  assert.equal(violation(a, c, { value: 1 }).how, "reduce");
});

test("копия из другого источника запрет не снимает и сама не держится; floorOf по id — только удержанная", () => {
  const s = cond("s1", "sickened", 2), z = cond("s2", "sickened", 2), a = actorOf(carrier("c", { sickened: { floor: 2, id: "s1" } }), s, z);
  assert.equal(violation(a, s, { delete: true }).how, "remove");   // зона кончится раньше недуга
  assert.equal(violation(a, z, { delete: true }), null);
  assert.equal(floorOf(a, "sickened", "s1"), 2);
  assert.equal(floorOf(a, "sickened", "s2"), null);
  assert.equal(floorOf(a, "sickened"), 2);
});

test("состояние без записи held и не-состояние — не держатся", () => {
  const s = cond("s9", "sickened", 2), a = actorOf(carrier("c", { sickened: { floor: 2, id: "s1" } }), s);
  assert.equal(violation(a, s, { delete: true }), null);   // id другой
  assert.equal(violation(a, { id: "x", type: "effect", slug: "sickened" }, { delete: true }), null);
});

test("смена id при пересоздании обёртки: старый не держит, новый держит", () => {
  const old = cond("k1", "clumsy", 1), fresh = cond("k2", "clumsy", 2);
  const a = actorOf(carrier("c", { clumsy: { floor: 2, id: "k2" } }), fresh);   // старого документа уже нет, запись переписана
  assert.equal(violation(a, fresh, { value: 1 }).how, "reduce");
  assert.equal(violation(a, old, { value: 0 }), null);
  const stale = actorOf(carrier("c", { clumsy: { floor: 1, id: "k1" } }), fresh);   // запись ещё со старым id
  assert.equal(floorOf(stale, "clumsy"), null);
  assert.equal(violation(stale, fresh, { value: 0 }), null);
});

test("newValue: плоский и вложенный ключ", () => {
  assert.equal(newValue({ "system.value.value": 1 }), 1);
  assert.equal(newValue({ system: { value: { value: 2 } } }), 2);
  assert.equal(newValue({ name: "x" }), undefined);
});

test("хуки: отмена, Alt, unchecked, limits off", async () => {
  const hooks = {}, warns = [];
  let mode = "auto", alt = false;
  globalThis.Hooks = { on: (n, f) => { hooks[n] = f; } };
  globalThis.ui = { notifications: { warn: (t) => warns.push(t) } };
  globalThis.game = { keyboard: { isModifierActive: () => alt }, i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => mode } };
  globalThis.CONFIG = { PF2E: { conditionTypes: {} } };
  init();
  const s = cond("s1", "sickened", 2), a = actorOf(carrier("c", { sickened: { floor: 2, id: "s1" } }), s);
  s.parent = a;
  assert.equal(hooks.preDeleteItem(s), false);
  assert.equal(hooks.preUpdateItem(s, { "system.value.value": 1 }), false);
  assert.equal(hooks.preUpdateItem(s, { "system.value.value": 3 }), undefined);
  assert.equal(warns.length, 1);   // второй отказ того же (актёр, slug) в тот же ход — без тоста, но отменён (п.7)
  alt = true; assert.equal(hooks.preDeleteItem(s), undefined); alt = false;
  assert.equal(await unchecked(async () => hooks.preDeleteItem(s)), undefined);
  assert.equal(hooks.preDeleteItem(s), false);   // обход снят
  mode = "off"; assert.equal(hooks.preDeleteItem(s), undefined);
});

test("удаление обёртки, выдавшей удерживаемое состояние, — нарушение (каскад pf2e); чужая обёртка — нет", () => {
  const w = { id: "w1", type: "effect", slug: "x" }, other = { id: "w2", type: "effect" };
  const c = { ...cond("k1", "clumsy", 2), grantedBy: { id: "w1" } };
  const a = actorOf(carrier("c", { clumsy: { floor: 2, id: "k1" } }), c, w, other);
  assert.equal(violation(a, w, { delete: true }).how, "remove");
  assert.equal(violation(a, other, { delete: true }), null);
});

test("unchecked считает по актёру: обход одного не снимает запрет с другого", async () => {
  const hooks = {};
  globalThis.Hooks = { on: (n, f) => { hooks[n] = f; } };
  globalThis.ui = { notifications: { warn() {} } };
  globalThis.game = { keyboard: { isModifierActive: () => false }, i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => "auto" } };
  globalThis.CONFIG = { PF2E: { conditionTypes: {} } };
  init();
  const mk = (uuid) => { const s = cond("s1", "sickened", 2), a = { ...actorOf(carrier("c", { sickened: { floor: 2, id: "s1" } }), s), uuid }; s.parent = a; return s; };
  const s1 = mk("Actor.1"), s2 = mk("Actor.2");
  await unchecked(async () => { assert.equal(hooks.preDeleteItem(s1), undefined); assert.equal(hooks.preDeleteItem(s2), false); }, s1.parent);
});

test("toastDue: дубль одной операции (2 с) гасится, повторная попытка позже — снова тост", () => {
  assert.equal(toastDue("a:s", 0), true);
  assert.equal(toastDue("a:s", 5), false);
  assert.equal(toastDue("b:s", 5), true);
  assert.equal(toastDue("a:s", 2000), true);
});
