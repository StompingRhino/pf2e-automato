import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.game ??= {};
const { wrap, violation, actionOf, isOtherItem, reliefFor, unchecked, onTextClick, freeHands, ACTS, RELIEF } = await import("../scripts/builtin/maneuver-gate.mjs");

const F = (o = {}) => ({ hands: 1, strikes: [], base: 5, holding: false, size: 2, tSize: 2, dist: 5, relief: { size: 0, hand: false }, ...o });
const sword = { traits: ["agile"], reach: 5 }, trip = (reach = 5) => ({ traits: ["trip"], reach });

test("рука: нет свободной руки — блок; рука есть — пропуск", () => {
  assert.deepEqual(violation("trip", F({ hands: 0 })), { key: "noHandTrait", trait: "trip" });
  assert.deepEqual(violation("reposition", F({ hands: 0 })), { key: "noHand", trait: undefined });   // у Перемещения черты оружия нет
  assert.equal(violation("trip", F()), null);
  assert.equal(violation("trip", F({ hands: 0, strikes: [sword] }))?.key, "noHandTrait");   // оружие без черты руку не заменяет
});

test("оружие с чертой манёвра заменяет руку; досягаемость — оружия", () => {
  assert.equal(violation("trip", F({ hands: 0, strikes: [trip()] })), null);
  assert.equal(violation("trip", F({ hands: 0, strikes: [trip(10)], dist: 10 })), null);
  assert.deepEqual(violation("trip", F({ hands: 0, strikes: [trip(5)], dist: 10 })), { key: "reach", d: 10, r: 5 });
  assert.equal(violation("shove", F({ hands: 0, strikes: [trip()] }))?.key, "noHandTrait");   // черта trip не годится для Толчка
});

test("Перемещение и Захват без руки — если цель уже схвачена; Подсечка — нет", () => {
  assert.equal(violation("reposition", F({ hands: 0, holding: true })), null);
  assert.equal(violation("grapple", F({ hands: 0, holding: true })), null);
  assert.equal(violation("trip", F({ hands: 0, holding: true }))?.key, "noHandTrait");
});

test("размер: на два больше — блок, на один — нет; Titan Wrestler снимает", () => {
  assert.deepEqual(violation("grapple", F({ tSize: 4 })), { key: "size" });
  assert.equal(violation("grapple", F({ tSize: 3 })), null);
  assert.equal(violation("grapple", F({ tSize: 4, relief: reliefFor("grapple", ["titan-wrestler"], { skills: { athletics: { rank: 2 } } }) })), null);
  assert.equal(violation("grapple", F({ tSize: 5, relief: reliefFor("grapple", ["titan-wrestler"], { skills: { athletics: { rank: 2 } } }) }))?.key, "size");
  assert.equal(violation("grapple", F({ tSize: 5, relief: reliefFor("grapple", ["titan-wrestler"], { skills: { athletics: { rank: 4 } } }) })), null);
  assert.equal(reliefFor("trip", ["disarming-stance"], {}).size, 0);   // стойка — только Разоружение
  assert.equal(violation("disarm", F({ tSize: 4, relief: reliefFor("disarm", ["disarming-stance"], {}) })), null);
});

test("снятие руки пассивом: Legs of Stone — только Толчок", () => {
  assert.equal(violation("shove", F({ hands: 0, relief: reliefFor("shove", ["legs-of-stone"], {}) })), null);
  assert.equal(violation("trip", F({ hands: 0, relief: reliefFor("trip", ["legs-of-stone"], {}) }))?.key, "noHandTrait");
});

test("размер/досягаемость без чисел (гексы, нет цели, нет токена) — не блокируют", () => {
  assert.equal(violation("grapple", F({ size: NaN, tSize: NaN, dist: NaN })), null);
  assert.equal(violation("feint", F({ dist: NaN })), null);
  assert.equal(violation("demoralize", F({ dist: NaN })), null);
});

test("досягаемость: вне — блок; Финт — лучшая из рук и Ударов; Грязный приём — рука и досягаемость", () => {
  assert.deepEqual(violation("trip", F({ dist: 10 })), { key: "reach", d: 10, r: 5 });
  assert.equal(violation("trip", F({ dist: 10, base: 10 })), null);
  assert.equal(violation("feint", F({ dist: 10, strikes: [{ traits: [], reach: 10 }] })), null);
  assert.equal(violation("feint", F({ dist: 10 }))?.key, "reach");
  assert.equal(violation("feint", F({ hands: 0 })), null);   // Финту рука не нужна
  assert.equal(violation("dirty-trick", F({ hands: 0 }))?.key, "noHand");
  assert.equal(violation("dirty-trick", F({ dist: 10 }))?.key, "reach");
});

test("Деморализация и Остроумная фраза — 30 фт", () => {
  assert.equal(violation("demoralize", F({ dist: 30 })), null);
  assert.deepEqual(violation("demoralize", F({ dist: 35, hands: 0 })), { key: "range30", d: 35, r: 30 });
  assert.equal(violation("bon-mot", F({ dist: 35 }))?.key, "range30");
});

test("actionOf: только одиночный slug из группы", () => {
  assert.equal(actionOf(["check:statistic:athletics", "action:trip"]), "trip");
  assert.equal(actionOf(["action:escape"]), null);
  assert.equal(actionOf(["action:cost:1"]), null);
  assert.equal(actionOf(undefined), null);
  for (const k of Object.keys(RELIEF)) assert.ok(RELIEF[k].acts.every((a) => ACTS[a]));
});

