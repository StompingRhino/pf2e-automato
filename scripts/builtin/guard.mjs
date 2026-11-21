// «Древо-защитник» (Protector Tree, Тимбер-страж): соседнее дерево принимает урон Удара, попавшего по союзнику заклинателя.
// pf2e этого не делает (grep по pf2e.mjs: ничего). Дерево — токен-объект с флагом summoned.guard (summon.mjs, вариант object).
// Урон дереву — штатный applyDamage с final (свой откат pf2e); цели остаётся остаток: вычитание по экземплярам (damage-math.mjs).
import { L, MOD, queue, callGM } from "../util.mjs";
import { modeOf } from "../settings.mjs";
import { esc, whisper } from "./lib.mjs";
import { subtractDamage } from "./damage-math.mjs";
import { subscribe } from "./apply-hook.mjs";

export const GUARD_OPTION = "af:guard";   // урон дереву: сам не перехватывается
const HITS = new Set(["success", "criticalSuccess"]);

/** Чистая: Удар — оружие или естественная атака, не заклинание. */
export const isStrike = (item, options) => ["weapon", "melee"].includes(item?.type) && !new Set(options ?? []).has("item:type:spell");

/** Чистая: попадание; без броска атаки (null) — тоже попадание. */
export const isHit = (outcome) => outcome == null || HITS.has(outcome);

export const guardOf = (tokenDoc) => {
  const s = tokenDoc?.flags?.[MOD]?.summoned;
  return s?.kind === "object" && s.guard ? s : null;
};

/**
 * Чистая: какое дерево прикроет цель. trees: [{id, hp, by, guard:{adjacent, alliance}, rect}], target: {id, alliance, actorUuid, rect}, dist(a, b) -> фт.
 * Союзник заклинателя (не он сам), дерево соседнее и живое; несколько — с большим остатком ПЗ, при равенстве меньший id.
 */
export function pickTree(trees, target, dist) {
  const ok = trees.filter((t) => t.id !== target.id && t.hp > 0 && t.guard?.alliance != null && t.guard.alliance === target.alliance
    && target.actorUuid !== t.by && dist(t.rect, target.rect) <= (t.guard.adjacent ?? 5));
  return ok.sort((a, b) => b.hp - a.hp || (a.id < b.id ? -1 : 1))[0] ?? null;
}

/** Чистая: сколько дерево примет. */
export const absorbOf = (total, hp) => Math.max(0, Math.min(total, hp));

async function pickFor(target) {
  const scene = target?.parent, actor = target?.actor;
  if (!scene || !actor || guardOf(target)) return null;
  const { distanceFt, rectCell } = await import("../summon.mjs");   // ленивый импорт: summon тянет много модулей
  const g = scene.grid.size, ft = scene.grid.distance || 5;
  const trees = scene.tokens.filter((t) => guardOf(t) && t.actor).map((t) => ({ id: t.id, doc: t, hp: t.actor.system.attributes.hp.value, by: guardOf(t).by, guard: guardOf(t).guard, rect: rectCell(t, g) }));
  const tree = pickTree(trees, { id: target.id, alliance: actor.alliance ?? null, actorUuid: actor.uuid, rect: rectCell(target, g) }, (a, b) => distanceFt(a, b, ft));
  return tree?.doc ?? null;
}

const hpOf = (t) => t.actor.system.attributes.hp.value;

/** ГМ: дерево берёт на себя урон Удара по цели. -> {absorbed, treeName, left} | null. Очередь одна на все деревья: дерево — общий ресурс. */
export function take(targetUuid, total) {
  return queue("guard", async () => {
    const target = await fromUuid(targetUuid), tree = await pickFor(target);
    const absorbed = tree ? absorbOf(total, hpOf(tree)) : 0;
    if (!(absorbed > 0)) return null;
    await tree.actor.applyDamage({ damage: absorbed, token: tree, final: true, rollOptions: new Set([GUARD_OPTION]) });
    return { absorbed, treeName: tree.name, left: Math.max(0, hpOf(tree)) };
  });
}

/** Чистая: сумма непродолжительных экземпляров — то, что увидит нанесение. Минимум 1 урона у pf2e (d.total=1 при пустых экземплярах) сюда не входит. */
export function strikeTotal(d) {
  if (typeof d === "number") return d;
  const insts = d?.instances;
  if (!insts?.length) return d?.total ?? 0;
  return insts.reduce((n, i) => n + (i.persistent || !(i.total > 0) ? 0 : i.total), 0);
}

/** Общий предикат: Удар-попадание, режим макросов включён, рядом есть деревья, урон >0. -> сумма для дерева или 0. Дерево-цель и урон дерева отсеивает onApply. */
function guardTotal({ item, options, outcome, damage }, token) {
  const total = strikeTotal(damage);
  if (modeOf("macro") === "off" || !(total > 0) || !token?.parent?.tokens?.some?.((t) => guardOf(t)) || !isStrike(item, options) || !isHit(outcome)) return 0;
  return total;
}

/** Шёпот-подсказка Блока щитом: дерево покрывает весь урон — блок не нужен. message — карточка урона pf2e, token — токен цели. */
export async function coversAll(message, token) {
  const ctx = message?.flags?.pf2e?.context;
  const total = guardTotal({ item: message?.item, options: ctx?.options, outcome: ctx?.outcome, damage: message?.rolls?.[0] }, token);
  if (!total) return false;
  const tree = await pickFor(token);
  return !!tree && hpOf(tree) >= total;
}

/** Подписчик apply-hook: после damaged, до shield-block. */
async function onApply(actor, opts) {
  const token = opts?.token?.document ?? opts?.token;
  if (!token?.parent || opts.final || opts.skipIWR || opts.rollOptions?.has?.(GUARD_OPTION)) return;
  const total = guardTotal({ item: opts.item, options: opts.rollOptions, outcome: opts.outcome, damage: opts.damage }, token);
  if (!total) return;
  const res = await callGM("guardTake", token.uuid, total);
  const r = res?.ok ? res.result : null;
  if (!(r?.absorbed > 0)) return;
  whisper(actor, L("builtin.guard.card", { tree: esc(r.treeName), n: r.absorbed, name: esc(token.name), left: r.left }), "guard").catch((e) => console.warn(`${MOD} | guard whisper`, e));
  return { opts: { ...opts, damage: subtractDamage(opts.damage, r.absorbed) } };
}

export const install = () => subscribe(onApply);
