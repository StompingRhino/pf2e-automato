// Требования базовых действий (Requirements в описании, CLAUDE.md §1.1): Захват/Подсечка/Толчок/Разоружение — свободная рука и цель не больше чем на размер крупнее;
// Перемещение — рука или удержание цели, размер; Финт — досягаемость ближнего боя; Грязный приём — рука и досягаемость; Деморализация и Остроумная фраза — 30 фт.
// pf2e этого не проверяет (в pf2e.mjs нет проверок руки/размера у действий). Форма — как melee-reach.mjs: обёртка game.pf2e.Check.roll, броска нет, предупреждение, Alt обходит.
// Рука — handsReallyFree: щит занимает руку (текст правил); pf2e handsFree щит намеренно не считает. Предметы с чертой free-hand руку не занимают. Оружие манёвра — готовый Удар с чертой trip/shove/disarm/grapple (TraitDescription*: «даже без свободной руки, досягаемость оружия»).
// Ловим только «голое» действие: бросок с context.item другого предмета (Slam Down, Ты следующий) и атака заклинанием пропускаются — у них свои условия.
import { L, MOD } from "../util.mjs";
import { modeOf } from "../settings.mjs";
import { pickSource } from "./melee-reach.mjs";

const MAN = { hand: true, size: true, reach: true };
/** Действия группы: hand — нужна свободная рука; hold — рука не нужна, если цель уже схвачена; size — не больше +1 размера; reach — досягаемость ближнего боя; range — дальность, фт; trait — оружие с чертой. */
export const ACTS = {
  grapple: { ...MAN, hold: true, trait: "grapple" }, trip: { ...MAN, trait: "trip" }, shove: { ...MAN, trait: "shove" }, disarm: { ...MAN, trait: "disarm" },
  reposition: { ...MAN, hold: true }, feint: { reach: true, anyStrike: true }, "dirty-trick": { hand: true, reach: true }, demoralize: { range: 30 }, "bon-mot": { range: 30 }
};
const KEY = { "dirty-trick": "DirtyTrick", "bon-mot": "BonMot" };
const RANK = { tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 };
const MANEUVERS = ["disarm", "grapple", "reposition", "shove", "trip"];

/**
 * Снятия требований пассивами (slug предмета актёра). size — на сколько размеров больше можно цель (сверх одного), hand — рука не нужна.
 * Из descEn (tools/out/items.json). При незнакомом снятии блок лучше пропустить: берём максимум (Titan Wrestler: legendary Athletics — ещё +1; Bullying Staff — master посоха).
 * Не закодированы: Deadweight Mutagen (эффект потребляемого, без slug предмета), Four-Armed Aspect включён без проверки срока эффекта.
 * ponytail: Disarming Stance, Larger Than Life, Four-Armed Aspect, Staff Acrobat — по наличию черты, без проверки стойки/доспеха/посоха; Alt и так обходит, ложный пропуск лучше ложного блока.
 */
export const RELIEF = {
  "titan-wrestler": { size: (a) => (a?.skills?.athletics?.rank >= 4 ? 2 : 1), acts: MANEUVERS },
  "skybearers-belt": { size: () => 1, acts: ["disarm", "grapple", "shove", "trip"] },
  "bullying-staff": { size: () => 2, acts: ["shove", "trip"] },
  "disarming-stance": { size: () => 1, acts: ["disarm"] },
  "larger-than-life-guardian": { size: () => 1, acts: ["disarm", "grapple", "reposition", "shove", "trip"] },
  "legs-of-stone": { hand: true, acts: ["shove"] },
  "staff-acrobat-dedication": { hand: true, acts: ["shove", "trip"] },
  "powerful-tail": { hand: true, acts: ["trip"] },
  "climbing-tail": { hand: true, acts: ["trip"] },
  "four-armed-aspect": { hand: true, acts: ["disarm", "grapple", "shove", "trip"] }
};