test("isOtherItem: чужой предмет и атака заклинанием пропускаются; сам предмет-действие и пустой item — нет", () => {
  assert.equal(isOtherItem("trip", { item: { slug: "slam-down" } }), true);
  assert.equal(isOtherItem("trip", { item: { slug: "trip" } }), false);
  assert.equal(isOtherItem("trip", {}), false);
  assert.equal(isOtherItem("shove", { domains: ["all", "spell-attack", "attack"] }), true);
});

test("unchecked возвращает результат и не залипает", async () => {
  assert.equal(await unchecked(async () => 7), 7);
  await assert.rejects(unchecked(async () => { throw new Error("x"); }));
});

test("onTextClick: клик вне ссылки действия ничего не делает", () => {
  assert.doesNotThrow(() => onTextClick({ target: { closest: () => null } }));
});

// сквозной: wrap с подменой pf2e/настроек
const fake = (o = {}) => ({
  options: new Set(["action:trip"]),
  actor: { id: "a", size: "med", handsFree: 0, system: { actions: o.actions ?? [] }, attributes: { reach: { base: 5 } }, items: o.items ?? [], itemTypes: { condition: [] }, getReach: () => 5, skills: {} },
  target: { actor: { size: o.tSize ?? "med", itemTypes: { condition: [] } } }, ...o.ctx
});
async function run(ctx, { alt = false, mode = "auto" } = {}) {
  const warns = []; let called = 0;
  globalThis.ui = { notifications: { warn: (m) => warns.push(m) } };
  globalThis.game = { keyboard: { isModifierActive: () => alt }, settings: { get: () => mode }, i18n: { localize: (k) => k, format: (k, d) => k + JSON.stringify(d), has: () => false } };
  const r = await wrap(async () => { called++; return "rolled"; }, {}, ctx);
  return { r, called, warns };
}

test("wrap: нет руки — броска нет и предупреждение", async () => {
  const x = await run(fake());
  assert.equal(x.r, null); assert.equal(x.called, 0); assert.match(x.warns[0], /noHandTrait/);
});
test("wrap: Alt, limits off, чужой предмет, spell-attack, свой бросок модуля — бросок идёт", async () => {
  assert.equal((await run(fake(), { alt: true })).called, 1);
  assert.equal((await run(fake(), { mode: "off" })).called, 1);
  assert.equal((await run(fake({ ctx: { item: { slug: "slam-down" } } }))).called, 1);
  assert.equal((await run(fake({ ctx: { domains: ["spell-attack"] } }))).called, 1);
  assert.equal(await unchecked(async () => (await run(fake())).called), 1);
});
test("wrap: оружие с чертой — пропуск; сетка не квадратная — размер/досягаемость не блокируют", async () => {
  assert.equal((await run(fake({ actions: [{ ready: true, item: { isMelee: true, system: { traits: { value: ["trip"] } } } }] }))).called, 1);
  const own = fake({ items: [{ slug: "x" }] }); own.actor.handsFree = 1;
  assert.equal((await run({ ...own, target: { actor: { size: "grg", itemTypes: { condition: [] } } } })).called, 1);   // canvas нет — размер не мерим
});

test("досягаемость кандидата: distFor по своей досягаемости (диагональ 2 клеток — 10 при reach 10, 15 при 5)", () => {
  const distFor = (r) => (r === 10 ? 10 : 15);
  assert.equal(violation("trip", F({ hands: 0, strikes: [trip(10)], base: 5, dist: 15, distFor })), null);   // кнут по диагонали
  assert.deepEqual(violation("trip", F({ hands: 0, strikes: [trip(5)], base: 5, dist: 15, distFor })), { key: "reach", d: 15, r: 5 });
  assert.equal(violation("feint", F({ dist: 15, distFor, strikes: [{ traits: [], reach: 10 }] })), null);
});

test("freeHands: щит занимает руку, free-hand предмет — нет; NPC без hands — handsFree/1", () => {
  const A = (really, held = [], max = 2) => ({ handsReallyFree: really, handsFree: 1, inventory: held, system: { hands: { max: { value: max } } } });
  assert.equal(freeHands(A(1)), 1);
  assert.equal(freeHands(A(0)), 0);   // меч + щит: really 0 (handsFree у pf2e был бы 1)
  assert.equal(freeHands(A(0, [{ system: { traits: { value: ["free-hand"] } }, handsHeld: 1 }])), 1);   // Nimble Shield Hand
  assert.equal(freeHands(A(2, [{ system: { traits: { value: ["free-hand"] } }, handsHeld: 1 }])), 2);   // не больше max
  assert.equal(freeHands({ handsFree: 0 }), 0);
  assert.equal(freeHands({}), 1);
});

test("onTextClick: пропуск только при чужом предмете; своя Подсечка и журнал — без пропуска (тест последний: окно 2 с)", async () => {
  const click = ({ msgItem, sheetItem }) => {
    globalThis.ui = { windows: { 7: sheetItem ? { item: sheetItem } : { document: {} } } };
    globalThis.game = { messages: { get: () => ({ item: msgItem }) } };
    const el = { dataset: { pf2Action: "trip" }, closest: (s) => (s === "[data-message-id]" ? (msgItem ? { dataset: { messageId: "m" } } : null) : { dataset: { appid: "7" } }) };
    onTextClick({ target: { closest: () => el } });
  };
  click({ msgItem: { slug: "trip" } }); assert.equal((await run(fake())).called, 0);   // карточка самой Подсечки
  click({ sheetItem: { slug: "trip" } }); assert.equal((await run(fake())).called, 0);   // лист самой Подсечки
  click({}); assert.equal((await run(fake())).called, 0);   // журнал
  click({ sheetItem: { slug: "slam-down" } }); assert.equal((await run(fake())).called, 1);   // чужой предмет
});
