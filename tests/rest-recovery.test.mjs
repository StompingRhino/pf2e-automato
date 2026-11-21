import test from "node:test";
import assert from "node:assert/strict";
import { EXTRA, extraPlan } from "../scripts/builtin/rest-recovery.mjs";

test("rest-recovery: группа и план — состояние снимается ещё на 1 один раз, даже от двух способностей", () => {
  assert.deepEqual(EXTRA["dream-may"], ["drained", "doomed"]);
  assert.deepEqual(extraPlan([{ item: "Сонное чадо", slugs: EXTRA["dream-may"] }, { item: "Быстрое восстановление", slugs: EXTRA["fast-recovery"] }]),
    { drained: ["Сонное чадо", "Быстрое восстановление"], doomed: ["Сонное чадо"] });
  assert.deepEqual(extraPlan([]), {});
});
