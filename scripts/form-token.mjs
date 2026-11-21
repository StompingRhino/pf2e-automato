// Токен меняется при боевой форме pf2e (BattleForm): в память эффекта подмешивается правило pf2e TokenImage с файлом из FA Nexus (plan-battleform-tokens.md §4).
// Откат делает система (значения живут только в токене в памяти); в данные мира пишутся лишь флаги: formToken (на эффекте) и formChoice (на актёре, Pest Form).
import { MOD, L, debug, queue, isActiveGM, whenSettled } from "./util.mjs";
import { findToken, catalogThumbs } from "./nexus-tokens.mjs";
import { askOwner, askHere, esc, worldActors } from "./builtin/lib.mjs";

const SETTING = "formTokens";
const on = () => { try { return !!game.settings.get(MOD, SETTING); } catch { return false; } };

/** Чистая: у эффекта (документ или _source) есть правило BattleForm. */
export const hasBattleForm = (item) => (item?.system?.rules ?? []).some((r) => r?.key === "BattleForm");

/** Чистая: форма действует, если хотя бы один BattleForm эффекта не ignored (pf2e гасит невыбранные в preCreate и вторую форму в beforePrepareData). */
export const activeForm = (rules) => (rules ?? []).some((r) => r?.key === "BattleForm" && !r.ignored);

/** Чистая: эффект и таблица -> значение выбора ChoiceSet (у дракона — dragonType) или null. Выбор лежит в flags.pf2e.rulesSelections под флагом правила. */
export function selectionOf(item, table) {
  const opts = table?.byChoice?.[item?.slug];
  if (!opts) return null;
  for (const v of Object.values(item.flags?.pf2e?.rulesSelections ?? {})) {
    const k = v && typeof v === "object" ? v.dragonType : v;
    if (typeof k === "string" && k in opts) return k;
  }
  return null;
}

const titled = (s) => s.split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
/** devil-form-barbazu -> [Barbazu, Devil Barbazu]; nature-incarnate -> [Nature Incarnate]. */
const derived = (slug) => { const s = slug.replace(/^(spell-)?effect-/, ""), m = /-form-(.+)$/.exec(s); return [...(m ? [titled(m[1])] : []), titled(s.replace(/-form(?=-|$)/, ""))]; };
const normalize = (v) => (Array.isArray(v) ? { names: v } : v?.pick ? { pick: v.pick } : v?.none ? { none: v.none } : null);

/** Чистая: что искать для эффекта -> { names } | { pick } | { none } | null (вариант ещё не выбран). Нет записи в таблице — имя из slug (devil-form-barbazu -> Barbazu). */
export function entryOf(item, table) {
  const slug = item?.slug;
  if (!slug) return null;
  if (table?.byChoice?.[slug]) { const k = selectionOf(item, table); return k ? normalize(table.byChoice[slug][k]) : null; }
  return normalize(table?.bySlug?.[slug]) ?? { names: derived(slug) };
}

/** Чистая: результат findToken -> флаг для записи на эффект. {none} — только когда поиск реально прошёл (not-found); сбой окружения не пишет ничего. */
export const flagFor = (res) => (res?.src ? { src: res.src, scale: res.scale ?? 1 } : res?.reason === "not-found" ? { none: true } : null);

/** Чистая: выбор для правила: Pest Form — выбор игрока на актёре (formChoice), остальные — кеш на эффекте (formToken); {none}/{declined} -> null. */
export const tokenOf = (item, actor) => [actor?.flags?.[MOD]?.formChoice?.[item?.slug], item?.flags?.[MOD]?.formToken].find((f) => f?.src) ?? null;

/** Чистая: кольцо токена (§4.5). Включено и subject.texture пуст — кольцо берёт texture.src, не трогаем; задан — подменяем тот же файл, scale 1; кольца нет — нечего. */
export const ringPart = (ring, src) => (ring?.enabled && ring.subject?.texture ? { ring: { subject: { texture: src, scale: 1 } } } : {});

/** Чистая: исходник правила TokenImage или null (нет файла / настройка выключена). */
export const formRuleSource = (flag, ring, enabled = true) => (enabled && flag?.src ? { key: "TokenImage", value: flag.src, ...(flag.scale > 0 ? { scale: flag.scale } : {}), ...ringPart(ring, flag.src) } : null);

const ownImage = (actor, item) => (actor?._source?.items ?? []).some((i) => i._id !== item.id && (i.system?.rules ?? []).some((r) => r?.key === "TokenImage"));

/** Точка в wrapRules (neutralize-rules.mjs): дописывает к правилам эффекта с BattleForm правило TokenImage (в памяти, документы не пишутся). */
export function addFormToken(rules, opts) {
  const item = opts?.parent, actor = item?.actor;
  if (item?.type !== "effect" || !actor || !hasBattleForm(item) || ownImage(actor, item)) return;
  const src = formRuleSource(tokenOf(item, actor), actor.prototypeToken?.ring, on()), All = globalThis.game?.pf2e?.RuleElements?.all?.TokenImage;
  if (!src || !All) return;
  try {
    const r = new All(src, { ...opts, sourceIndex: null }), after = r.afterPrepareData.bind(r);
    r.afterPrepareData = () => { r.ignored = !activeForm(rules); return after(); };   // действует, пока не ignored хотя бы один BattleForm
    rules.push(r);
  } catch (e) { console.warn(`${MOD} | form-token ${item.name}`, e); }
}

let table = null;
const asking = new Set();   // актёры с открытым окном выбора: второе не открываем (окно вне общей очереди)
const base = (p) => String(p).split("/").pop();

