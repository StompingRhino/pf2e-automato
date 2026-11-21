import test from "node:test";
import assert from "node:assert/strict";
import { spreadCut, subtractDamage } from "../scripts/builtin/damage-math.mjs";

const I = (total, persistent = false) => ({ total, persistent });

test("spreadCut: режущий 5 + огонь 3", () => {
  const d = [I(5), I(3)];
  assert.deepEqual(spreadCut(d, 5), [5, 0]);
  assert.deepEqual(spreadCut(d, 7), [5, 2]);
  assert.deepEqual(spreadCut(d, 8), [5, 3]);
});

test("spreadCut: n больше суммы, n = 0, мусор", () => {
  assert.deepEqual(spreadCut([I(5), I(3)], 99), [5, 3]);
  assert.deepEqual(spreadCut([I(5)], 0), [0]);
  assert.deepEqual(spreadCut([I(5)], NaN), [0]);
  assert.deepEqual(spreadCut([], 4), []);
});

test("spreadCut: продолжительный и пустой экземпляры не уменьшаются и не поглощают", () => {
  assert.deepEqual(spreadCut([I(0, true), I(6)], 4), [0, 4]);
  assert.deepEqual(spreadCut([I(2, true), I(0), I(6)], 9), [0, 0, 6]);
});

test("subtractDamage: число; n = 0; без экземпляров — alter(1, -n)", () => {
  assert.equal(subtractDamage(10, 4), 6);
  const d = { alter: (m, a) => `${m}/${a}` };
  assert.equal(subtractDamage(d, 4), "1/-4");
  assert.equal(subtractDamage(d, 0), d);
});

// Фейковый DamageRoll: проверяем сборку (какие экземпляры и с какой вычитаемой суммой), сами термины pf2e — живой прогон.
test("subtractDamage: пересборка по экземплярам", () => {
  class Inst {
    constructor(j) { Object.assign(this, j); this.options = j.options ?? {}; }
    static fromData(j) { return new Inst(j); }
    static fromTerms(terms, options) { return new Inst({ total: terms[0].total, type: terms[0].type, persistent: false, options, cut: terms[0].cut }); }
    toJSON() { return { total: this.total, type: this.type, persistent: this.persistent, options: this.options }; }
    get head() { return { toJSON: () => ({ total: this.total, type: this.type }) }; }
  }
  const Pool = { fromRolls: (r) => ({ rolls: r }) };
  class Roll { constructor(terms, options) { this.terms = terms; this.options = options; } static fromTerms(t, o) { return new Roll(t, o); } }
  Roll.prototype._evaluated = true;
  globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
  globalThis.CONFIG = { Dice: { termTypes: { ArithmeticExpression: { fromData: (j) => ({ total: j.operands[0].term.total - j.operands[1].number, type: j.operands[0].term.type, cut: j.operands[1].number }) } } } };
  const mk = (total, type, persistent = false) => new Inst({ total, type, persistent, options: { flavor: type } });
  const d = new Roll([{ constructor: Pool }], { crit: true });
  d.terms[0].constructor = Pool;
  d.instances = [mk(0, "bleed", true), mk(5, "slashing"), mk(3, "fire")];
  d._evaluated = true;
  const r = subtractDamage(d, 7);
  assert.equal(r.instances, undefined);
  const out = r.terms[0].rolls;
  assert.deepEqual(out.map((i) => i.total), [0, 0, 1]);
  assert.deepEqual(out.map((i) => i.type), ["bleed", "slashing", "fire"]);
  assert.deepEqual(r.options, { crit: true });
  delete globalThis.CONFIG; delete globalThis.foundry;
});
