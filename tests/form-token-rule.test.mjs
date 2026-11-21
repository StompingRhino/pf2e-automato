// Токен боевой формы (scripts/form-token.mjs): чистые части и подмешивание правила TokenImage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MOD = "pf2e-automato";
let enabled = true;
globalThis.game = { user: { isGM: true }, settings: { get: () => enabled }, i18n: { localize: (k) => k, format: (k) => k }, pf2e: { RuleElements: { all: {} } } };
globalThis.ui = { notifications: { warn() {} } };

const ft = await import("../scripts/form-token.mjs");
const { wrapRules } = await import("../scripts/builtin/neutralize-rules.mjs");
const table = JSON.parse(readFileSync(new URL("../rules/form-tokens.json", import.meta.url), "utf8"));

const bf = (ignored = false) => ({ key: "BattleForm", ignored });
const effect = (slug, extra = {}) => ({ type: "effect", slug, system: { rules: [{ key: "BattleForm" }] }, flags: {}, ...extra });

test("действующая форма: хотя бы один BattleForm не ignored (devil-form: 4 формы, выбрана одна)", () => {
  assert.equal(ft.activeForm([bf(true), bf(true), bf(false), bf(true), { key: "ChoiceSet" }]), true);
  assert.equal(ft.activeForm([bf(true), bf(true)]), false);
  assert.equal(ft.activeForm([{ key: "ChoiceSet" }]), false);
});

test("имена: devil-form + vordine, ape, дракон по dragonType, Pest Form -> pick, нет записи -> из slug", () => {
  const devil = effect("spell-effect-devil-form", { flags: { pf2e: { rulesSelections: { devilForm: "vordine" } } } });
  assert.deepEqual(ft.entryOf(devil, table), { names: ["Vordine", "Devil"] });
  assert.equal(ft.entryOf(effect("spell-effect-devil-form"), table), null);   // выбор ещё не сделан
  assert.deepEqual(ft.entryOf(effect("spell-effect-animal-form-ape"), table).names.slice(0, 2), ["Gorilla", "Ape"]);
  const dragon = effect("spell-effect-dragon-form", { flags: { pf2e: { rulesSelections: { dragonForm: { dragonType: "forest" } } } } });
  assert.deepEqual(ft.entryOf(dragon, table).names.at(-1), "Dragon");
  assert.ok(ft.entryOf(effect("spell-effect-pest-form"), table).pick.includes("Raven"));
  assert.deepEqual(ft.entryOf(effect("spell-effect-devil-form-barbazu"), {}).names, ["Barbazu", "Devil Barbazu"]);
  assert.deepEqual(ft.entryOf(effect("spell-effect-new-thing-form"), {}), { names: ["New Thing"] });
});

test("флаг: {none} только при not-found, сбой окружения не пишет ничего", () => {
  assert.deepEqual(ft.flagFor({ src: "a/B.webp", scale: 1.3 }), { src: "a/B.webp", scale: 1.3 });
  assert.deepEqual(ft.flagFor({ reason: "not-found" }), { none: true });
  for (const reason of ["disabled", "no-nexus", "unverified", "catalog-empty", "offline"]) assert.equal(ft.flagFor({ reason }), null);
});

test("tokenOf: выбор игрока и кеш; {none} и {declined} дают null", () => {
  const item = { slug: "spell-effect-pest-form", flags: { [MOD]: { formToken: { none: true } } } };
  assert.equal(ft.tokenOf(item, { flags: { [MOD]: { formChoice: { "spell-effect-pest-form": { declined: true } } } } }), null);
  assert.equal(ft.tokenOf(item, { flags: { [MOD]: { formChoice: { "spell-effect-pest-form": { src: "x.webp", scale: 1 } } } } }).src, "x.webp");
  assert.equal(ft.tokenOf({ flags: { [MOD]: { formToken: { src: "y.webp" } } } }, {}).src, "y.webp");
});

test("кольцо: без ring.subject.texture не трогаем; с текстурой — тот же файл, scale 1", () => {
  const f = { src: "a.webp", scale: 1.3 };
  assert.deepEqual(ft.formRuleSource(f, { enabled: true, subject: { texture: "" } }), { key: "TokenImage", value: "a.webp", scale: 1.3 });
  assert.deepEqual(ft.formRuleSource(f, { enabled: false }), { key: "TokenImage", value: "a.webp", scale: 1.3 });
  assert.deepEqual(ft.formRuleSource(f, { enabled: true, subject: { texture: "r.webp" } }).ring, { subject: { texture: "a.webp", scale: 1 } });
  assert.equal(ft.formRuleSource(f, null, false), null);
  assert.equal(ft.formRuleSource({ none: true }, null), null);
});

// фейковый TokenImage: фиксирует исходник и вызов afterPrepareData
class FakeTokenImage { constructor(src, o) { this.src = src; this.o = o; this.ignored = false; } afterPrepareData() { return this.ignored ? "off" : "on"; } }
const run = ({ flags, own = false, actorFlags = {}, ignored = [false] }) => {
  game.pf2e.RuleElements.all.TokenImage = FakeTokenImage;
  const item = { type: "effect", slug: "spell-effect-devil-form", id: "e1", flags, system: { rules: [{ key: "BattleForm" }] } };
  const actor = { flags: actorFlags, prototypeToken: {}, _source: { items: own ? [{ _id: "o", system: { rules: [{ key: "TokenImage" }] } }] : [] } };
  item.actor = actor;
  const rules = ignored.map(bf);
  return wrapRules(() => rules, { parent: item });
};

test("wrapRules: флаг -> правило добавлено; нет флага/none/выкл/свой TokenImage -> нет", () => {
  enabled = true;
  const withFlag = { [MOD]: { formToken: { src: "a.webp", scale: 1 } } };
  const r = run({ flags: withFlag });
  assert.equal(r.length, 2);
  assert.equal(r[1].src.value, "a.webp");
  assert.equal(r[1].afterPrepareData(), "on");
  assert.equal(run({ flags: {} }).length, 1);
  assert.equal(run({ flags: { [MOD]: { formToken: { none: true } } } }).length, 1);
  assert.equal(run({ flags: withFlag, own: true }).length, 1);
  enabled = false;
  assert.equal(run({ flags: withFlag }).length, 1);
  enabled = true;
});

test("wrapRules: все BattleForm ignored -> правило гаснет в afterPrepareData", () => {
  const r = run({ flags: { [MOD]: { formToken: { src: "a.webp" } } }, ignored: [true, true] });
  assert.equal(r.at(-1).afterPrepareData(), "off");
  const ok = run({ flags: { [MOD]: { formToken: { src: "a.webp" } } }, ignored: [true, false, true] });
  assert.equal(ok.at(-1).afterPrepareData(), "on");
});
