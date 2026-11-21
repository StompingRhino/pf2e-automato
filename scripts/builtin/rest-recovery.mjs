// Отдых на ночь: способности «снижайте состояние на 2 вместо 1». pf2e (restForTheNight, pf2e.mjs:25877) снижает каждое на 1 и зовёт хук
// pf2e.restForTheNight(actor) — модуль снимает ещё 1 с того, что осталось. Без модуля поведение pf2e прежнее.
// Группа (корпус tools/out/items.json): Dream May (истощение, обречённость), Fast Recovery (истощение). Условные — Magpie Manor Recovery (палатка),
// Native Waters (природный водоём) — условие модуль не вычислит, не входят (limitations.md).
import { MOD, L } from "../util.mjs";
import { modeOf } from "../settings.mjs";
import { whisper, esc } from "./lib.mjs";

/** slug способности -> состояния, которые отдых снижает ещё на 1. */
export const EXTRA = { "dream-may": ["drained", "doomed"], "fast-recovery": ["drained"] };

/** Чистая: [{ item, slugs }] -> { slug: [имена способностей] } — каждое состояние снимается ещё на 1 один раз, сколько бы способностей его ни давали. */
export function extraPlan(owned) {
  const out = {};
  for (const { item, slugs } of owned) for (const s of slugs) (out[s] ??= []).push(item);
  return out;
}

async function onRest(actor) {
  if (modeOf("macro") === "off" || actor?.type !== "character" || !actor.isOwner) return;
  const owned = actor.itemTypes.feat.filter((f) => EXTRA[f.slug]).map((f) => ({ item: f.name, slugs: EXTRA[f.slug] }));
  const plan = extraPlan(owned), lines = [];
  for (const [slug, by] of Object.entries(plan)) {
    const c = actor.getCondition(slug);
    if (!c) continue;   // pf2e уже снял (было 1)
    const left = (c.value ?? 1) - 1;
    await actor.decreaseCondition(slug);
    lines.push(L(left > 0 ? "builtin.rest.reduced" : "builtin.rest.removed", { item: esc([...new Set(by)].join(", ")), condition: esc(game.pf2e.ConditionManager.getCondition(slug)?.name ?? c.name), value: left }));
  }
  if (lines.length) await whisper(actor, lines.join(""), "rest");
}

export function init() {
  Hooks.on("pf2e.restForTheNight", (actor) => { onRest(actor).catch((e) => console.error(`${MOD} | rest-recovery`, e)); });
}
