// Модельный путь: бонус атаки/противодействия/СЛ активации «сотворить» берётся из текста предмета (tools/validate.mjs semanticErrors)
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { data: { regionBehaviors: { RegionBehaviorType: class {} }, fields: new Proxy({}, { get: () => class {} }) } };
const { semanticErrors } = await import("../tools/validate.mjs");

const SP = "Compendium.pf2e.spells-srd.Item.kcelf6IHl3L9VXXg", refs = { conditions: {}, effects: {} };
const html = (eff) => `<p><strong>Activate</strong> Cast a Spell</p><p><strong>Effect</strong> casts 1st-rank @UUID[${SP}]{Vitality Lash}. ${eff}</p>`;
const rule = (e) => ({ v: 1, label: "X", activate: [{ id: "a", spell: SP, rank: 1, ...e }] });
const errs = (e, eff) => semanticErrors(rule(e), refs, html(eff)).filter((m) => /text/.test(m) && /attack|counteract|dc/.test(m));

test("активация: атака и противодействие из текста — нет поля или другое число = ошибка", () => {
  const t = "The spell attack roll and counteract modifier are +7.";
  assert.equal(errs({ attack: 7, counteract: 7 }, t).length, 0);
  assert.match(errs({}, t).join(), /attack missing[\s\S]*counteract missing/);
  assert.match(errs({ attack: 8, counteract: 7 }, t).join(), /attack 8 != text 7/);
});

test("активация: числа в тексте нет — поля не требуются", () => assert.equal(errs({}, "").length, 0));
