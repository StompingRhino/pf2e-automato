import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreName, bestMatch } from "../scripts/nexus-tokens.mjs";

test("scoreName: целиком > с начала > слово внутри > подстрока", () => {
  assert.equal(scoreName("Goblin_Red_01.webp", "Goblin"), 4);
  assert.equal(scoreName("Goblin_Warrior_01.webp", "goblin"), 3);
  assert.equal(scoreName("Cave_Goblin_Blue.png", "Goblin"), 2);
  assert.equal(scoreName("Hobgoblin_01.webp", "Goblin"), 1);
  assert.equal(scoreName("Orc_01.webp", "Goblin"), 0);
  assert.equal(scoreName("Giant_Rat_Green.webp", "giant rat"), 4);
});

test("bestMatch: лучший файл; первое имя важнее; при равенстве короче; пусто -> null", () => {
  const files = ["t/Goblin_Warrior_01.webp", "t/Cave_Goblin.webp", "t/Goblin_Blue.webp", "t/Goblin_Red_02.webp"];
  assert.equal(bestMatch(files, ["Goblin"]), "t/Goblin_Blue.webp");
  assert.equal(bestMatch(["t/Wolf.webp", "t/Dire_Wolf.webp"], ["Dire Wolf", "Wolf"]), "t/Dire_Wolf.webp");
  assert.equal(bestMatch(["t/Orc.webp"], ["Goblin"]), null);
  assert.equal(bestMatch([{ filename: "Imp_Red.webp" }], ["Imp"], (x) => x.filename).filename, "Imp_Red.webp");
});

test("русские имена и обрывки не подбирают чужой токен; подстрока внутри слова — не совпадение", async () => {
  const { bestMatch } = await import("../scripts/nexus-tokens.mjs");
  const files = ["Goblin_Fighter_C1_Spear_01.webp", "Skeleton_Guard_A1_Spear_Undead_01.webp", "Simple_Barrel_01.webp"];
  assert.equal(bestMatch(files, ["Cкелет лошади", "Skeletal Horse"]), null);   // латинская «C» в русском имени
  assert.equal(bestMatch(files, ["Imp"]), null);
  assert.equal(bestMatch(files, ["Skeleton Guard"]), "Skeleton_Guard_A1_Spear_Undead_01.webp");
});

import { findToken, scaleOf, pickFile } from "../scripts/nexus-tokens.mjs";

globalThis.game = { user: { isGM: true } };
const mkEnv = ({ local = [], lists = {}, any = true, state = "ok", enabled = true, dl = async (i) => `fa-nexus-tokens/${i.filename}` } = {}) => {
  const calls = { list: [], dl: 0, forget: 0 };
  return { calls, enabled: () => enabled, state: () => state, local: async () => local, forget: () => calls.forget++,
    openCatalog: async () => ({ list: async (t) => { calls.list.push(t); const r = lists[t]; if (r instanceof Error) throw r; return r ?? []; }, any: async () => any, download: async (i) => { calls.dl++; return dl(i); }, close() {} }) };
};

test("scaleOf: Scale130 -> 1.3, предел 3, нет — 1", () => {
  assert.equal(scaleOf("a/Draft_Horse_A1_Large_Scale200_Beast_01.webp"), 2);
  assert.equal(scaleOf("Wolf_Scale130_01.webp"), 1.3);
  assert.equal(scaleOf("Wolf_Scale999_01.webp"), 3);
  assert.equal(scaleOf("Wolf_A1_01.webp"), 1);
});

test("pickFile: стоп-слова отсеяны, /Creatures/ предпочтительнее", () => {
  assert.equal(pickFile(["x/Dragon_Skeleton_01.webp", "x/Dragon_Red_01.webp"], ["Dragon"]), "x/Dragon_Red_01.webp");
  assert.equal(pickFile(["x/Dragon_Skeleton_01.webp"], ["Dragon"]), null);
  assert.equal(pickFile(["x/Skeleton_Guard.webp"], ["Skeleton Guard"]), "x/Skeleton_Guard.webp");
  assert.equal(pickFile(["NPCs/Wolf_A.webp", "Creatures/Beast/Wolf_Scale120_B.webp"], ["Wolf"]), "Creatures/Beast/Wolf_Scale120_B.webp");
});

