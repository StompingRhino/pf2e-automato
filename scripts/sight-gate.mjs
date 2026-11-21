// Эффект «пока вы видите цель» (шаг effect с gate:"sight", Сглаз): потеряла из виду — эффект снимается, вернулась — возвращается.
// «Приостановка» = эффект удаляется с цели (его состояние уходит каскадом), а его данные (с тем же _id, значит откат находит его по uuid) лежат
// на заклинателе в flags.<MOD>.sightDormant до возврата видимости или конца Поддержания. Исполняет только активный ГМ.
// «Видит» = не слеп; цель не невидима (без see-invisibility) / не скрыта (hidden, undetected, unnoticed состоянием или ячейкой PF2e Vision); между токенами нет стены зрения.
// Освещение и дальность не считаем: это решает PF2e Vision (ячейка), без него — ГМ состоянием. Вызовы вне просматриваемой сцены стены не проверяют.
import { MOD, flagPath, forcedDelete, queue, isActiveGM } from "./util.mjs";
import { LEVELS, visionApi } from "./vision.mjs";

const metaOf = (i) => i?.flags?.[MOD]?.meta;
const HIDING = ["hidden", "undetected", "unnoticed"];
const dormantOf = (actor) => actor?.flags?.[MOD]?.sightDormant ?? {};

/** Чистая: видит ли наблюдатель цель. level — ячейка PF2e Vision (или "observed"), conds — состояния цели. */
export function sees({ blinded = false, subjectConds = [], seeInvisible = false, level = "observed", walled = false }) {
  if (blinded || walled) return false;
  if (subjectConds.includes("invisible") && !seeInvisible) return false;
  return !subjectConds.some((c) => HIDING.includes(c)) && LEVELS.indexOf(level) < LEVELS.indexOf("hidden");
}

// конечная точка перемещения по id токена: в v14 x/y документа идут за анимацией (updateToken приходит, пока токен ещё на старом месте)
const dest = new Map();
const centre = (t, size) => { const p = dest.get(t.id) ?? t; return { x: p.x + t.width * size / 2, y: p.y + t.height * size / 2 }; };
const tokenIn = (actor, scene) => actor?.getActiveTokens?.(true, true).find((t) => t.parent === scene) ?? null;
const hasSense = (actor, type) => [...(actor.perception?.senses?.values?.() ?? actor.perception?.senses ?? [])].some((s) => s.type === type);

/** true/false; null — не определить (заклинателя нет на сцене цели): состояние не трогаем. */
export function canSee(observer, subject, scene) {
  const o = tokenIn(observer, scene), s = tokenIn(subject, scene);
  if (!o || !s) return null;
  let walled = false;
  try {
    if (canvas?.scene === scene) walled = !!CONFIG.Canvas.polygonBackends.sight.testCollision(centre(o, scene.grid.size), centre(s, scene.grid.size), { type: "sight", mode: "any" });
  } catch { /* нет холста */ }
  const store = visionApi();
  return sees({
    blinded: !!observer.hasCondition?.("blinded"),
    subjectConds: ["invisible", ...HIDING].filter((c) => subject.hasCondition?.(c)),
    seeInvisible: hasSense(observer, "see-invisibility"),
    level: store ? store.getLevel(s.id, o.id, scene) : "observed",
    walled
  });
}

const gated = (actor) => actor.itemTypes.effect.filter((e) => metaOf(e)?.gate === "sight" && metaOf(e).by);

async function suspend(effect, caster) {
  const data = effect.toObject();
  await queue(`actor:${caster.uuid}`, () => caster.update({ [flagPath("sightDormant", effect.id)]: { actor: effect.actor.uuid, data: JSON.stringify(data) } }));
  await queue(`actor:${effect.actor.uuid}`, () => effect.delete({ [MOD]: { undo: true } }));   // не «снятие эффекта» для events.onItem
}

/** Чистая: возвращать ли приостановленный эффект. card — состояние карточки-источника (null — карточки нет: чистка чата, возвращаем);
 *  карточка есть, но на эффект больше не ссылается — её откатили. held — slug состояний, которые эффект выдаёт (GrantItem); цель сняла их сама,
 *  пока была вне видимости — минимум не возвращает снятое, только не даёт снижать. */
export function shouldRestore({ card, uuid, held = [], has = () => true }) {
  if (card && !JSON.stringify(card).includes(uuid)) return false;
  return held.every((slug) => has(slug));
}

