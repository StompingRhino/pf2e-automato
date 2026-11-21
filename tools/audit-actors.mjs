// Выгрузка покрытия автоматизацией по героям игроков мира (сырьё для аудита): все встроенные предметы -> правило модуля / встроенный обработчик / RE pf2e / долг + предразметка.
// Запуск: node tools/audit-actors.mjs --world rustyspirit [--out tools/out/audit-rustyspirit.json]. Foundry должен быть выключен (LevelDB). Тот же resolveRule, что в рантайме.
import { join } from "node:path";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { ROOT, DATA, readJson, readOut, writeJson, outPath, arg, stripHtml } from "./lib.mjs";
import { classicLevel } from "./packs.mjs";
import { initCatalog, resolveRule, slugOf, slugTypeKey } from "../scripts/rules.mjs";
import { readModelAccepted } from "./drafts.mjs";
import { debtByMechanism, isDebt } from "./mechanisms.mjs";

const world = arg("world", "rustyspirit");
const W = arg("data", null) ?? join(DATA, "worlds", world, "data");   // --data <dir>: копия actors/folders/users (при запущенном Foundry база мира заблокирована)
const LAYERS = ["pa", "strike-save", "model", "onhit", "rusthenge", "counterspell", "cat"];   // порядок loadCatalog: при совпадении ключа побеждает последний
const TEST_NAME = /^(Тест|AF тест)\s*:|\(копия\)/i;

async function rd(name, key, extra = {}) {
  const CL = classicLevel();
  const db = new CL(join(W, name), { keyEncoding: "utf8", valueEncoding: "utf8" });
  await db.open();
  const out = [];
  for await (const [k, v] of db.iterator({ gte: key, lt: key + "\xff" })) out.push(extra.keys ? [k, JSON.parse(v)] : JSON.parse(v));
  await db.close();
  return out;
}

// ---- мир: актёры
const users = await rd("users", "!users!"), folders = new Map((await rd("folders", "!folders!")).map((f) => [f._id, f]));
const players = new Set(users.filter((u) => u.role < 3).map((u) => u._id));   // не ГМ/помощник
const actorsAll = await rd("actors", "!actors!");
const embedded = new Map();
for (const [k, v] of await rd("actors", "!actors.items!", { keys: true })) {
  const [aid, iid] = k.slice("!actors.items!".length).split(".");
  (embedded.get(aid) ?? embedded.set(aid, []).get(aid)).push(v);
}
const inTestFolder = (a) => { for (let f = folders.get(a.folder); f; f = folders.get(f.folder)) if (/Тестовые копии/.test(f.name)) return true; return false; };
const isTest = (a) => TEST_NAME.test(a.name) || inTestFolder(a);
const heroes = actorsAll.filter((a) => a.type === "character" && !isTest(a) && Object.entries(a.ownership ?? {}).some(([u, l]) => players.has(u) && l >= 3));
const heroIds = new Set(heroes.map((a) => a._id));
const companions = actorsAll.filter((a) => !isTest(a) && ["familiar", "npc"].includes(a.type) && heroIds.has(a.system?.master?.id));
const actors = [...heroes, ...companions];

// ---- каталоги, как в runtime (tools/copy-guard-report.mjs)
const { items: srcItems } = readOut("items.json"), refs = readOut("refs.json");
const cats = LAYERS.map((l) => readJson(join(ROOT, "rules", l === "cat" ? "catalog.json" : `catalog.${l}.json`)));
initCatalog(cats.filter(Boolean), readJson(join(ROOT, "rules/labels.json")));
globalThis.game = { pf2e: { ConditionManager: { conditions: new Map(Object.entries(refs.conditions).map(([s, c]) => [`Compendium.pf2e.conditionitems.Item.${c.id}`, { slug: s }])) } } };
const layerOf = (key, slug, type) => {
  const hit = (f) => LAYERS.filter((_, i) => f(cats[i])).at(-1);
  return (key && hit((c) => c.bySource?.[key])) || (slug && hit((c) => c.bySlug?.[slugTypeKey(slug, type)] ?? (type !== "campaignFeature" && c.bySlug?.[slug]))) || null;
};
const byUuid = new Map(srcItems.map((i) => [i.uuid, i]));