test("findToken: причины disabled / no-nexus / unverified", async () => {
  assert.deepEqual(await findToken(["Wolf"], { env: mkEnv({ enabled: false }) }), { reason: "disabled" });
  assert.deepEqual(await findToken(["Wolf"], { env: mkEnv({ state: "no-nexus" }) }), { reason: "no-nexus" });
  assert.deepEqual(await findToken(["Wolf"], { env: mkEnv({ state: "unverified" }) }), { reason: "unverified" });
});

test("findToken: локальный файл по любому имени списка, scale из имени; каталог не трогается", async () => {
  const env = mkEnv({ local: ["fa/Creatures/Wolf_Scale130_01.webp"] });
  assert.deepEqual(await findToken(["Gorilla", "Wolf"], { env }), { src: "fa/Creatures/Wolf_Scale130_01.webp", scale: 1.3 });
  assert.equal(env.calls.list.length, 0);
});

test("findToken: каталог — list по каждому имени, пока нет совпадения; скачанный файл -> {src, scale}", async () => {
  const env = mkEnv({ lists: { gorilla: [{ filename: "Orc_01.webp" }], ape: [{ filename: "Ape_Scale150_01.webp", file_path: "Creatures/Ape_Scale150_01.webp" }], wolf: [{ filename: "Wolf.webp" }] } });
  const r = await findToken(["Gorilla", "Ape", "Wolf"], { env });
  assert.deepEqual(r, { src: "fa-nexus-tokens/Ape_Scale150_01.webp", scale: 1.5 });
  assert.deepEqual(env.calls.list, ["gorilla", "ape"]);   // на «Wolf» не дошли
  assert.equal(env.calls.forget, 1);
});

test("findToken: not-found / catalog-empty / offline / download:false", async () => {
  assert.deepEqual(await findToken(["Cosmic"], { env: mkEnv({ any: true }) }), { reason: "not-found" });
  assert.deepEqual(await findToken(["Cosmic"], { env: mkEnv({ any: false }) }), { reason: "catalog-empty" });
  assert.deepEqual(await findToken(["Wolf"], { env: mkEnv({ lists: { wolf: new Error("net") } }) }), { reason: "offline" });
  assert.deepEqual(await findToken(["Wolf"], { env: mkEnv({ lists: { wolf: [{ filename: "Wolf.webp" }] }, dl: async () => null }) }), { reason: "offline" });
  const env = mkEnv({ lists: { wolf: [{ filename: "Wolf.webp" }] } });
  assert.deepEqual(await findToken(["Wolf"], { env, download: false }), { reason: "not-found" });
  assert.equal(env.calls.list.length, 0);
});

test("findToken: параллельные заявки на один файл качают его один раз", async () => {
  const env = mkEnv({ lists: { bear: [{ filename: "Bear_Once.webp", file_path: "Creatures/Bear_Once.webp" }] }, dl: () => new Promise((r) => setTimeout(() => r("fa/Bear_Once.webp"), 10)) });
  const rs = await Promise.all([findToken(["Bear"], { env }), findToken(["Bear"], { env }), findToken(["Black Bear", "Bear"], { env })]);
  assert.equal(env.calls.dl, 1);
  assert.ok(rs.every((r) => r.src === "fa/Bear_Once.webp"));
});

test("findToken: пустой список имён и не-ГМ", async () => {
  assert.deepEqual(await findToken([], { env: mkEnv() }), { reason: "not-found" });
  globalThis.game.user.isGM = false;
  assert.deepEqual(await findToken(["Wolf"], { env: mkEnv() }), { reason: "disabled" });
  globalThis.game.user.isGM = true;
});

test("каталог FA 0.6: запись без filename/file_path — ключ из id, подбор и превью находят", async () => {
  const { catKey, pickFile } = await import("../scripts/nexus-tokens.mjs");
  const ape = { id: "Creatures/Beast/Mammals/Ape_A1_Medium_Scale130_Beast_01", name: "Ape" };
  const skel = { id: "Creatures/Undead/Ape_Skeleton_A1_Medium_Undead_01", name: "Ape Skeleton" };
  assert.equal(catKey(ape), ape.id);
  assert.equal(pickFile([skel, ape], ["Ape"], catKey), ape);
});
