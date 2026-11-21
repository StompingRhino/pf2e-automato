// Бонус к Ремеслу для предметов с признаком: Татуировщик (Tattoo Artist) — +1 обстоятельственный к Ремеслу, чтобы Создать татуировку, +2 у мастера Ремесла.
// Правила у черты в pf2e нет, а проверка «Создать» (craft, pf2e.mjs:21597) не несёт признаков создаваемого предмета. Поэтому: какой предмет создаётся —
// запоминаем по клику «Создать» на листе (кнопка craft-item в строке li[data-item-uuid], лист зовёт craft напрямую, мимо game.pf2e.actions)
// и по вызову game.pf2e.actions.craft (макрос, /act); модификатор добавляем в общей точке проверки — game.pf2e.Check.roll при опции action:craft.
// Группа (tools/out/items.json): Tattoo Artist — вычислимо; Specialty Crafting — у pf2e переключатель в окне броска; Schematic Scanner — условие неизвестно.
import { MOD } from "../util.mjs";
import { modeOf } from "../settings.mjs";

/** slug черты -> признак предмета и величина бонуса по рангу Ремесла. */
export const BONUS = { "tattoo-artist": { trait: "tattoo", value: (rank) => (rank >= 3 ? 2 : 1) } };
const TTL = 120000;   // окно проверки может висеть, пока игрок думает

/** Чистая: [{ slug, name }] черт актёра, признаки предмета, ранг Ремесла -> [{ slug, label, value }] модификаторов. */
export function bonusesFor(feats, traits, rank) {
  return feats.filter((f) => BONUS[f.slug] && traits.includes(BONUS[f.slug].trait))
    .map((f) => ({ slug: f.slug, label: f.name, value: BONUS[f.slug].value(rank) }));
}

const pending = new Map();   // uuid актёра -> { uuid предмета, at }
// без предмета (выбор в окне pf2e) — сбросить: иначе бонус пришёл бы от прошлого клика, прерванного до броска
const remember = (actor, uuid) => { if (!actor?.uuid) return; if (uuid) pending.set(actor.uuid, { uuid, at: Date.now() }); else pending.delete(actor.uuid); };

/** Клик «Создать» на листе персонажа: фаза захвата — раньше обработчика листа. */
function onClick(ev) {
  const btn = ev.target?.closest?.("[data-action=craft-item]");
  if (!btn) return;
  const appEl = btn.closest(".application, .app");
  const app = appEl && (foundry.applications.instances.get(appEl.id) ?? ui.windows[appEl.dataset.appid]);
  remember(app?.actor, btn.closest("li")?.dataset.itemUuid);
}

async function addBonus(check, context) {
  const opts = context?.options, actor = context?.actor ?? context?.origin?.actor;
  const has = opts instanceof Set ? opts.has("action:craft") : Array.isArray(opts) && opts.includes("action:craft");
  if (!has || !actor || modeOf("macro") === "off") return;
  const p = pending.get(actor.uuid);
  pending.delete(actor.uuid);
  if (!p || Date.now() - p.at > TTL) return;
  const item = await fromUuid(p.uuid);   // не fromUuidSync: у незагруженного предмета компендиума — запись индекса без признаков
  const traits = item?.system?.traits?.value ?? [];
  for (const b of bonusesFor(actor.itemTypes?.feat ?? [], traits, actor.skills?.crafting?.rank ?? 0)) {
    if (!check.modifiers?.some((m) => m.slug === b.slug)) check.push(new game.pf2e.Modifier({ slug: b.slug, label: b.label, modifier: b.value, type: "circumstance" }));
  }
}

function wrap() {
  const Check = game.pf2e?.Check, roll = Check?.roll;
  if (typeof roll === "function" && !roll[MOD]) {
    const wrapped = async function (check, context = {}, ...rest) {
      try { await addBonus(check, context); } catch (e) { console.error(`${MOD} | craft-bonus`, e); }
      return roll.call(this, check, context, ...rest);
    };
    wrapped[MOD] = true;
    Check.roll = wrapped;
  }
  const craft = game.pf2e?.actions?.craft;
  if (typeof craft === "function" && !craft[MOD]) {
    const wrappedCraft = function (opts = {}) {
      const uuid = opts.item?.uuid ?? opts.uuid;
      for (const a of [opts.actors].flat().filter(Boolean)) remember(a, uuid);
      return craft.call(this, opts);
    };
    wrappedCraft[MOD] = true;
    game.pf2e.actions.craft = wrappedCraft;
  }
  document.addEventListener("click", onClick, true);
}

export function init() { Hooks.once("ready", wrap); }