// ---- встроенные обработчики: литералы-слаги в scripts/builtin/* (грубо: совпадение строки, не доказательство привязки)
const builtinSlugs = new Map();
const bdir = join(ROOT, "scripts/builtin");
for (const f of readdirSync(bdir).filter((x) => x.endsWith(".mjs"))) {
  for (const m of readFileSync(join(bdir, f), "utf8").matchAll(/["'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)["'`]/g)) (builtinSlugs.get(m[1]) ?? builtinSlugs.set(m[1], new Set()).get(m[1])).add(f.replace(".mjs", ""));
}

// ---- долг
const accepted = readModelAccepted();
const debtMech = debtByMechanism(accepted, srcItems).byUuid;
const debtRec = new Map(accepted.filter(isDebt).map((d) => [d.uuid, d]));

// ---- прошлые аудиты: строка таблицы с первым столбцом = slug/имя либо id источника в строке
const PRIOR_FILES = ["plan-rustyspirit.md", "audit-builds-l1.md", "audit-rogue-r4.md", "level1-animist-tasks.md", "level1-rogue-tasks.md", "level1-witch-tasks.md", "level1-review.md"];
const priorLines = PRIOR_FILES.filter((f) => existsSync(join(ROOT, "docs", f))).map((f) => [f, readFileSync(join(ROOT, "docs", f), "utf8").split("\n").filter((l) => l.startsWith("|"))]);
const priorOf = (slug, name, srcId) => {
  const id = srcId?.split(".").pop(), out = [];
  for (const [f, lines] of priorLines) for (const l of lines) {
    const cells = l.split("|").map((c) => c.trim()), first = cells[1]?.replace(/`/g, "");
    if ((slug && first === slug) || first === name || (id && id.length >= 12 && l.includes(id))) { out.push({ file: `docs/${f}`, verdict: (cells.filter(Boolean).at(-1) ?? "").replace(/`/g, "").slice(0, 160) }); break; }
  }
  return out;
};

