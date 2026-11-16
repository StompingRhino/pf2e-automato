// «Трата слота как реакция»: Проводящий блок (и копии NPC) — при Блоке щитом можно потратить заклинание «Лечение»/«Вред», твёрдость щита растёт на (ранг)d8.
// Бросок и прибавку к твёрдости pf2e делает сам: «Effect: Channeling Block» (feat-effects) — бейдж-формула (@item.level)d8 и ItemAlteration твёрдости щита.
// Здесь только то, чего pf2e не делает: слот и его трата. Выбор — решение игрока: варианты «Блок + <заклинание> (ранг)» идут кнопками в самой подсказке «Блок»
// (shield-block.mjs), без модального окна внутри очереди применения урона.
import { MOD, L } from "../util.mjs";
import { addEffect, cardButton, esc, heldSlug, paHas, whisper } from "./lib.mjs";
import { blockOptions as slotOptions, uniqueOptions, entriesOf } from "../slots.mjs";

export { uniqueOptions, entriesOf };

export const SLUGS = new Set(["channeling-block"]);
export const EFFECT = "Compendium.pf2e.feat-effects.Item.Rzg3c7hfkvTlxPDp";
const SPELLS = new Set(["heal", "harm"]);

/** Чистая: варианты траты Лечения/Вреда (общая логика ячеек — slots.mjs). -> [{id: "entry:spell:rank:slot", entry, spell, rank, slot, label}] */
export const blockOptions = (entries, label) => slotOptions(entries, label, { want: (s) => SPELLS.has(s.slug) });

/** Чистая: щит в attributes.shield — настоящий предмет-щит (не эффект щита-заклинания: тот заканчивается блоком и твёрдости от Проводящего блока не получает). */
export const realShield = (actor) => actor?.items?.get(actor.attributes?.shield?.itemId)?.type === "shield";

/** Варианты актёра: есть черта, настоящий щит и слот. */
export function optionsOf(actor) {
  const slug = heldSlug(actor, SLUGS);
  return !slug || paHas(slug) || !realShield(actor) ? [] : uniqueOptions(blockOptions(entriesOf(actor)));
}

/** Кнопки подсказки «Блок»: «Блок + <заклинание> (ранг)» на каждый вариант (data-af-cb — id слота). */
export const buttons = (actor) => optionsOf(actor).map((o) => cardButton(`data-af-shield-block data-af-cb="${esc(o.id)}"`, L("builtin.channeling.button", { label: esc(o.label) }), "")).join("");

/**
 * Ведущий, перед применением блока: вариант cb ещё доступен -> слот потрачен, эффект pf2e наложен -> эффект (удалить после урона: твёрдость нужна только этому блоку).
 * Нет черты / слота — null (блок идёт без траты).
 */
export async function begin(actor, key, cb) {
  const o = optionsOf(actor).find((x) => x.id === cb);
  let paid = false;
  try { paid = !!o && !!await actor.spellcasting.get(o.entry)?.consume(actor.items.get(o.spell), o.rank, o.slot ?? undefined); } catch (e) { console.warn(`${MOD} | channeling-block.consume`, e); }   // consume бросает ErrorPF2e (нет подходящего слота) — блок идёт без траты
  if (!paid) return null;
  const src = (await fromUuid(EFFECT))?.toObject();
  if (!src) return null;
  delete src._id;
  src.system.level.value = o.rank;
  src.system.context = { ...src.system.context, origin: { actor: actor.uuid, token: null, item: null, spellcasting: null, rollOptions: [] } };
  const eff = await addEffect(actor, src, `channeling-block:${key}`);
  if (eff) await whisper(actor, L("builtin.channeling.done", { name: esc(actor.name), spell: esc(actor.items.get(o.spell)?.name), rank: o.rank, bonus: eff.system.badge?.value ?? "?" }), "shield-block");
  return eff;
}