const grantedSlugs = (data) => (data.system?.rules ?? []).filter((r) => r.key === "GrantItem").map((r) => globalThis.fromUuidSync?.(r.uuid)?.slug).filter(Boolean);

async function restore(id, rec, caster) {
  const target = await fromUuid(rec.actor);
  const data = JSON.parse(rec.data), meta = data.flags?.[MOD]?.meta ?? {};
  const card = meta.message ? game.messages.get(meta.message)?.flags?.[MOD]?.use?.state ?? null : null;
  const ok = target && shouldRestore({ card, uuid: `${target.uuid}.Item.${id}`, held: grantedSlugs(data), has: (slug) => target.itemTypes.condition.some((c) => c.slug === slug && !c.grantedBy) });
  if (ok && !target.items.has(id)) {
    delete data.flags?.pf2e?.itemGrants;   // выданное состояние удалено вместе с эффектом: GrantItem выдаст его заново
    await queue(`actor:${target.uuid}`, () => target.createEmbeddedDocuments("Item", [data], { keepId: true, [MOD]: { undo: true } }));   // как suspend: не «новый эффект» для events.onItem
  }
  await queue(`actor:${caster.uuid}`, () => caster.update(forcedDelete(flagPath("sightDormant", id))));
}

/** Сверить все эффекты с gate на сцене: потерянные из виду — приостановить, вернувшиеся — вернуть. */
export function recheck(scene) {
  if (!scene || !isActiveGM()) return Promise.resolve();
  return queue(`sight:${scene.id}`, async () => {
    const actors = scene.tokens.map((t) => t.actor).filter(Boolean);
    for (const target of actors) for (const eff of gated(target)) {
      const caster = await fromUuid(metaOf(eff).by).catch(() => null);
      if (caster && canSee(caster, target, scene) === false) await suspend(eff, caster);
    }
    for (const caster of actors) for (const [id, rec] of Object.entries(dormantOf(caster))) {
      const target = await fromUuid(rec.actor).catch(() => null);
      if (!target) { await caster.update(forcedDelete(flagPath("sightDormant", id))); continue; }   // цели больше нет
      if (tokenIn(target, scene) && canSee(caster, target, scene) !== false) await restore(id, rec, caster);
    }
  }).catch((e) => console.error(`${MOD} | sight-gate`, e));
}

const COND = new Set(["blinded", "invisible", ...HIDING]);
const sceneOf = (actor) => (actor?.token ?? actor?.getActiveTokens?.(true, true)[0])?.parent ?? canvas?.scene;

export function init() {
  Hooks.on("updateToken", (doc, ch) => {
    if ("x" in ch || "y" in ch) dest.set(doc.id, { x: ch.x ?? dest.get(doc.id)?.x ?? doc.x, y: ch.y ?? dest.get(doc.id)?.y ?? doc.y });
    if ("x" in ch || "y" in ch || "width" in ch || "height" in ch || ch.flags?.["pf2e-vision"]) recheck(doc.parent);
  });
  Hooks.on("deleteToken", (doc) => dest.delete(doc.id));
  Hooks.on("deleteScene", (scene) => { for (const t of scene.tokens) dest.delete(t.id); });   // токены удалённой сцены deleteToken не присылают
  Hooks.on("canvasReady", (c) => recheck(c.scene));   // стены проверяются только на просматриваемой сцене: ГМ перешёл — пересчитать
  for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => {
    const f = item.type === "condition" ? COND.has(item.slug) : item.type === "effect" && metaOf(item)?.gate;
    if (f) recheck(sceneOf(item.actor));
  });
  for (const h of ["createWall", "updateWall", "deleteWall"]) Hooks.on(h, (wall) => recheck(wall.parent));
  // конец Поддержания: приостановленные записи этого заклинания больше не нужны
  Hooks.on("deleteItem", (item) => {
    const key = metaOf(item)?.source === "sustain" && metaOf(item).key;
    const caster = item.actor;
    if (!key || !caster || !isActiveGM()) return;
    for (const [id, rec] of Object.entries(dormantOf(caster))) {
      let sustainOf = null;
      try { sustainOf = metaOf({ flags: JSON.parse(rec.data).flags })?.sustainOf; } catch { /* битая запись */ }
      if (sustainOf === key) queue(`actor:${caster.uuid}`, () => caster.update(forcedDelete(flagPath("sightDormant", id)))).catch(() => {});
    }
  });
}
