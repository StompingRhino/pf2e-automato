// Ярость. Когда эффект «Ярость» (feat-effects, slug effect-rage) заканчивается, на минуту действует «Иммунитет к временным ОЗ от Ярости»: нового
// всплеска ОЗ от действия Ярость не получить. Признак — slug эффекта: им пользуются все ярости (барбарские инстинкты, «Ярость» NPC — через selfEffect).
// Остальное, чего нет в pf2e (урон, ВОЗ, скорость, удары инстинкта pf2e считает сам по self:effect:rage):
// - эффект кладёт кнопка pf2e «Применить эффект» на карточке «Ярость»/«Вспыльчивость», как у всех действий с эффектом на себя; требования
//   (не в ярости, не утомлён; у Вспыльчивости — не нагружен и без тяжёлой брони) блокируют саму карточку (impulse-gate, строки raging/fatigued/quickTempered);
// - временные ОЗ — при создании эффекта ярости любым путём (кнопка pf2e, перетаскивание): правило pf2e их не начисляет;
// - второй эффект ярости не создаётся;
// - инициатива с «Вспыльчивостью» — шёпот с кнопкой (свободное действие по желанию игрока);
// - конец ярости: потеря сознания и конец боя (минуту отсчитывает pf2e);
// - действие с «концентрацией» без «ярости» в ярости: карточку использования блокирует impulse-gate (строка LIMITS «rage», общий код — limit-text.mjs); здесь — шёпот только там, где карточки нет (проверка навыка/Восприятия).
import { L, MOD, queue } from "../util.mjs";
import { addEffect, cardButton, esc, paHas, whisper } from "./lib.mjs";
import { RAGE_SLUG, isRage, raging, breaksRage as breaksRageAny, quickTempered } from "./limit-text.mjs";
import { isUseCard, rageExtras } from "./impulse-gate.mjs";

export { RAGE_SLUG, isRage, quickTempered };
export const KEY = "rage-immunity";
export const IMMUNITY = "Compendium.pf2e.feat-effects.Item.MaepXeSHiMoWDm7u";
export const RAGE = "Compendium.pf2e.feat-effects.Item.z3uyCMBddrPK5umr";
const USE_TYPES = new Set([undefined, "self-effect", "spell-cast", "skill-check", "perception-check"]);   // использование, не бросок атаки/урона

/** Чистая: почему нельзя впасть в ярость -> "raging" | "fatigued" | null. */
export const blockedBy = ({ raging, fatigued }) => (raging ? "raging" : fatigued ? "fatigued" : null);

/** Чистая: использование (не бросок атаки/урона) нарушает ярость; правила — limit-text.breaksRage. */
export const breaksRage = (c) => USE_TYPES.has(c.type) && breaksRageAny(c);

const blocked = (actor) => blockedBy({ raging: raging(actor), fatigued: !!actor.hasCondition?.("fatigued") });

/** deleteItem у активного ведущего. Повторная ярость заново запускает минуту: старый иммунитет заменяется. */
export async function onDelete(item) {
  const actor = item.actor;
  if (!isRage(item) || !actor || paHas("rage")) return;
  const src = (await fromUuid(IMMUNITY))?.toObject();
  if (!src) return;
  delete src._id;
  src.system.context = { ...src.system.context, origin: { actor: actor.uuid, token: null, item: null, spellcasting: null, rollOptions: [] } };
  await queue(`actor:${actor.uuid}`, async () => {
    for (const e of actor.items.filter((i) => i.type === "effect" && i.flags?.[MOD]?.meta?.key === KEY)) await e.delete();
  });
  await addEffect(actor, src, KEY);
}

/** preCreateItem у любого клиента: false — второй эффект ярости не создаётся. */
export const preCreate = (item) => !(isRage(item) && raging(item.parent));

/** Снять ярость (deleteItem -> иммунитет к ВОЗ). */
const endRage = (actor) => queue(`actor:${actor.uuid}`, async () => {
  for (const e of actor.itemTypes.effect.filter(isRage)) await e.delete();
});

/** createItem у ведущего: «Без сознания» прекращает ярость; новый эффект ярости — временные ОЗ. */
export async function onCreate(item) {
  if (item.type === "condition" && item.slug === "unconscious" && raging(item.actor) && !paHas("rage")) await endRage(item.actor);
  if (isRage(item) && item.actor && !paHas("rage")) await tempHP(item.actor, item);
}

/** Конец боя (сцены) прекращает ярость участников. */
export async function onCombatEnd(combat) {
  if (paHas("rage")) return;
  for (const c of combat.combatants) if (raging(c.actor)) await endRage(c.actor);
}

/** ВОЗ вручную: pf2e TempHPRuleElement.onCreate резолвит @actor.flags.system.rageTempHP до того, как ActiveEffectLike (phase: beforeDerived)
 *  его выставляет — порядок вычисления правил. tempSource = id эффекта, чтобы TempHPRuleElement.onDelete сбросил ВОЗ при удалении. */
async function tempHP(actor, effect) {
  // «can't gain temporary Hit Points from using the Rage action again for 1 minute» — иммунитет кладёт onDelete
  if (actor.itemTypes.effect.some((e) => e.flags?.[MOD]?.meta?.key === KEY || e.slug === "effect-rage-temporary-hit-points-immunity")) return;
  const hp = (actor.level ?? 0) + (actor.system.abilities?.con?.mod ?? 0);
  if (hp > 0 && hp > (actor.system.attributes.hp.temp ?? 0)) await actor.update({ "system.attributes.hp.temp": hp, "system.attributes.hp.tempSource": effect.id });
}

/** Сообщения чата у ведущего: инициатива, использование с концентрацией. */
export async function onMessage(message) {
  const actor = message.actor, ctx = message.flags?.pf2e?.context;
  if (!actor || paHas("rage")) return;
  if (ctx?.type === "initiative") {
    const qt = actor.itemTypes?.action.find((i) => i.slug === "quick-tempered");
    if (!qt || blocked(actor)) return;
    if (!quickTempered({ encumbered: !!actor.hasCondition?.("encumbered"), heavy: actor.wornArmor?.category === "heavy", invulnerable: actor.items.some((i) => i.slug === "invulnerable-rager") })) return;
    return void await whisper(actor, L("builtin.rage.quick", { name: esc(actor.name) }), "rage", {}, cardButton(`data-af-rage="${qt.uuid}"`, L("builtin.rage.button")));
  }
  if (!raging(actor) || isUseCard(message)) return;   // карточку использования уже блокирует impulse-gate
  const item = message.item, opts = ctx?.options ?? [];
  const traits = [...(item?.system?.traits?.value ?? []), ...(ctx?.traits ?? []).map((t) => t?.name ?? t)];
  const slug = item?.slug ?? opts.find((o) => o.startsWith("action:"))?.slice(7);
  if (breaksRage({ type: ctx?.type, traits, slug, ...rageExtras(actor) })) await whisper(actor, L("builtin.rage.concentrate", { name: esc(actor.name), what: esc(item?.name ?? game.i18n.localize(game.pf2e?.actions?.get(slug)?.name ?? slug ?? "")) }), "rage");
}

/** Кнопка «Впасть в ярость» в шёпоте: у нажавшего — действие «Вспыльчивость» pf2e (карточка self-effect с кнопкой pf2e «Применить эффект»). */
export function bind(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  root?.querySelectorAll?.("[data-af-rage]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    await game.pf2e.rollItemMacro(b.dataset.afRage);
  }));
}
