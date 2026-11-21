import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWeighted, assetScaleOf, findAsset, catKey } from "../scripts/nexus-tokens.mjs";

globalThis.game = { user: { isGM: true } };
const ENTRIES = [...["Tree_Green_A1_6x6", "Tree_Yellow_A1_6x6", "Tree_Red_A1_6x6", "Tree_Multicolor1_A1_6x6", "Fir_Tree_Green_Medium_A1_3x3"].map((id) => ({ id: `d/${id}` })), { id: "f/Tree_Multicolor2_A1_6x6", rare: 0.05 }];

test("pickWeighted: пусто — null; редкий 5%, остальные по 19%; границы", () => {
  assert.equal(pickWeighted([], () => 0), null);
  assert.equal(pickWeighted(null), null);
  assert.equal(pickWeighted(ENTRIES, () => 0).id, "d/Tree_Green_A1_6x6");
  assert.equal(pickWeighted(ENTRIES, () => 0.189).id, "d/Tree_Green_A1_6x6");
  assert.equal(pickWeighted(ENTRIES, () => 0.191).id, "d/Tree_Yellow_A1_6x6");
  assert.equal(pickWeighted(ENTRIES, () => 0.949).id, "d/Fir_Tree_Green_Medium_A1_3x3");
  assert.equal(pickWeighted(ENTRIES, () => 0.96).id, "f/Tree_Multicolor2_A1_6x6");
  assert.equal(pickWeighted(ENTRIES, () => 0.99999).id, "f/Tree_Multicolor2_A1_6x6");
  const hits = {};
  for (let i = 0; i < 1000; i++) { const id = pickWeighted(ENTRIES, () => (i + 0.5) / 1000).id; hits[id] = (hits[id] ?? 0) + 1; }
  assert.equal(hits["f/Tree_Multicolor2_A1_6x6"], 50);
  assert.equal(hits["d/Tree_Green_A1_6x6"], 190);
});

test("pickWeighted: один элемент и только редкие не ломаются", () => {
  assert.equal(pickWeighted([{ id: "x" }], () => 0.9).id, "x");
  assert.equal(pickWeighted([{ id: "x", rare: 0.5 }, { id: "y", rare: 0.5 }], () => 0.6).id, "y");
});

test("assetScaleOf: 6x6 → 2, 3x3 → 1, нет размера → 1", () => {
  assert.equal(assetScaleOf("a/Tree_Green_A1_6x6"), 2);
  assert.equal(assetScaleOf("a/Fir_Tree_Green_Medium_A1_3x3"), 1);
  assert.equal(assetScaleOf("a/Bush_2x2"), 1);
  assert.equal(assetScaleOf("a/Tree"), 1);
});

const mkEnv = ({ items = [], any = true, state = "ok", enabled = true, dl = async (i) => `fa/${catKey(i)}.webp` } = {}) => {
  const calls = { kind: null, list: [], dl: 0 };
  return { calls, enabled: () => enabled, state: () => state, local: async () => [],
    openCatalog: async (kind) => { calls.kind = kind; return { list: async (t) => { calls.list.push(t); if (items instanceof Error) throw items; return items; }, any: async () => any, download: async (i) => { calls.dl++; return dl(i); }, close() {} }; } };
};

test("findAsset: причины disabled / no-nexus / unverified / пустой список", async () => {
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv({ enabled: false }) }), { reason: "disabled" });
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv({ state: "no-nexus" }) }), { reason: "no-nexus" });
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv({ state: "unverified" }) }), { reason: "unverified" });
  assert.deepEqual(await findAsset([], { env: mkEnv() }), { reason: "not-found" });
});

test("findAsset: поиск по имени файла, точное совпадение id, kind assets, scale из размера", async () => {
  const env = mkEnv({ items: [{ id: "d/Tree_Green_A1_6x6_Variant" }, { id: "d/Tree_Green_A1_6x6" }] });
  const r = await findAsset(ENTRIES, { env, rnd: () => 0 });
  assert.deepEqual(r, { src: "fa/d/Tree_Green_A1_6x6.webp", scale: 2 });
  assert.equal(env.calls.kind, "assets");
  assert.deepEqual(env.calls.list, ["Tree_Green_A1_6x6"]);
});

test("findAsset: нет записи / каталог пуст / сбой сети / скачивание не удалось — reason, без исключений", async () => {
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv({ items: [{ id: "d/Other" }] }), rnd: () => 0 }), { reason: "not-found" });
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv({ any: false }), rnd: () => 0 }), { reason: "catalog-empty" });
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv({ items: new Error("net") }), rnd: () => 0 }), { reason: "offline" });
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv({ items: [{ id: "d/Tree_Yellow_A1_6x6" }], dl: async () => null }), rnd: () => 0.2 }), { reason: "offline" });
});

test("findAsset: не-ГМ — disabled", async () => {
  globalThis.game.user.isGM = false;
  assert.deepEqual(await findAsset(ENTRIES, { env: mkEnv() }), { reason: "disabled" });
  globalThis.game.user.isGM = true;
});

test("findAsset: файл уже на диске — без каталога; нет на диске — каталог", async () => {
  let env = { ...mkEnv(), probe: async (id) => `disk/${id}.webp` };
  assert.deepEqual(await findAsset(ENTRIES, { env, rnd: () => 0 }), { src: "disk/d/Tree_Green_A1_6x6.webp", scale: 2 });
  assert.equal(env.calls.kind, null);   // каталог не открывался
  env = { ...mkEnv({ items: [{ id: "f/Tree_Multicolor2_A1_6x6" }] }), probe: async () => null };
  assert.deepEqual(await findAsset(ENTRIES, { env, rnd: () => 0.99 }), { src: "fa/f/Tree_Multicolor2_A1_6x6.webp", scale: 2 });
  assert.deepEqual(env.calls.list, ["Tree_Multicolor2_A1_6x6"]);
});