/** Чистая: сводка снятий для действия по slug'ам предметов актёра -> { size, hand }. */
export function reliefFor(slug, itemSlugs, actor) {
  let size = 0, hand = false;
  for (const s of itemSlugs) {
    const r = RELIEF[s];
    if (!r?.acts.includes(slug)) continue;
    if (r.size) size = Math.max(size, r.size(actor));
    if (r.hand) hand = true;
  }
  return { size, hand };
}

/** Чистая: slug базового действия по опциям броска (`action:<slug>`, ровно один сегмент); не из группы — null. */
export function actionOf(options) {
  for (const o of options ?? []) { const m = /^action:([a-z0-9-]+)$/.exec(o); if (m && ACTS[m[1]]) return m[1]; }
  return null;
}

/** Чистая: бросок не «голый» — предмет другого действия или атака заклинанием. */
export const isOtherItem = (slug, ctx) => (ctx?.item && ctx.item.slug !== slug) || (ctx?.domains ?? []).includes("spell-attack");

/**
 * Чистая: нарушение требований или null. f: { hands, strikes:[{traits, reach}], base, holding, size, tSize, dist, relief:{size,hand} }.
 * Нет числа (нет цели, нет токенов, гексы) — соответствующую проверку пропускаем.
 */
export function violation(slug, f) {
  const a = ACTS[slug];
  const free = f.hands > 0 || f.relief?.hand || (a.hold && f.holding);
  const weapon = a.trait ? (f.strikes ?? []).find((s) => s.traits?.includes(a.trait)) : null;
  if (a.hand && !free && !weapon) return { key: a.trait ? "noHandTrait" : "noHand", trait: a.trait };
  if (a.size && Number.isFinite(f.size) && Number.isFinite(f.tSize) && f.tSize - f.size > 1 + (f.relief?.size ?? 0)) return { key: "size" };
  if (a.reach && Number.isFinite(f.dist)) {
    const c = [];
    if (!a.hand || free) c.push(f.base);   // голая рука: у Финта руки не требуется
    if (weapon) c.push(weapon.reach);
    if (a.anyStrike) c.push(...(f.strikes ?? []).map((s) => s.reach));
    const rs = c.filter(Number.isFinite), r = Math.max(...rs), d = (x) => f.distFor?.(x) ?? f.dist;   // distFor: диагональная поправка pf2e зависит от досягаемости кандидата
    if (rs.length && rs.every((x) => d(x) > x)) return { key: "reach", d: d(r), r };
  }
  if (a.range && Number.isFinite(f.dist) && f.dist > a.range) return { key: "range30", d: f.dist, r: a.range };
  return null;
}

const titleOf = (slug, actor) => {
  const k = `PF2E.Actions.${KEY[slug] ?? slug[0].toUpperCase() + slug.slice(1)}.Title`;
  if (game.i18n.has?.(k)) return game.i18n.localize(k);
  return actor?.items?.find((i) => i.slug === slug)?.name ?? slug.replace(/-/g, " ");
};

/** Чистая: свободные руки — щит занимает руку (pf2e `really`), кроме предметов с чертой free-hand (Nimble Shield Hand, Juggle). У NPC system.hands нет — handsFree, иначе 1. */
export function freeHands(actor) {
  const really = actor?.handsReallyFree;
  if (!Number.isFinite(really)) return actor?.handsFree ?? 1;
  const light = (actor.inventory ?? []).filter((i) => i.system?.traits?.value?.includes("free-hand")).reduce((n, i) => n + (i.handsHeld ?? 0), 0);
  return Math.min(really + light, actor.system?.hands?.max?.value ?? 2);
}

