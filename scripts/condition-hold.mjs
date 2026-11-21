// Удержание состояния недугом (plan-affliction-linger-hold.md §3.3): пока недуг идёт, его состояние нельзя снять и снизить ниже floor.
// Носитель недуга хранит meta.affliction.held = { slug: { floor, id } } — id конкретного документа состояния на актёре.
// pf2e сам не даёт удалить обёрнутое состояние (GrantItem restrict) — для них держим только снижение значения; «голые» (UNLINKED) — и удаление, и снижение.
// Обход: Alt в момент операции (решение ГМа) и unchecked() для операций самого модуля. Образец — builtin/melee-reach.mjs.
import { L, MOD, flagPath, forcedReplace } from "./util.mjs";
import { modeOf } from "./settings.mjs";
import { UNLINKED } from "./affliction.mjs";

const metaOf = (carrier) => carrier?.flags?.[MOD]?.meta?.affliction ?? null;
const itemsOf = (actor) => [...(actor?.items ?? [])];
const valueOf = (i) => i?.system?.value?.value ?? 1;   // состояние без значения — 1

/** Чистая: удерживаемые записи актёра. valid — [{slug, floor, id, carrier}]; orphans — [{carrier, slugs}] (id уже нет на актёре). */
export function readHeld(actor) {
  const items = itemsOf(actor), ids = new Set(items.map((i) => i.id)), valid = [], orphans = [];
  for (const carrier of items) {
    const held = metaOf(carrier)?.held;
    if (!held || typeof held !== "object") continue;
    const dead = [];
    for (const [slug, h] of Object.entries(held)) {
      if (h && Number.isFinite(h.floor) && ids.has(h.id)) valid.push({ slug, floor: h.floor, id: h.id, carrier });
      else dead.push(slug);
    }
    if (dead.length) orphans.push({ carrier, slugs: dead });
  }
  return { valid, orphans };
}

/** Чистая: floor состояния slug у актёра (максимум по живым записям) или null — не удерживается. */
const limitsOff = () => { try { return modeOf("limits") === "off"; } catch { return false; } };   // тесты без настроек

export function floorOf(actor, slug) {
  if (limitsOff()) return null;   // решение ГМа: при mode.limits=off запрета нет нигде
  const f = readHeld(actor).valid.filter((h) => h.slug === slug).map((h) => h.floor);
  return f.length ? Math.max(...f) : null;
}

/** Чистая: новое значение системы.value.value из changes (плоский или вложенный ключ) или undefined. */
export const newValue = (changes) => changes?.["system.value.value"] ?? changes?.system?.value?.value;

/**
 * Чистая: {slug, floor, carrier, how: "remove"|"reduce"}, если операция над состоянием item нарушает удержание; иначе null.
 * change — { delete: true } | { value: n }. Другой экземпляр того же slug со значением ≥ floor снимает запрет.
 */
export function violation(actor, item, change) {
  if (!actor || !item) return null;
  const { valid } = readHeld(actor);
  let doc = item, h, how;
  if (item.type === "effect" && change.delete) {
    // удаление обёртки каскадом снимает выданное ею состояние (GrantItem grantedBy, pf2e): отменяем на обёртке
    doc = itemsOf(actor).find((i) => i.type === "condition" && i.grantedBy?.id === item.id && valid.some((x) => x.slug === i.slug && x.id === i.id));
    if (!doc) return null;
    h = valid.find((x) => x.slug === doc.slug && x.id === doc.id); how = "remove";
  } else if (item.type === "condition") {
    h = valid.find((x) => x.slug === item.slug && x.id === item.id);
    if (!h) return null;
    // обёрнутое: прямое удаление отменяет pf2e (restrict), но при удалении обёртки pf2e кладёт состояние в ту же пачку — отменяем и его
    if (change.delete) how = "remove";
    else if (Number.isFinite(change.value) && change.value < h.floor) how = "reduce";
    else return null;
  } else return null;
  const other = itemsOf(actor).some((i) => i.type === "condition" && i.slug === h.slug && i.id !== doc.id && valueOf(i) >= h.floor);
  return other ? null : { slug: h.slug, floor: h.floor, carrier: h.carrier, how };
}

// Счётчик обхода — по актёру (uuid); без актёра ("*") — операция сразу над несколькими (undoOps)
const skips = new Map();
/** Операция модуля без проверки удержания (снятие недуга, смена стадии, откат). */
export async function unchecked(fn, actor = null) {
  const k = actor?.uuid ?? "*";
  skips.set(k, (skips.get(k) ?? 0) + 1);
  try { return await fn(); } finally { skips.set(k, skips.get(k) - 1); }
}
const skipped = (actor) => !!(skips.get("*") || skips.get(actor?.uuid));

/** Тост — не чаще раза на (актёр, slug) за ход боя; вне боя — за 10 с. Отмена операции от тоста не зависит. */
const toasted = new Map();
export const resetToasts = () => toasted.clear();   // живые сценарии
export function toastDue(key, combat = globalThis.game?.combat, t = Date.now()) {
  const stamp = combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null, prev = toasted.get(key);
  if (prev && (stamp ? prev.stamp === stamp : !prev.stamp && t - prev.t < 10000)) return false;
  toasted.set(key, { stamp, t });
  return true;
}

const altHeld = () => !!globalThis.game?.keyboard?.isModifierActive?.("Alt");

/** Имя недуга в предупреждении — исходный предмет, иначе носитель (не def.name: это английский снимок). */
function afflictionName(carrier) {
  let src = null;
  try { const o = metaOf(carrier)?.origin; src = o ? globalThis.fromUuidSync?.(o) : null; } catch { /* предмета нет */ }
  return src?.name ?? carrier.name;
}
const condName = (slug) => { const k = globalThis.CONFIG?.PF2E?.conditionTypes?.[slug]; return k ? game.i18n.localize(k) : slug; };

/** Вычистка осиротевших id при чтении: запись заменяется, а не сливается. Тихо, без блокировки. */
function prune(orphans) {
  if (!globalThis.game?.users?.activeGM?.isSelf) return;   // пишет один ГМ: у игрока и второго ГМа update дублировал бы или упал
  for (const { carrier, slugs } of orphans) {
    const held = Object.fromEntries(Object.entries(metaOf(carrier).held).filter(([s]) => !slugs.includes(s)));
    carrier.update(forcedReplace(flagPath("meta", "affliction", "held"), held), { [MOD]: { direct: true } }).catch((e) => console.warn(`${MOD} | condition-hold prune`, e));
  }
}

/** true — операцию отменить (предупреждение показано). */
function block(item, change) {
  const actor = item.parent;
  if (skipped(actor) || altHeld() || limitsOff() || !actor?.items) return false;
  try {
    const { orphans } = readHeld(actor);
    if (orphans.length) prune(orphans);
    const v = violation(actor, item, change);
    if (!v) return false;
    if (toastDue(`${actor.uuid}:${v.slug}`)) ui.notifications.warn(L("builtin.hold.blocked", { cond: condName(v.slug), how: L(`builtin.hold.how.${v.how}`), affliction: afflictionName(v.carrier) }));
    return true;
  } catch (e) { console.warn(`${MOD} | condition-hold`, e); return false; }
}

export function init() {
  Hooks.on("preDeleteItem", (item) => (block(item, { delete: true }) ? false : undefined));
  Hooks.on("preUpdateItem", (item, changes) => {
    const value = newValue(changes);
    return value !== undefined && block(item, { value }) ? false : undefined;
  });
}
