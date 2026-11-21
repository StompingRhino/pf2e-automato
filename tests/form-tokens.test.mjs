// Таблица имён токенов для форм pf2e (rules/form-tokens.json) против слепка группы BattleForm (tools/form-tokens.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot, missingForms } from "../tools/form-tokens.mjs";
import { scoreName } from "../scripts/nexus-tokens.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const snap = read("../rules/form-tokens.snapshot.json");
const table = read("../rules/form-tokens.json");
const bySlug = Object.fromEntries(snap.list.map((e) => [e.slug, e]));
const forms = snap.list.flatMap((e) => (e.choices ?? [null]).map((c) => ({ e, c, v: c === null ? table.bySlug[e.slug] : table.byChoice[e.slug]?.[c] })));

test("слепок: 63 эффекта, 147 форм (эффект x вариант)", () => {
  assert.equal(snap.effects, 63);
  assert.equal(snap.list.length, 63);
  assert.equal(snap.variants, 147);
  const withChoice = snap.list.filter((e) => e.choices);
  assert.equal(withChoice.length, 17);
  assert.equal(withChoice.reduce((n, e) => n + e.choices.length, 0), 101);
  assert.equal(snap.list.length - withChoice.length, 46);
  assert.equal(snap.list.filter((e) => e.battleForms > 1 && !e.choices).map((e) => e.slug).join(), "effect-rampaging-form");   // две BattleForm по наследию, не по выбору
});

test("слепок: devil-form -> четыре варианта, dragon-form -> 40, форма с предикатом на выбор", () => {
  assert.deepEqual(bySlug["spell-effect-devil-form"].choices, ["coarti", "levaloch", "sarglagon", "vordine"]);
  assert.equal(bySlug["spell-effect-devil-form"].battleForms, 4);
  assert.equal(bySlug["spell-effect-dragon-form"].choices.length, 40);
  assert.ok(bySlug["spell-effect-dragon-form"].choices.includes("forest"));
  assert.equal(bySlug["spell-effect-demon-form"].battleForms, 2);   // kithangian — отдельный BattleForm (Large)
  assert.equal(bySlug["spell-effect-monstrosity-form"].choices.length, 3);   // phoenix в ChoiceSet дважды (предикаты), считается один раз
});

test("слепок: обёртки модуля ссылаются на эффекты pf2e из группы", () => {
  assert.equal(snap.wrappers["spell-effect-animal-form"].length, 9);
  assert.equal(snap.wrappers["spell-effect-dinosaur-form"].length, 6);
  for (const kids of Object.values(snap.wrappers)) for (const k of kids) assert.ok(bySlug[k], `нет в слепке: ${k}`);
});

test("таблица покрывает всю группу: имена или пометка none/pick у каждой формы", () => {
  assert.deepEqual(missingForms(snap, table), []);
  assert.equal(forms.length, 147);
});

test("таблица без устаревших ключей: каждый ключ — в слепке, варианты совпадают", () => {
  for (const s of Object.keys(table.bySlug)) assert.ok(bySlug[s] && !bySlug[s].choices, `лишний bySlug: ${s}`);
  for (const [s, o] of Object.entries(table.byChoice)) {
    assert.ok(bySlug[s]?.choices, `лишний byChoice: ${s}`);
    assert.deepEqual(Object.keys(o).sort(), [...bySlug[s].choices].sort(), s);
  }
});

test("missingForms видит дыру", () => {
  assert.deepEqual(missingForms(snap, { bySlug: {}, byChoice: {} }).length, 147);
  assert.deepEqual(missingForms({ list: [{ slug: "x", choices: ["a", "b"] }] }, { byChoice: { x: { a: ["A"], b: [] } } }), ["x:b"]);
});

test("имена — латиница, с словом от 3 букв (иначе scoreName вернёт 0), без повторов", () => {
  for (const { e, c, v } of forms) {
    if (!Array.isArray(v)) continue;
    assert.equal(new Set(v).size, v.length, `${e.slug}:${c} повтор`);
    for (const n of v) {
      assert.match(n, /^[A-Za-z' -]+$/, `${e.slug}:${c} «${n}»`);
      assert.ok(n.split(/[^A-Za-z]+/).some((w) => w.length >= 3), `${e.slug}:${c} «${n}» без слова от 3 букв`);
    }
  }
});

test("явные пометки: none — с причиной, pick — список кандидатов (Pest Form выбирает игрок)", () => {
  const none = forms.filter(({ v }) => v?.none).map(({ e, c }) => `${e.slug}${c ? ":" + c : ""}`);
  assert.deepEqual(none, ["spell-effect-cosmic-form:moon", "spell-effect-cosmic-form:sun", "spell-effect-sacred-form"]);
  assert.ok(forms.filter(({ v }) => v?.none).every(({ v }) => v.none.length > 10));
  const pest = table.bySlug["spell-effect-pest-form"];
  assert.ok(pest.pick.length >= 8 && pest.pick.includes("Cat") && pest.note);
});

test("примеры: ape -> Gorilla, devil-form + vordine -> Vordine, дракон -> цвет, затем общий Dragon", () => {
  assert.equal(table.bySlug["spell-effect-animal-form-ape"][0], "Gorilla");
  assert.deepEqual(table.byChoice["spell-effect-devil-form"].vordine, ["Vordine", "Devil"]);
  const d = table.byChoice["spell-effect-dragon-form"];
  assert.deepEqual(d.forest, ["Green Dragon", "Dragon"]);
  for (const v of Object.values(d)) { assert.equal(v.length, 2); assert.match(v[0], /^(Amethyst|Black|Blue|Brass|Bronze|Copper|Gold|Green|Red|Silver|Twilight|White) Dragon$/); assert.equal(v[1], "Dragon"); }
});

test("имена попадают в файлы FA по scoreName (фикстура из скачанного набора)", () => {
  const files = ["Wolf_A1_Medium_Beast_01.webp", "Adult_Green_Dragon_A1_Huge_Scale233_Dragon_01.webp", "Pseudodragon_A1_Tiny_Dragon_01.webp", "Raven_A1_Tiny_Beast_01.webp"];
  const hit = (name) => files.some((f) => scoreName(f, name) >= 2);
  assert.ok(hit(table.bySlug["spell-effect-animal-form-canine"][0]));
  assert.ok(hit(table.byChoice["spell-effect-dragon-form"].forest[0]));
  assert.ok(hit("Dragon"));   // общий «Dragon» цепляет и Pseudodragon_..._Dragon_01 (тип в имени файла): только запасной, ранжирование — за подбором (F2)
  assert.ok(hit("Raven"));
});

test("buildSnapshot: считает варианты и предикатные формы без ChoiceSet", () => {
  const mk = (slug, rules) => ({ pack: "p", d: { _id: slug, system: { slug, rules } } });
  const s = buildSnapshot([
    mk("a", [{ key: "BattleForm" }]),
    mk("b", [{ key: "ChoiceSet", flag: "f", choices: [{ value: "x" }, { value: "y" }, { value: "y" }] }, { key: "BattleForm", predicate: ["b:x"] }, { key: "BattleForm", predicate: ["b:y"] }]),
    mk("c", [{ key: "BattleForm", predicate: ["h"] }, { key: "BattleForm", predicate: [{ not: "h" }] }]),
    mk("d", [{ key: "Other" }])
  ]);
  assert.deepEqual([s.effects, s.variants], [3, 4]);
  assert.deepEqual(s.list.map((e) => e.choices ?? null), [null, ["x", "y"], null]);
  assert.equal(s.list[2].predicatedForms, true);
});
