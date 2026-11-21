// Заклинания с Поддержанием (duration «sustained…»), у которых собранное правило ставит эффект/состояние, но ни один шаг не имеет sustain:true (docs: plan-rustyspirit-gaps §4).
// Отчёт без правок каталогов. Запуск: node tools/sustain-gaps.mjs [--check]; --check падает, если запись из SUSTAIN_A осталась без sustain.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

globalThis.game ??= { user: { isActiveGM: true }, settings: { get: () => "auto" }, i18n: { localize: (k) => k, format: (k) => k }, pf2e: { ConditionManager: { conditions: new Map() } } };
globalThis.ui ??= { notifications: { warn() {} } };
const { buildCatalog } = await import("../scripts/rules.mjs");

const root = fileURLToPath(new URL("..", import.meta.url));
const load = (p) => JSON.parse(readFileSync(root + p, "utf8"));

/** Ставим sustain:true (31 из 32 плана + 2 из B). */
export const SUSTAIN_A = ["figment", "leaden-steps", "beastmaster-trance", "clawsong", "dancing-shield", "mirror-malefactors", "protectors-sphere", "unravel-knowledge", "ghostly-shift", "interstellar-void", "lightning-lasso", "gloom-mantle", "veil-of-dreams", "competitive-edge", "domoras-defense", "confront-selves", "stumbling-curse", "word-of-truth", "calm", "grasping-vine", "blood-ward", "elemental-betrayal", "roses-thorns", "hymn-of-healing", "rainbows-end", "fiendish-rift", "laughing-fit", "ancestral-form", "tempest-form", "hideous-laughter", "calm-emotions",
  "unexpected-windfall", "frost-pillar"];   // последние два — из списка B плана: по тексту состояние держится «на время заклинания»
/** Разобраны по тексту; записи не меняем (причины — в отчёте куска К3). */
// Решения: mycological-malady (болезнь не привязывается, на успехе 1 раунд),
// mind-games / fallen-soldiers-lament / ancestral-winds (состояние без срока, убывает само), cyclone-rondo (prone мгновенно), invoke-spirits (fleeing 1 раунд), buzzing-bites (своя схема onEvent) — не меняем.
export const SUSTAIN_B = ["mycological-malady", "mind-games", "cyclone-rondo", "fallen-soldiers-lament", "ancestral-winds", "invoke-spirits", "buzzing-bites"];

/** Есть ли в правиле шаг effect/condition (hasStep) и шаг с sustain:true (hasSustain). Обход всего дерева. */
export function stepsOf(rule) {
  const r = { hasStep: false, hasSustain: false };
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    if (o.effect != null || o.condition != null) { r.hasStep = true; if (o.sustain === true) r.hasSustain = true; }
    Object.values(o).forEach(walk);
  })(rule);
  return r;
}

export function loadMerged() {
  const files = ["catalog.pa.json", "catalog.strike-save.json", "catalog.model.json", "catalog.onhit.json", "catalog.rusthenge.json", "catalog.counterspell.json", "catalog.json"];
  return buildCatalog(files.filter((f) => existsSync(root + "rules/" + f)).map((f) => load("rules/" + f)));
}

/** [{uuid, slug, name, hasStep, hasSustain}] по документам с «sustained». */
export function report() {
  const cat = loadMerged();
  const items = load("tools/out/items.json").items;
  const out = [];
  for (const it of items) {
    if (it.type !== "spell" || !/^sustained/i.test(it.duration ?? "")) continue;
    const rule = cat.bySource.get(it.uuid) ?? cat.bySlug.get(it.slug);
    if (rule) out.push({ uuid: it.uuid, slug: it.slug, name: it.name, ...stepsOf(rule) });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = report();
  const gaps = rows.filter((r) => r.hasStep && !r.hasSustain);
  const slugs = (a) => [...new Set(a.map((r) => r.slug))];
  const todoA = slugs(gaps).filter((s) => SUSTAIN_A.includes(s)), rest = slugs(gaps).filter((s) => !SUSTAIN_A.includes(s) && !SUSTAIN_B.includes(s));
  console.log(`Поддерживаемых с правилом: ${rows.length}; эффект/состояние без sustain: ${gaps.length} док., ${slugs(gaps).length} имён`);
  console.log(`A без sustain: ${todoA.length} ${todoA.join(" ")}`);
  console.log(`B (по тексту, не меняем): ${slugs(gaps).filter((s) => SUSTAIN_B.includes(s)).join(" ")}`);
  console.log(`прочие: ${rest.length} ${rest.join(" ")}`);
  if (process.argv.includes("--check") && todoA.length) { console.error("FAIL: записи списка A без sustain"); process.exit(1); }
}
