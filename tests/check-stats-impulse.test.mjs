import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer } from "../tools/validate.mjs";
import { pickStatistic } from "../scripts/checks.mjs";

const rule = (statistic) => ({ v: 1, label: "X", onUse: { targets: "selected", check: { statistic, vs: { defense: "ac" }, roll: "system", byDegree: { success: [{ to: "target", condition: { slug: "clumsy", value: 1 }, duration: { value: 1, unit: "rounds" } }] } }, apply: [] } });
const errs = (statistic) => checkAnswer({ uuid: "u", rule: rule(statistic), unsure: false, note: "" }, { conditions: { clumsy: true }, effects: {} }, null, "feat").errors ?? [];

test("validate: impulse и deviant — статистика проверки; мусорный slug отвергается", () => {
  for (const s of ["impulse", "deviant"]) assert.ok(!errs(s).some((e) => /check\.statistic/.test(e)), s);
  assert.ok(errs("nonsense").some((e) => /check\.statistic/.test(e)));
});

test("pickStatistic: рантайм берёт impulse/deviant через getStatistic, нет статистики — null", () => {
  const actor = { getStatistic: (s) => ({ impulse: { id: "imp", check: { mod: 9 } } })[s] ?? null };
  assert.equal(pickStatistic(actor, "impulse").id, "imp");
  assert.equal(pickStatistic(actor, "deviant"), null);
});
