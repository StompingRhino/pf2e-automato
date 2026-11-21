// Сон без падения (standing): фильтр GrantItem Prone и выбор Prone, выданного именно этим Unconscious.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripGrantedProne, grantedProneOf } from "../scripts/apply.mjs";

const PRONE = "Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60";

test("stripGrantedProne: убирает только GrantItem Prone", () => {
  const data = { system: { rules: [{ key: "GrantItem", uuid: PRONE }, { key: "GrantItem", uuid: "Compendium.pf2e.conditionitems.Item.other" }, { key: "FlatModifier" }] } };
  stripGrantedProne(data);
  assert.deepEqual(data.system.rules.map((r) => r.key), ["GrantItem", "FlatModifier"]);
  assert.notEqual(data.system.rules[0].uuid, PRONE);
  stripGrantedProne({});   // без правил не падает
});

test("grantedProneOf: только Prone с grantedBy этого Unconscious", () => {
  const mk = (slug, id, by) => ({ slug, id, flags: { pf2e: { grantedBy: by ? { id: by } : null } } });
  const manual = mk("prone", "p0", null), mine = mk("prone", "p1", "u1"), other = mk("prone", "p2", "u2");
  const actor = { itemTypes: { condition: [manual, other, mine] } };
  assert.equal(grantedProneOf(actor, "u1"), mine);
  assert.equal(grantedProneOf({ itemTypes: { condition: [manual] } }, "u1"), undefined);
});

test("catalog: обе записи Сна (ручной слой) — standing у unconscious ранга <=3, у 4+ нет", () => {
  const pa = JSON.parse(readFileSync(fileURLToPath(new URL("../rules/catalog.json", import.meta.url)), "utf8"));
  for (const [sec, key] of [["bySource", "Compendium.pf2e.spells-srd.Item.o4lRVTwSxnOOn5vl"], ["bySlug", "sleep"]]) {
    const by = pa[sec][key].onUse.challenge.byDegree;
    const un = ["failure", "criticalFailure"].flatMap((d) => by[d]).filter((s) => s.condition.slug === "unconscious");
    assert.equal(un.filter((s) => s.rank.max === 3 && s.condition.standing === true).length, 2, key);
    assert.equal(un.filter((s) => s.rank.min >= 4 && !s.condition.standing).length, 2, key);
  }
});
