// Слепок группы «эффекты pf2e с правилом BattleForm» (plan-battleform-tokens.md §2) и отчёт «что скачать» по таблице rules/form-tokens.json.
//   node tools/form-tokens.mjs                      — слепок из паков pf2e (Foundry должен быть закрыт, LevelDB блокируется)
//   node tools/form-tokens.mjs --packs=<каталог>    — слепок из копии паков (<каталог>/<имя пака>, без LOCK)
//   node tools/form-tokens.mjs --check              — только отчёт по таблице (без паков): формы без имён
// Слепок: rules/form-tokens.snapshot.json (тест сверяет с ним таблицу; пересоздавать при смене версии pf2e).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { classicLevel, openPacks } from "./packs.mjs";
import { ROOT, readJson, writeJson, isMain, arg, cmp } from "./lib.mjs";

const EFFECT_PACKS = ["spell-effects", "feat-effects", "equipment-effects", "campaign-effects"];
export const SNAPSHOT = join(ROOT, "rules", "form-tokens.snapshot.json");
export const TABLE = join(ROOT, "rules", "form-tokens.json");

async function loadEffects(dir) {
  const docs = [];
  if (dir) {
    const CL = classicLevel();
    if (!CL) throw new Error("classic-level недоступен (FOUNDRY_NODE_MODULES)");
    for (const p of EFFECT_PACKS) {
      const db = new CL(join(dir, p), { keyEncoding: "utf8", valueEncoding: "utf8" });
      await db.open();
      for await (const [, v] of db.iterator({ gte: "!items!", lt: "!items!\xff" })) docs.push({ pack: p, d: JSON.parse(v) });
      await db.close();
    }
    return { docs, version: arg("pf2e-version") };   // копия паков: версия неизвестна, указывается явно
  }
  const src = await openPacks();
  for await (const { pack, docs: ds } of src.packs()) if (EFFECT_PACKS.includes(pack)) for (const d of ds) docs.push({ pack, d });
  return { docs, version: src.version };
}

/** Чистая: документы эффектов -> слепок. Вариант = значение ChoiceSet (у дракона — dragonType); BattleForm без выбора = одна форма. */
export function buildSnapshot(docs, version = null) {
  const bf = (d) => (d.system?.rules ?? []).filter((r) => r.key === "BattleForm");
  const byId = new Map(docs.map(({ d }) => [d._id, d.system?.slug]));
  const effects = docs.filter(({ d }) => bf(d).length).map(({ pack, d }) => {
    const rules = d.system.rules;
    const cs = rules.find((r) => r.key === "ChoiceSet" && Array.isArray(r.choices) && r.choices.length);
    const values = cs ? [...new Set(cs.choices.map((c) => (c.value && typeof c.value === "object" ? c.value.dragonType : c.value)))] : [];
    return {
      slug: d.system.slug, pack, battleForms: bf(d).length,
      ...(values.length ? { choiceFlag: cs.flag ?? null, choices: values } : {}),
      ...(bf(d).some((r) => r.predicate?.length) && !values.length ? { predicatedForms: true } : {})   // несколько BattleForm по предикату без ChoiceSet (Rampaging Form: наследие)
    };
  }).sort((a, b) => cmp(a.slug, b.slug));
  const wrappers = {};   // обёртки пака модуля: ChoiceSet с UUID дочерних эффектов pf2e
  const dir = join(ROOT, "packs/_source/effects");
  for (const f of readdirSync(dir).filter((x) => /^spell-effect-(animal|dinosaur)-form_/.test(x))) {
    const j = readJson(join(dir, f));
    const kids = (j.system.rules.find((r) => r.key === "ChoiceSet")?.choices ?? []).map((c) => byId.get(String(c.value).split(".").pop()) ?? null);
    wrappers[j.system.slug] = kids;
  }
  const variants = effects.reduce((n, e) => n + (e.choices?.length ?? 1), 0);
  return { pf2eVersion: version, effects: effects.length, variants, wrappers, list: effects };
}

/** Чистая: формы без имён и без пометки в таблице. Таблица: bySlug[slug] | byChoice[slug][value] = [имена] | {none} | {pick}. */
export function missingForms(snap, table) {
  const ok = (v) => (Array.isArray(v) && v.length && v.every((s) => typeof s === "string" && s.trim())) || (v && typeof v === "object" && !Array.isArray(v) && (v.none || v.pick?.length));
  const out = [];
  for (const e of snap.list) {
    if (e.choices) for (const c of e.choices) { if (!ok(table.byChoice?.[e.slug]?.[c])) out.push(`${e.slug}:${c}`); }
    else if (!ok(table.bySlug?.[e.slug])) out.push(e.slug);
  }
  return out;
}

if (isMain(import.meta.url)) {
  if (arg("check")) {
    const miss = missingForms(readJson(SNAPSHOT), readJson(TABLE));
    console.log(miss.length ? `без имён: ${miss.join(", ")}` : "таблица покрывает слепок");
  } else {
    const { docs, version } = await loadEffects(arg("packs"));
    const snap = buildSnapshot(docs, version);
    writeJson(SNAPSHOT, snap, 1);
    console.log(`эффектов ${snap.effects}, форм (эффект x вариант) ${snap.variants} -> ${SNAPSHOT}`);
  }
}
