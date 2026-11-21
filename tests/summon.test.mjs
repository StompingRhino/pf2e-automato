import test from "node:test";
import assert from "node:assert/strict";
import { LIMIT, idemKey, countOf, durSeconds, isUseCard, limitProblem, pickAllowed, actionPack, distanceFt, placeAt } from "../scripts/summon.mjs";

test("лимиты: призванное не призывает, не больше 4 приспешников, Alt обходит", () => {
  assert.equal(LIMIT, 4);
  assert.equal(limitProblem({ nested: true, minions: 0 }), "nested");
  assert.equal(limitProblem({ nested: false, minions: 3 }), null);
  assert.equal(limitProblem({ nested: false, minions: 4 }), "cap");
  assert.equal(limitProblem({ nested: false, minions: 3, add: 2 }), "cap");
  assert.equal(limitProblem({ nested: true, minions: 9, force: true }), null);
});

test("идемпотентность: ключ «сообщение + номер», количество из правила", () => {
  assert.equal(idemKey("m1", 0), "m1:summon:0");
  assert.notEqual(idemKey("m1", 0), idemKey("m1", 1));
  assert.equal(countOf({ count: 3 }), 3);
  assert.equal(countOf({}), 1);
  assert.equal(countOf(null), 1);
});

test("выбор проверяется по списку кандидатов (npc, common, уровень — у S1)", () => {
  const list = [{ uuid: "A", name: "a" }, { uuid: "B", name: "b" }];
  assert.equal(pickAllowed(list, "B").name, "b");
  assert.equal(pickAllowed(list, "C"), null);
  assert.equal(pickAllowed(null, "A"), null);
});


test("действия приспешника: по сотворению и при засчитанном Поддержании — 2; повтор/пусто — ничего", () => {
  assert.deepEqual(actionPack("cast", ["Зомби", "Скелет"]), { key: "actionsCast", actions: 2, list: "Зомби, Скелет" });
  assert.equal(actionPack("fresh", ["X"]).key, "actionsSustain");
  assert.equal(actionPack("fresh", ["X"]).actions, 2);
  assert.equal(actionPack("again", ["X"]), null);
  assert.equal(actionPack("fresh", []), null);
});

test("карточка: сотворение/способность — да, броски с context — нет", () => {
  assert.equal(isUseCard({ flags: { pf2e: { origin: { type: "spell" }, context: { type: "spell-cast" } } } }), true);
  assert.equal(isUseCard({ flags: { pf2e: { origin: { type: "feat" } } } }), true);
  assert.equal(isUseCard({ flags: { pf2e: { origin: { type: "spell" }, context: { type: "damage-roll" } } } }), false);
  assert.equal(isUseCard({ flags: {} }), false);
});

test("срок в секундах; расстояние и место", () => {
  assert.equal(durSeconds({ value: 1, unit: "minutes" }), 60);
  assert.equal(durSeconds(null), 0);
  const o = { x: 0, y: 0, w: 1, h: 1 };
  assert.equal(distanceFt(o, { x: 1, y: 0, w: 1, h: 1 }), 5);   // вплотную
  assert.equal(distanceFt(o, { x: 6, y: 0, w: 1, h: 1 }), 30);  // 30 фт по прямой
  assert.equal(distanceFt(o, { x: 4, y: 4, w: 1, h: 1 }), 30);  // диагональ 1-2-1: 4+2 = 6 клеток
  assert.deepEqual(placeAt({ x: 3, y: 3 }, { w: 1, h: 1 }, []), { x: 3, y: 3, w: 1, h: 1 });
  const busy = placeAt({ x: 3, y: 3 }, { w: 1, h: 1 }, [{ x: 3, y: 3, w: 1, h: 1 }]);
  assert.ok(busy && !(busy.x === 3 && busy.y === 3) && Math.abs(busy.x - 3) <= 1 && Math.abs(busy.y - 3) <= 1);
  assert.equal(placeAt({ x: 0, y: 0 }, { w: 1, h: 1 }, [{ x: -1, y: -1, w: 3, h: 3 }]), null);
});

test("rangeCells: клетки в пределах дальности вокруг токена (без клеток самого токена)", async () => {
  const { rangeCells } = await import("../scripts/summon.mjs");
  const cells = rangeCells({ x: 10, y: 10, w: 1, h: 1 }, 5, 5);
  assert.equal(cells.length, 8);   // 5 фт — соседние клетки, включая диагональ
  assert.ok(!cells.some((c) => c.x === 10 && c.y === 10));
  assert.ok(rangeCells({ x: 10, y: 10, w: 1, h: 1 }, 30, 5).every((c) => Math.abs(c.x - 10) <= 6 && Math.abs(c.y - 10) <= 6));
});