/** Факты с листа и сцены -> violation. Только квадратная сетка и токены текущей сцены (как melee-reach). */
function gather(slug, ctx) {
  const actor = ctx.actor ?? ctx.origin?.actor;
  if (!actor) return null;
  const t = ctx.target?.token?.object, tActor = ctx.target?.actor ?? t?.actor;
  const strikes = (actor.system?.actions ?? []).filter((s) => s.ready !== false && s.item?.isMelee !== false).map((s) => ({
    traits: s.item?.system?.traits?.value ?? [], /* s.traits — черты действия (attack), черты оружия — у предмета */ reach: actor.getReach?.({ action: "attack", weapon: s.item })
  }));
  const holding = !!tActor?.itemTypes?.condition?.some((c) => ["grabbed", "restrained"].includes(c.slug));
  const grid = globalThis.canvas?.grid?.isSquare;
  const src = grid ? pickSource((ctx.token ?? ctx.origin?.token)?.object, canvas.tokens?.controlled, actor.id) : null;
  const onScene = src && t && src.scene === canvas.scene && t.scene === canvas.scene;
  const base = actor.attributes?.reach?.base;
  return {
    hands: freeHands(actor), strikes, base, holding, relief: reliefFor(slug, actor.items.map((i) => i.slug), actor),
    // блок по размеру/досягаемости — только при сетке; рука проверяется всегда
    size: grid ? RANK[actor.size] : NaN, tSize: grid ? RANK[tActor?.size] : NaN,
    dist: onScene ? src.distanceTo(t, { reach: base }) : NaN, distFor: onScene ? (r) => src.distanceTo(t, { reach: r }) : undefined, name: titleOf(slug, actor), target: t?.name ?? tActor?.name
  };
}

function check(ctx) {
  const slug = actionOf(ctx?.options instanceof Set ? [...ctx.options] : ctx?.options);
  if (!slug || isOtherItem(slug, ctx) || Date.now() < fromText) return null;
  const f = gather(slug, ctx);
  const v = f && violation(slug, f);
  return v && { ...v, name: f.name, target: f.target ?? "", trait: v.trait ? game.i18n.localize(`PF2E.Trait${v.trait[0].toUpperCase()}${v.trait.slice(1)}`) : "" };
}

let skip = 0, fromText = 0;
/** Бросок модуля без проверки требований (свои сценарии уже решили, что действие законно). */
export async function unchecked(fn) {
  skip++;
  try { return await fn(); } finally { skip--; }
}

const altHeld = () => !!globalThis.game?.keyboard?.isModifierActive?.("Alt");

/** Клик по `[data-pf2-action]` / `[[/act]]` внутри описания другого предмета — действие из его текста, не «голое»: ближайший бросок не проверяется. */
export function onTextClick(ev) {
  const el = ev.target?.closest?.("[data-pf2-action]");
  if (!el) return;
  const slug = el.dataset.pf2Action, host = el.closest("[data-message-id]"), win = el.closest(".application, .app");
  const app = win && (globalThis.ui?.windows?.[win.dataset.appid] ?? globalThis.foundry?.applications?.instances?.get(win.id));
  const other = host ? globalThis.game?.messages?.get(host.dataset.messageId)?.item : (app?.item ?? app?.document);   // нет чужого предмета (журнал, лист самой Подсечки) — бросок «голый»
  if (other?.slug && other.slug !== slug) fromText = Date.now() + 2000;   // ponytail: окно 2 с, pf2e бросает до диалога; бросок другого актёра в это окно проскочит
}

export async function wrap(orig, ...args) {
  let v = null;
  if (!skip && !altHeld() && modeOf("limits") !== "off") {
    try { v = check(args[1]); } catch (e) { console.warn(`${MOD} | maneuver-gate`, e); }
  }
  if (v) { ui.notifications.warn(L(`builtin.maneuverGate.${v.key}`, { ...v, d: Math.round(v.d ?? 0) })); return null; }
  return orig(...args);
}

let installed = false;
/** Идемпотентно; вызывать после ready (game.pf2e.Check есть). */
export function install() {
  if (installed || !globalThis.game?.pf2e?.Check?.roll) return;
  document.addEventListener("click", onTextClick, true);
  installed = true;   // сам Check.roll не оборачивает: wrap зовёт обёртка melee-reach (libWrapper — одна обёртка функции на модуль)
}
