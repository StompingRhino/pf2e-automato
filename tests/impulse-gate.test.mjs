import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.game ??= {};
const { reasonOf, channelPending, roundKey, isUseCard } = await import("../scripts/builtin/impulse-gate.mjs");

test("reasonOf: импульс без ауры; второе переполнение в том же раунде; не импульс — не трогаем", () => {
  const imp = ["impulse", "fire"], ovf = ["impulse", "overflow"];
  assert.equal(reasonOf({ traits: imp, aura: false }), "noAura");
  assert.equal(reasonOf({ traits: ["attack"], aura: false }), null);
  assert.equal(reasonOf({ traits: imp, aura: true, overflowRound: "c:1", round: "c:1" }), null);
  assert.equal(reasonOf({ traits: ovf, aura: true, overflowRound: "c:1", round: "c:1" }), "overflow");
  assert.equal(reasonOf({ traits: ovf, aura: true, overflowRound: "c:1", round: "c:2" }), null);
  assert.equal(reasonOf({ traits: ovf, aura: true, overflowRound: "c:1", round: null }), null);   // вне боя «за раунд» нет
});

test("channelPending: свежая карточка Channel Elements даёт ауру, переполнение после неё — гасит, чужие сообщения не в счёт", () => {
  const msg = (actor, slug, traits = [], type) => ({ speaker: { actor }, item: { slug, system: { traits: { value: traits } } }, flags: { pf2e: { context: type ? { type } : undefined } } });
  const ch = msg("a", "channel-elements"), col = msg("a", "scorching-column", ["impulse", "overflow"]), other = msg("b", "x", ["impulse", "overflow"]);
  assert.equal(channelPending([ch], "a"), true);
  assert.equal(channelPending([ch, other], "a"), true);
  assert.equal(channelPending([ch, col], "a"), false);
  assert.equal(channelPending([col, ch], "a"), true);
  assert.equal(channelPending([ch, msg("a", "scorching-column", ["impulse", "overflow"], "damage-roll")], "a"), true);   // бросок урона — не использование
  assert.equal(channelPending([], "a"), false);
});

test("roundKey: только начатый бой", () => {
  assert.equal(roundKey({ started: true, id: "c", round: 2, turn: 3 }), "c:2");
  assert.equal(roundKey({ started: false, id: "c", round: 0 }), null);
  assert.equal(roundKey(null), null);
});

test("isUseCard: карточка использования — с CAST у заклинаний; «в чат» без сотворения и броски — нет", () => {
  const card = (item, type, rollOptions) => ({ actor: {}, item, flags: { pf2e: { context: type ? { type } : undefined, origin: { rollOptions } } } });
  const act = { type: "action" }, spell = { type: "spell" };
  assert.equal(isUseCard(card(act)), true);
  assert.equal(isUseCard(card({ type: "feat" }, "self-effect")), true);
  assert.equal(isUseCard(card(spell, "spell-cast", ["origin:action:slug:cast-a-spell"])), true);
  assert.equal(isUseCard(card(spell, "spell-cast", ["origin:item:type:spell"])), false, "карточка заклинания в чат без сотворения");
  assert.equal(isUseCard(card(act, "damage-roll")), false);
  assert.equal(isUseCard(card({ type: "equipment" })), false);
  assert.equal(isUseCard({ ...card(act), item: null }), false);
  assert.equal(isUseCard({ ...card(act), actor: null }), false);
});

const { LIMITS, marksFor, clearFor, fqStale } = await import("../scripts/builtin/impulse-gate.mjs");
const now = { time: 1000, combat: "c", round: 2 }, row = (r) => LIMITS.find((l) => l.reason === r);

test("flourish: второе действие с чертой в том же раунде — блок; другой раунд, вне боя, без черты — нет; отметка раунда", () => {
  const c = { traits: ["flourish", "fighter"], round: "c:3", flourishRound: "c:3" };
  assert.equal(reasonOf(c), "flourish");
  assert.equal(reasonOf({ ...c, round: "c:4" }), null);
  assert.equal(reasonOf({ ...c, round: null }), null);
  assert.equal(reasonOf({ ...c, traits: ["fighter"] }), null);
  assert.deepEqual(marksFor({ traits: ["flourish"], round: "c:3" }), { flourishRound: "c:3" });
  assert.deepEqual(marksFor({ traits: ["flourish"], round: null }), {});
});

test("ярость: импульс/concentrate без rage — блок; своя стихия, rage-черта, clarity, Raging Intimidation — нет; paRage — молчит", () => {
  const c = { raging: true, traits: ["impulse", "air"], slug: "x", kinetic: false, instinctEls: ["earth"] };
  assert.equal(reasonOf(c), "rage");
  assert.equal(reasonOf({ ...c, traits: ["impulse", "earth"] }), null);
  assert.equal(reasonOf({ ...c, traits: ["impulse", "earth", "concentrate"] }), null);
  assert.equal(reasonOf({ ...c, traits: ["impulse"] }), null);   // стихия неизвестна — не блок
  assert.equal(reasonOf({ ...c, traits: ["concentrate"] }), "rage");
  assert.equal(reasonOf({ ...c, traits: ["concentrate", "rage"], actorType: "character" }), null);
  assert.equal(reasonOf({ ...c, traits: ["concentrate"], clarity: true }), null);
  assert.equal(reasonOf({ ...c, traits: ["concentrate"], slug: "demoralize", rageSlugs: ["demoralize"] }), null);
  assert.equal(reasonOf({ ...c, traits: ["concentrate"], repertoire: true }), null);
  assert.equal(reasonOf({ ...c, traits: ["concentrate"], paRage: true }), null);
  assert.equal(reasonOf({ ...c, raging: false, traits: ["concentrate"] }), null);
});

