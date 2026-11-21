import test from "node:test";
import assert from "node:assert/strict";
import { bonusesFor } from "../scripts/builtin/craft-bonus.mjs";

test("craft-bonus: Татуировщик — +1 к татуировке, +2 у мастера; другой предмет и без черты — нет", () => {
  const feats = [{ slug: "tattoo-artist", name: "Татуировщик" }, { slug: "other", name: "x" }];
  assert.deepEqual(bonusesFor(feats, ["magical", "tattoo"], 2), [{ slug: "tattoo-artist", label: "Татуировщик", value: 1 }]);
  assert.equal(bonusesFor(feats, ["tattoo"], 3)[0].value, 2);
  assert.deepEqual(bonusesFor(feats, ["magical"], 4), []);
  assert.deepEqual(bonusesFor([{ slug: "other", name: "x" }], ["tattoo"], 4), []);
});
