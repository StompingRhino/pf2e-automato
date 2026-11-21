import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isStrike, isHit, pickTree, absorbOf, strikeTotal } from "../scripts/builtin/guard.mjs";
import { blockHappened } from "../scripts/builtin/shield-block.mjs";

const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
const tree = (id, hp, x, o = {}) => ({ id, hp, by: "Actor.druid", rect: { x, y: 0 }, guard: { adjacent: 5, alliance: "party", ...o } });
const target = (x = 1, o = {}) => ({ id: "T", alliance: "party", actorUuid: "Actor.fighter", rect: { x, y: 0 }, ...o });

test("isStrike: оружие и ближний бой, не заклинание", () => {
  assert.equal(isStrike({ type: "weapon" }, []), true);
  assert.equal(isStrike({ type: "melee" }, ["a"]), true);
  assert.equal(isStrike({ type: "spell" }, []), false);
  assert.equal(isStrike({ type: "weapon" }, ["item:type:spell"]), false);
  assert.equal(isStrike({ type: "effect" }, []), false);
  assert.equal(isStrike(null, []), false);
});

test("isHit: попадание, критическое, null; промах — нет", () => {
  for (const o of ["success", "criticalSuccess", null, undefined]) assert.equal(isHit(o), true);
  for (const o of ["failure", "criticalFailure"]) assert.equal(isHit(o), false);
});

test("pickTree: смежность, союзность, заклинатель, alliance null, павшее, само дерево", () => {
  assert.equal(pickTree([tree("a", 10, 0)], target(1), dist).id, "a");
  assert.equal(pickTree([tree("a", 10, 5)], target(1), dist), null);   // не сосед
  assert.equal(pickTree([tree("a", 10, 0, { alliance: "opposition" })], target(1), dist), null);   // не союзник
  assert.equal(pickTree([tree("a", 10, 0)], target(1, { actorUuid: "Actor.druid" }), dist), null);   // сам заклинатель
  assert.equal(pickTree([tree("a", 10, 0, { alliance: null })], target(1, { alliance: null }), dist), null);
  assert.equal(pickTree([tree("a", 0, 0)], target(1), dist), null);   // повалено
  assert.equal(pickTree([tree("T", 10, 0)], target(1), dist), null);   // цель — дерево
});

test("pickTree: два дерева — с большим остатком ПЗ, при равенстве меньший id", () => {
  assert.equal(pickTree([tree("a", 4, 0), tree("b", 9, 2)], target(1), dist).id, "b");
  assert.equal(pickTree([tree("z", 5, 0), tree("m", 5, 2)], target(1), dist).id, "m");
});

test("absorbOf", () => {
  assert.equal(absorbOf(6, 10), 6);
  assert.equal(absorbOf(14, 10), 10);
  assert.equal(absorbOf(5, 0), 0);
});

test("Блок щитом: полностью поглощённый урон (0) блока не создаёт", () => {
  const shield = { raised: true, hardness: 5 };
  assert.equal(blockHappened({ request: true, damage: 6, shield }), true);
  assert.equal(blockHappened({ request: true, damage: { total: 0 }, shield }), false);
});

test("порядок подписчиков: guard.install раньше shieldBlock.wrapApplyDamage, damaged — first", () => {
  const src = readFileSync(new URL("../scripts/builtin/index.mjs", import.meta.url), "utf8");
  assert.ok(src.indexOf("guard.install") < src.indexOf("shieldBlock.wrapApplyDamage"));
  assert.match(readFileSync(new URL("../scripts/builtin/damaged.mjs", import.meta.url), "utf8"), /subscribe\([^)]*first: true/);
});

test("strikeTotal: непродолжительные экземпляры; минимум 1 урона (total=1, экземпляры 0) — 0", () => {
  assert.equal(strikeTotal(7), 7);
  assert.equal(strikeTotal({ total: 9, instances: [{ total: 6, persistent: false }, { total: 3, persistent: true }] }), 6);
  assert.equal(strikeTotal({ total: 1, instances: [{ total: 0, persistent: false }] }), 0);
  assert.equal(strikeTotal({ total: 4 }), 4);
});