test("Moment of Clarity: метка до конца хода (в бою) или на 6 с (вне боя); сама не блокируется", () => {
  const c = { traits: ["rage"], slug: "moment-of-clarity", now, raging: true, actorType: "character" };
  assert.equal(reasonOf(c), null);
  assert.deepEqual(marksFor({ ...c, turn: "c:1:0" }), { clarityUntil: "c:1:0" });
  assert.deepEqual(marksFor({ ...c, turn: null }), { clarityUntil: 1006 });
});

test("rageTrait: черта rage — только в ярости; только персонажи; начало ярости не требует ярости", () => {
  const c = { traits: ["rage"], slug: "x", actorType: "character", raging: false };
  assert.equal(reasonOf(c), "rageTrait");
  assert.equal(reasonOf({ ...c, raging: true }), null);
  assert.equal(reasonOf({ ...c, actorType: "npc" }), null);
  assert.equal(reasonOf({ ...c, slug: "quick-tempered" }), null);
  assert.equal(reasonOf({ ...c, paRage: true }), null);
});

test("inSpace: false — блок; null/true — нет; другой slug и не фамильяр — не трогаем", () => {
  const c = { traits: [], slug: "restorative-familiar", actorType: "familiar", inSpace: false };
  assert.equal(reasonOf(c), "inSpace");
  assert.equal(reasonOf({ ...c, inSpace: null }), null);
  assert.equal(reasonOf({ ...c, inSpace: true }), null);
  assert.equal(reasonOf({ ...c, slug: "other" }), null);
  assert.equal(reasonOf({ ...c, actorType: "character" }), null);
});

test("twoHands: две цели при одной свободной руке — блок; одна цель, две руки, нет данных (NPC) — нет", () => {
  const c = { traits: [], slug: "slashing-gust", targetCount: 2, handsFree: 1 };
  assert.equal(reasonOf(c), "twoHands");
  assert.equal(reasonOf({ ...c, targetCount: 1 }), null);
  assert.equal(reasonOf({ ...c, handsFree: 2 }), null);
  assert.equal(reasonOf({ ...c, handsFree: undefined }), null);
});

test("freqText: второй раз в день — блок; окно rounds вне боя и NPC «в день» — нет; отметка копит журнал, clearFor возвращает прежний счётчик", () => {
  const fq = { value: 1, unit: "days" }, used = { at: { time: 0, combat: null, round: 0 }, log: ["a"] };
  const c = { traits: [], itemId: "I1", freqText: fq, tracks: true, inCombat: false, now, freqSlot: used };
  assert.equal(reasonOf(c), "freqText");
  assert.equal(reasonOf({ ...c, freqSlot: undefined }), null);
  assert.equal(reasonOf({ ...c, tracks: false }), null);
  assert.equal(reasonOf({ ...c, freqText: { value: 1, unit: "rounds" }, freqSlot: { at: now, log: ["a"] } }), null);   // вне боя
  assert.equal(reasonOf({ ...c, inCombat: true, freqText: { value: 1, unit: "rounds" }, freqSlot: { at: now, log: ["a"] } }), "freqText");
  assert.equal(reasonOf({ ...c, freqText: { ...fq, uses: 2 } }), null);
  const m = marksFor({ ...c, freqSlot: undefined });
  assert.deepEqual(m.fq_I1.at, now);
  assert.equal(m.fq_I1.log.length, 1);
  assert.deepEqual(clearFor({ rcLocks: { fq_I1: used } }, { fq_I1: {} }), { fq_I1: used });
  assert.deepEqual(clearFor({ rcLocks: {} }, { fq_I1: {} }), {});
});

test("fqStale: отдых снимает счётчики, кроме «раз в N дней»", () => {
  const flags = { fq_a: {}, fq_b: {}, hexTurn: "x" };
  assert.deepEqual(fqStale(flags, (id) => id === "b"), ["fq_a"]);
  assert.deepEqual(fqStale(undefined, () => false), []);
});

test("таблица: порядок причин — rage перед overflow; ключи lang существуют для каждой строки", async () => {
  const { readFileSync } = await import("node:fs");
  for (const l of ["ru", "en"]) {
    const t = JSON.parse(readFileSync(new URL(`../lang/${l}/builtin.json`, import.meta.url), "utf8")).PF2E_AUTOMATO.builtin.limit;
    for (const r of LIMITS) if (r.reason !== "clarity") assert.ok(t[r.reason], `${l}: limit.${r.reason}`);
  }
  const names = LIMITS.map((x) => x.reason);
  assert.ok(names.indexOf("rage") < names.indexOf("overflow"));
});