/** Кандидаты для окна Pest Form: локальные файлы по именам + превью бесплатного каталога (без скачивания). [{name, file, thumb, src?, scale?}] */
async function candidates(names) {
  const out = [], rest = [];
  for (const name of names) {
    const r = await findToken([name], { download: false });
    r.src ? out.push({ name, file: base(r.src), thumb: r.src, src: r.src, scale: r.scale }) : rest.push(name);
  }
  if (rest.length) out.push(...(await catalogThumbs(rest)));
  return [...new Map(out.map((c) => [c.file, c])).values()];
}

// DialogV2 экранирует подписи кнопок: картинки — радиокнопками в содержимом, в подвале «Выбрать» / «Оставить как есть»
const grid = (cands, prev) => { const at = Math.max(0, cands.findIndex((c) => c.name === prev)); return `<div class="paf-form-picks" style="display:flex;flex-wrap:wrap;gap:6px">${cands.map((c, i) => `<label style="display:flex;flex-direction:column;align-items:center;width:84px;cursor:pointer"><input type="radio" name="pick" value="${i}"${i === at ? " checked" : ""}><img src="${esc(c.thumb)}" width="72" height="72" style="object-fit:contain;border:0"><span style="font-size:10px;word-break:break-all;text-align:center">${esc(c.name)}</span></label>`).join("")}</div>`; };

/** Окно выбора существа (у игрока через runPlayerBuiltin, у ГМа локально): scope.args.cands -> индекс строкой | "decline" | null. */
export async function pick(scope) {
  const cands = scope.args?.cands ?? [];
  const res = await askHere(L("formToken.title"), `<p>${L("formToken.prompt", { name: esc(scope.actor?.name) })}</p>${grid(cands, scope.args?.prev)}`,
    [{ id: "choose", label: L("formToken.choose") }, { id: "decline", label: L("formToken.decline") }]);
  if (res?.action === "choose") return String(res.form?.pick ?? "0");
  return res?.action ?? null;
}

// существо выбирается при каждом превращении (новый эффект), прошлый выбор отмечен в окне; проход по висящим эффектам (ready) не спрашивает, если выбор уже был
async function askPest(actor, item, names, fresh) {
  const had = actor.flags?.[MOD]?.formChoice?.[item.slug];
  if ((had && !fresh) || asking.has(actor.uuid)) return;
  asking.add(actor.uuid);
  const write = (v) => queue(`actor:${actor.uuid}`, () => actor.setFlag(MOD, `formChoice.${item.slug}`, v));
  try {
    const cands = await candidates(names);
    if (!cands.length) return void debug("form-token: нет кандидатов для", item.slug);
    const wire = cands.map(({ name, file, thumb }) => ({ name, file, thumb }));
    const args = { cands: wire, prev: had?.name ?? null };
    const ans = await askOwner(actor, "form-token-pick", { args }, () => pick({ actor, args }));
    const c = cands[Number(ans)];
    if (!c || ans === "decline") return void await write({ declined: true, name: had?.name ?? null });   // отказ, закрытие, тайм-аут: токен как есть до следующего превращения
    const r = c.src ? { src: c.src, scale: c.scale } : await findToken([c.name]);   // скачивает ГМ после ответа
    if (r.src) await write({ name: c.name, src: r.src, scale: r.scale ?? 1 });
    else debug("form-token: выбранный файл не получен", c.name, r.reason);
  } catch (e) { console.warn(`${MOD} | form-token pick`, e); }
  finally { asking.delete(actor.uuid); }
}

/** Активный ГМ: найти файл для эффекта с BattleForm и записать флаг (один раз). fresh — эффект только что наложен (createItem): Pest Form спрашивает заново. */
export async function process(item, { fresh = false } = {}) {
  const actor = item?.actor;
  if (!on() || item?.type !== "effect" || !actor || !hasBattleForm(item) || !table) return;
  const e = entryOf(item, table);
  if (!e?.names && !e?.pick) return;
  if (e.pick) return askPest(actor, item, e.pick, fresh);
  if (item.flags?.[MOD]?.formToken) return;
  const f = flagFor(await findToken(e.names));
  if (f) await queue(`actor:${actor.uuid}`, () => item.setFlag(MOD, "formToken", f));
  else debug("form-token: флаг не пишем (сбой окружения)", item.slug);
}

const withForms = (a) => (a?.items ?? []).some((i) => i.type === "effect" && hasBattleForm(i));
/** Пересобрать актёров с формами (смена настройки), включая актёров несвязанных токенов. */
export function resetActors() {
  for (const a of worldActors()) if (withForms(a)) try { a.reset(); } catch (e) { console.warn(`${MOD} | form-token reset`, e); }
}

export function init() {
  game.settings.register(MOD, SETTING, { name: "PF2E_AUTOMATO.formToken.name", hint: "PF2E_AUTOMATO.formToken.hint", scope: "world", config: true, type: Boolean, default: true, onChange: resetActors });
  Hooks.on("createItem", (item, options) => { if (isActiveGM()) process(item, { fresh: true }).catch((e) => console.warn(`${MOD} | form-token`, e)); });
  Hooks.once("ready", async () => {
    try {
      const r = await fetch(foundry.utils.getRoute(`modules/${MOD}/rules/form-tokens.json`));
      table = r.ok ? await r.json() : null;
    } catch (e) { console.warn(`${MOD} | form-tokens.json`, e); }
    await whenSettled();
    if (!isActiveGM()) return;
    for (const a of worldActors()) for (const i of a.items) if (i.type === "effect" && hasBattleForm(i)) process(i).catch((e) => console.warn(`${MOD} | form-token ready`, e));
  });
}