// ---- признаки механики в тексте
const SIGNS = {
  check: /@Check\[|\bDC \d|\bsaving throw|\b(Fortitude|Reflex|Will) (save|DC)|attack roll|\bcheck\b/i,
  damage: /@Damage\[|\bdamage\b|\d+d\d+/i,
  effect: /@UUID\[[^\]]*(effect|condition)|@Template\[|\b(blinded|clumsy|confused|dazzled|deafened|doomed|drained|dying|enfeebled|fascinated|fatigued|fleeing|frightened|grabbed|immobilized|off-guard|paralyzed|persistent|petrified|prone|quickened|restrained|sickened|slowed|stunned|stupefied|unconscious|wounded|concealed|hidden|invisible|undetected)\b/i,
  limit: /\b(Trigger|Requirements?|Frequency)\b|once (per|each|a|every)|per (day|round|turn|hour)|\bcan't\b|\bonly if\b|\bmust\b/i,
  bonus: /\b(bonus|penalty) to\b|\bgain(s)? (a|an|the)? ?(\+|resist|temporary|fast healing|\d)|\bresistance\b|\bweakness\b|\bimmun/i,
  action: /\[\[\/act /i
};
const BASE_GEAR = new Set(["ammo", "weapon", "armor", "shield", "backpack", "treasure", "equipment"]);   // без свойств-рун и без текста с признаками механикой занимается pf2e
const NO_MECH_TYPES = new Set(["ancestry", "background", "class", "heritage", "deity", "lore", "kit", "spellcastingEntry", "ancestryFeature", "action", "feat", "effect", "condition"]);

const rows = [];
for (const a of actors) {
  const items = embedded.get(a._id) ?? [];
  for (const it of items) {
    const sys = it.system ?? {}, html = sys.description?.value ?? "";
    const sourceId = it._stats?.compendiumSource ?? it.flags?.core?.sourceId ?? null;
    const doc = { uuid: `Actor.${a._id}.Item.${it._id}`, id: it._id, type: it.type, name: it.name, slug: sys.slug, actor: { type: a.type }, _stats: it._stats, flags: it.flags ?? {}, system: sys };
    const slug = slugOf(null, doc) ?? null;
    let res = null, resErr = null;
    try { res = resolveRule(doc); } catch (e) { resErr = String(e.message ?? e).slice(0, 120); }
    const layer = res?.source === "catalog" ? layerOf(sourceId, slug, it.type) ?? "cat" : res?.source ?? null;
    const rule = res?.rule ? { layer, source: res.source, confidence: res.confidence, form: Object.keys(res.rule), ...(res.rule.onUse && { onUse: Object.keys(res.rule.onUse) }) } : null;
    const src = sourceId ? byUuid.get(sourceId) : null;
    const descEn = (src?.descEn ?? stripHtml(html)).slice(0, 600);
    const text = src?.descEn ?? stripHtml(html);
    const reKeys = (sys.rules ?? []).map((r) => r.key);
    const damage = sys.damage && Object.keys(sys.damage).length ? Object.keys(sys.damage) : null;
    const inline = { check: /@Check\[/.test(html), damage: /@Damage\[/.test(html), effectUuid: /@UUID\[[^\]]*(effect|Effect)/.test(html), act: /\[\[\/act /.test(html) };
    const native = { reKeys, selfEffect: sys.selfEffect?.uuid ?? null, damage, inline };
    const bset = slug ? builtinSlugs.get(slug) : null;
    const builtin = bset ? { files: [...bset].sort() } : null;
    const dm = sourceId && debtMech.get(sourceId), dr = sourceId && debtRec.get(sourceId);
    const debt = dm || dr ? { mechanisms: dm?.keys ?? [], reason: dr?.reason?.slice(0, 160) ?? null } : null;

    const signs = Object.entries(SIGNS).filter(([, re]) => re.test(text) || re.test(html)).map(([k]) => k);
    const propRunes = (sys.runes?.property?.length ?? 0) > 0 || (sys.runes?.potency ?? 0) > 0 && false;
    if (damage?.length && it.type === "spell") signs.push("sys.damage");
    if (sys.defense) signs.push("sys.defense");
    if (sys.area) signs.push("sys.area");
    if (sys.frequency || sys.actionType?.value === "reaction") signs.push("frequency/reaction");
    if (propRunes) signs.push("runes");
    if (it.type === "consumable" && sys.category !== "ammo") signs.push("consumable");
    let pre, why;
    const real = res?.source && res.source !== "markup";
    if (real) { pre = "rule"; why = `слой ${layer}`; }
    else if (builtin && ["action", "feat"].includes(it.type)) { pre = "builtin"; why = builtin.files.join(","); }
    else if (reKeys.length || native.selfEffect) { pre = "native-only"; why = reKeys.join(",") || "selfEffect"; }
    else if (it.type === "spell") { pre = "review"; why = `заклинание${signs.length ? ": " + signs.join(",") : ""}`; }
    else if (BASE_GEAR.has(it.type) ? !propRunes && !(signs.filter((s) => !["check", "damage", "bonus", "limit"].includes(s)).length) : NO_MECH_TYPES.has(it.type) && !signs.length) { pre = "no-mechanics"; why = BASE_GEAR.has(it.type) ? "базовое снаряжение" : "нет признаков"; }
    else { pre = "review"; why = `признаки: ${signs.join(",") || "тип " + it.type}${builtin ? "; builtin-литерал " + builtin.files.join(",") : ""}${res?.source === "markup" ? "; только разметка" : ""}`; }
    rows.push({ actor: a.name, actorType: a.type, name: it.name, type: it.type, slug, sourceId, traits: sys.traits?.value ?? [], level: sys.level?.value ?? null, category: sys.category ?? null, rule, builtin, native, debt, descEn, pre, why, signs, prior: priorOf(slug, it.name, sourceId), ...(resErr && { resolveError: resErr }) });
  }
}

writeJson(outPath(`audit-${world}.json`), { world, generatedAt: new Date().toISOString(), actors: actors.map((a) => ({ id: a._id, name: a.name, type: a.type, items: (embedded.get(a._id) ?? []).length, master: a.system?.master?.id ?? null })), rows }, 1);

const PRES = ["rule", "builtin", "native-only", "no-mechanics", "review"];
console.log(`актёры: ${actors.map((a) => `${a.name} [${a.type}]`).join("; ")}`);
for (const a of actors) {
  const rs = rows.filter((r) => r.actor === a.name);
  console.log(`${a.name.padEnd(20)} всего ${String(rs.length).padStart(3)} | ${PRES.map((p) => `${p} ${rs.filter((r) => r.pre === p).length}`).join(" | ")}`);
}
console.log(`ИТОГО ${rows.length} | ${PRES.map((p) => `${p} ${rows.filter((r) => r.pre === p).length}`).join(" | ")}`);
if (process.argv.includes("--review")) for (const r of rows.filter((x) => x.pre === "review")) console.log(`${r.actor} | ${r.name} | ${r.type} | ${r.why}`);