import { objectHp, objectRank, treeVisibility, previousObjects, minionsOf } from "../scripts/summon.mjs";
import { validateRule } from "../scripts/rules.mjs";

test("объект: ПЗ = base + perRank за ранг сверх fromRank (ранг 1 → 10, 3 → 30)", () => {
  const o = { hp: { base: 10, perRank: 10, fromRank: 1 } };
  assert.equal(objectHp(o, 1), 10);
  assert.equal(objectHp(o, 3), 30);
  assert.equal(objectHp(o, 0), 10);
});

test("объект: ранг — по ceil(уровень/2) при rankFrom, иначе ранг сотворения", () => {
  assert.equal(objectRank({ rankFrom: "halfLevel" }, { cast: 9, level: 5 }), 3);
  assert.equal(objectRank({ rankFrom: "halfLevel" }, { level: 4 }), 2);
  assert.equal(objectRank({}, { cast: 3, item: 1, level: 9 }), 3);
  assert.equal(objectRank(undefined, { item: 2, level: 9 }), 2);
  assert.equal(objectRank(undefined, { level: 5 }), 3);
});

test("павшее дерево: hp ≤ 0 скрывает, hp > 0 показывает, без перемен — null", () => {
  assert.deepEqual(treeVisibility({ hp: 0, hidden: false }), { hidden: true, felled: true });
  assert.deepEqual(treeVisibility({ hp: -3, hidden: false }), { hidden: true, felled: true });
  assert.equal(treeVisibility({ hp: 0, hidden: true }), null);
  assert.deepEqual(treeVisibility({ hp: 4, hidden: true }), { hidden: false, felled: false });
  assert.equal(treeVisibility({ hp: 4, hidden: false }), null);
  assert.equal(treeVisibility({ hp: undefined, hidden: true }), null);
});

test("single: прежние деревья того же автора и записи, но не новое и не чужие", () => {
  const t = (uuid, by, src, kind = "object") => ({ uuid, flag: { kind, by, src } });
  const list = [t("old", "A", "S"), t("new", "A", "S"), t("other", "B", "S"), t("src2", "A", "S2"), t("minion", "A", "S", "creature"), { uuid: "plain", flag: null }];
  assert.deepEqual(previousObjects(list, { by: "A", src: "S", keep: "new" }), ["old"]);
});

test("minionsOf: объекты в лимит приспешников не входят", () => {
  globalThis.game = { scenes: { contents: [{ tokens: { contents: [
    { flags: { "pf2e-automato": { summoned: { by: "A", kind: "object" } } } },
    { flags: { "pf2e-automato": { summoned: { by: "A" } } } }
  ] } }] } };
  assert.equal(minionsOf("A").length, 1);
  delete globalThis.game;
});

test("валидатор: onUse.summon.object — форма, нормализация, взаимоисключение с traits", () => {
  const object = { hp: { base: 10, perRank: 10, fromRank: 1 }, ac: 10, guard: { on: "strike", adjacent: 5, side: "allies" },
    art: { kind: "assets", entries: [{ id: "a/B_6x6" }, { id: "a/C_6x6", rare: 0.05 }] }, range: 30, duration: { value: 1, unit: "minutes" }, single: true, rankFrom: "halfLevel" };
  const mk = (summon) => validateRule({ v: 1, onUse: { targets: "self", apply: [], summon } });
  const ok = mk({ object });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.deepEqual(ok.rule.onUse.summon.object, object);
  assert.equal(mk({ object: { ...object, single: undefined } }).rule.onUse.summon.object.single, false);
  for (const bad of [{ object, traits: ["x"] }, { object, count: 2 }, { object: { ...object, ac: -1 } }, { object: { ...object, guard: { ...object.guard, on: "spell" } } },
    { object: { ...object, art: { kind: "tokens", entries: object.art.entries } } }, { object: { ...object, art: { kind: "assets", entries: [] } } },
    { object: { ...object, art: { kind: "assets", entries: [{ id: "x", rare: 2 }] } } }, { object: { ...object, duration: { value: 1, unit: "years" } } }, { object: { ...object, rankFrom: "x" } }])
    assert.equal(mk(bad).ok, false, JSON.stringify(bad).slice(0, 80));
  assert.ok(mk({ traits: ["plant"] }).ok);
});

test("валидатор: condition.standing — только true и только unconscious", () => {
  const mk = (condition) => validateRule({ v: 1, onUse: { targets: "self", apply: [{ to: "self", condition }] } });
  const ok = mk({ slug: "unconscious", standing: true });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(ok.rule.onUse.apply[0].condition.standing, true);
  assert.equal(mk({ slug: "unconscious" }).rule.onUse.apply[0].condition.standing, undefined);
  assert.equal(mk({ slug: "prone", standing: true }).ok, false);
  assert.equal(mk({ slug: "unconscious", standing: false }).ok, false);
});
