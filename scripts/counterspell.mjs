// Контрзаклинание (M4, docs/plan-counterspell-tkmaneuver-hplink.md): реакция «срывает» чужое сотворение, пока его карточка удержана (hold.mjs, причина "counter").
// Поток: preCreate (клиент создателя) удерживает карточку, если на сцене есть кандидат -> createChatMessage (активный ГМ) обходит кандидатов по расстоянию:
// окно владельцу -> трата реакции -> карточка проверки (events.hostChallenge) -> итог (saves.afterRecord -> onResult): сорвано (cancel) | следующий кандидат | выпуск (release).
// Один успех завершает цепочку. Трата ячейки (counter.expend, M4.9): кандидат без подходящей ячейки отсекается молча, тратит её run перед реакцией (spend(pay)); шаги apply записи с counter не исполняются.
import { MOD, L, DEGREES, flagPath, isActiveGM, queue } from "./util.mjs";
import { modeOf } from "./settings.mjs";
import * as compat from "./compat.mjs";
import * as rules from "./rules.mjs";
import * as apply from "./apply.mjs";
import * as hold from "./hold.mjs";
import * as events from "./events.mjs";
import { reactionAvailable } from "./reactions.mjs";
import * as checks from "./checks.mjs";
import { whyNot } from "./builtin/impulse-gate.mjs";
import { nearRadius, insideAura, auraFeet, rectOf } from "./aura.mjs";
import { spellDcOf } from "./familiar.mjs";
import { levelDc } from "./cast.mjs";
import { messageTargets, esc, whisper } from "./builtin/lib.mjs";
import { card } from "./card.mjs";
import { blockOptions, uniqueOptions, entriesOf } from "./slots.mjs";

/** Окно решения владельцу: короче страховки hold.COUNTER_STUCK_MS (она перезапускается перед каждым кандидатом). */
export const WINDOW_MS = 30_000;

/* ---------- чистое ---------- */

/**
 * Исход противодействия по pf2e rollCounteract (pf2e.mjs:53801): степень 0..3 (крит. провал..крит. успех), counterRank — ранг контр-эффекта, targetRank — ранг заклинания.
 * крит. провал — не сорвано; провал — ранг заклинания ниже контр-ранга; успех — не выше контр-ранга +1; крит. успех — не выше +3.
 * -> { counteracted, maxRank } maxRank — наибольший ранг, который этот исход ещё срывает (null — никакого).
 */
export function counteractOutcome({ degree, counterRank, targetRank }) {
  const maxRank = [null, counterRank - 1, counterRank + 1, counterRank + 3][degree] ?? null;
  return { counteracted: maxRank !== null && targetRank <= maxRank, maxRank };
}

/** Ранг заклинания-триггера: ранг сотворения (усиленное), иначе ранг предмета. */
export const targetRankOf = (message) => message?.flags?.pf2e?.origin?.castRank ?? message?.item?.rank ?? 1;

/** Контр-ранг записи: число или {half:"actor"} — половина уровня владельца вверх (минимум 1). */
export const counterRankOf = (counter, actor) => (counter?.rank?.half === "actor" ? Math.max(1, Math.ceil((actor?.level ?? 0) / 2)) : counter?.rank);

/** Строка «Триггер» из описания предмета (условия, которые модуль не вычисляет, решает владелец): текст источника, не пересказ. */
export function triggerText(item) {
  const m = /<strong>\s*(?:Trigger|Триггер|Условие)\s*<\/strong>\s*([\s\S]*?)(?=<hr|<strong>|<\/p>|$)/i.exec(item?.system?.description?.value ?? "");
  return m ? m[1].replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, "$1").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
}

/** slug заклинания-триггера: предмет карточки, иначе опция origin:item:slug:* pf2e. */
export const spellSlugOf = (message) => message?.item?.slug ?? message?.flags?.pf2e?.origin?.rollOptions?.find((o) => o.startsWith("origin:item:slug:"))?.slice(17) ?? null;

/**
 * Опции предиката `when` записи counter (то, что модуль вычисляет сам, без вопроса): расстояние и стены — в candidates; здесь — черты заклинания
 * (origin:item:trait:*, из origin.rollOptions pf2e), враг/союзник (origin:ally|enemy — заклинатель относительно владельца), цель:
 * spell-cast:targets-self-only (единственная цель — владелец), spell-cast:targets-me-or-ally:N (владелец или союзник владельца не дальше N фт от него; N — из when),
 * spell-cast:prepared (заклинание подготовлено у владельца: «a spell X has prepared») и spell-cast:known (есть в записи колдовства: «knows», «in its repertoire») —
 * это условие триггера, а не то, что тратится (оно — counter.expend).
 * targets — токены целей сотворения (messageTargets); when — предикат(ы) записей владельца.
 */
export function counterOptions({ message, owner, ownerToken, caster, targets = [], when = null }) {
  const set = new Set(["target", ...(caster?.getSelfRollOptions?.("target") ?? []), ...(owner?.getSelfRollOptions?.("self") ?? []), ...(message?.flags?.pf2e?.origin?.rollOptions ?? [])]);
  if (owner?.alliance && caster?.alliance) set.add(`origin:${owner.alliance === caster.alliance ? "ally" : "enemy"}`);
  const mine = (t) => t.id === ownerToken?.id || (!!t.actor && t.actor.uuid === owner?.uuid);
  if (targets.length === 1 && mine(targets[0])) set.add("spell-cast:targets-self-only");
  const wanted = JSON.stringify(when ?? []), slug = /spell-cast:(?:prepared|known)/.test(wanted) ? spellSlugOf(message) : null;
  if (slug) {
    const own = entriesOf(owner).flatMap((e) => e.spells.filter((s) => s.slug === slug).map((s) => ({ e, s })));
    if (own.length) set.add("spell-cast:known");
    if (own.some(({ e, s }) => e.prepared && (e.flexible ? s.signature || s.cantrip : e.mode !== "prepared" || s.cantrip || Object.values(e.slots).some((r) => r?.prepared?.some((p) => p?.id === s.id))))) set.add("spell-cast:prepared");
  }
  const unit = ownerToken?.parent?.grid?.distance || 5;
  for (const [, n] of JSON.stringify(when ?? []).matchAll(/spell-cast:targets-me-or-ally:(\d+)/g)) {
    const near = (t) => !!owner.alliance && t.actor?.alliance === owner.alliance && insideAura(Number(n), rectOf(ownerToken), rectOf(t), unit);
    if (targets.some((t) => mine(t) || near(t))) set.add(`spell-cast:targets-me-or-ally:${n}`);
  }
  return set;
}

/**
 * Последствия записи по степеням карточки проверки (оба ранга известны при создании): onCounter — степени, где заклинание сорвано, onFail — где нет
 * (степень или ранг заклинания выше); иммунитет — только по степеням «не сорвано» (успех без срыва, когда ранг выше, тоже даёт его).
 * -> { byDegree, immunity|null } — готовые поля check.byDegree / check.immunity обычной карточки проверки.
 */
export function stepsByDegree(c, counterRank, targetRank) {
  const byDegree = {}, miss = [];
  DEGREES.forEach((name, degree) => {
    const { counteracted } = counteractOutcome({ degree, counterRank, targetRank }), steps = (counteracted ? c.onCounter : c.onFail) ?? [];
    if (steps.length) byDegree[name] = structuredClone(steps);
    if (!counteracted) miss.push(name);
  });
  return { byDegree, immunity: c.immunity ? { ...c.immunity, ...(miss.length < DEGREES.length && { degrees: miss }) } : null };
}

/** Частота записи (system.frequency, «1/день») исчерпана или другой общий лимит предмета (impulse-gate LIMITS) не пускает; режим лимитов off — не проверяем. */
export function exhausted(owner, item) {
  if (modeOf("limits") === "off") return false;
  try { return !!whyNot(owner, item); } catch (e) { console.warn(`${MOD} | counterspell.exhausted`, e); return false; }   // не смогли проверить — не блокируем (ложный блок хуже пропуска)
}

/**
 * Списание частоты (pf2e списывает её только в createUseActionMessage, а здесь предмет не используется): вызывается из spend() по свежему значению.
 * Метка pf2eAutomato — не «использование» для limits (onPreUpdateItem). В журнал не пишется: частота при «Вернуть» не возвращается — реакция использована.
 */
export async function chargeFrequency(item) {
  const f = item?.system?.frequency;
  if (!f || modeOf("limits") === "off") return true;   // лимиты выключены: частоту не списываем (как exhausted не проверяет)
  if (!(f.value > 0)) return false;   // на нуле списывать нечего — отказ, а не «успех»
  await item.update({ "system.frequency.value": f.value - 1 }, { pf2eAutomato: true });
  return true;
}

/**
 * Синхронная бронь частоты по предмету: между проверкой (exhausted) и списанием есть await, два «да» подряд иначе проходят обе проверки.
 * Вызывать до первого await; снять через unreserve (после списания или отказа). Предмет без частоты не бронируется.
 */
const booked = new Set();
export function reserve(owner, item) {
  if (exhausted(owner, item)) return false;
  const f = item?.system?.frequency;
  if (!f || modeOf("limits") === "off") return true;
  if (!(f.value > 0)) return false;   // exhausted не видит частоту turn/round вне боя: отказ до траты реакции, не после
  if (booked.has(item.uuid)) return false;
  booked.add(item.uuid);
  return true;
}
export const unreserve = (item) => { booked.delete(item?.uuid); };

/* ---------- ячейка (counter.expend) ---------- */

const TRADITIONS = ["arcane", "divine", "occult", "primal"];

/**
 * Что владелец может потратить по counter.expend для этого сотворения: варианты по паре (запись колдовства, ранг) — игроку важен ранг (он даёт контр-ранг), а какую
 * копию подготовленного сжечь, нет (первый неистраченный слот). Запись — подготовленная/спонтанная; черта традиции у способности (PC-Counterspell) — только записи этой традиции.
 * spell: same — по slug сорванного, any — любое, {slug}, {trait}; rank: same — ранг ячейки равен рангу сорванного, min — не ниже; from: prepared — isPrepared (и «гибкая»), slot — спонтанная.
 * -> [{id, entry, spell, rank, slot, label}]
 */
export function slotChoices(owner, item, expend, message) {
  const sp = expend.spell, slug = spellSlugOf(message), target = targetRankOf(message), tr = TRADITIONS.filter((t) => item?.system?.traits?.value?.includes(t));
  const entries = entriesOf(owner).filter((e) => (!tr.length || tr.includes(e.tradition)) && (expend.from == null || (expend.from === "prepared") === e.prepared));
  const want = sp === "any" ? () => true : sp === "same" ? (s) => !!slug && s.slug === slug : sp.slug ? (s) => s.slug === sp.slug : (s) => s.traits.includes(sp.trait);
  const rankOk = !expend.rank ? () => true : expend.rank === "same" ? (r) => r === target : (r) => r >= target;
  const label = (e, s, r) => L(e.mode === "prepared" ? "events.counter.payPrepared" : "events.counter.paySlot", { spell: s.name, rank: r, entry: e.name });
  return uniqueOptions(blockOptions(entries, label, { want, rankOk, anyRank: sp === "any" }), (o) => `${o.entry}:${o.rank}`);
}

/* ---------- кандидаты ---------- */

const UNIT_MS = { rounds: 6_000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
/**
 * Slug-иммунитеты (scope "slug": «к способности любого автора»), которые заклинатель уже заработал, но эффекта на нём ещё нет: исход «не сорвано» записан
 * (state.counter.done), а сам эффект ставится кнопкой «Применить» (mode.apply=button). Иммунитет — ограничение (§1.1) и действует сразу, не дожидаясь её,
 * для ЛЮБОГО сотворения этого заклинателя, пока не истёк срок (по реальному времени карточки, ponytail: мировое время карточка не хранит).
 * Применённые карточки пропускаем — их эффект видит hasImmunity; «Вернуть» (reverted) исход отменил; откат применения ГМом (challenge.undone) — тоже. Один проход по сообщениям на отбор. now — для тестов.
 */
export function settledImmunities(caster, now = Date.now()) {
  const out = new Set();
  for (const m of game.messages.contents) {
    const u = m.flags?.[MOD]?.use, c = u?.state?.counter, imm = u?.rule?.onUse?.check?.immunity;
    if (!c?.done || c.reverted || imm?.scope !== "slug" || c.caster?.actor !== caster?.uuid || Object.keys(u.state.challenge?.applied ?? {}).length || Object.keys(u.state.challenge?.undone ?? {}).length) continue;
    if (!checks.immunityAt(imm, c.degree)) continue;
    const ms = (imm.duration?.value ?? 0) * (UNIT_MS[imm.duration?.unit] ?? Infinity);
    if (now - (m.timestamp ?? now) < ms) out.add(imm.slug);
  }
  return out;
}

const warned = new Set();
/** Статистика "counteract" pf2e берёт у записей колдовства и без них падает (reduce пустого): у актёра без записи кандидата нет, ГМу — один раз шёпот. */
export function canCounteract(owner, c) {
  if (c?.expend || c?.mod != null || (c?.statistic ?? "counteract") !== "counteract") return true;   // с ячейкой проверка — counteraction потраченной записи: запись и есть источник
  let ok = false;
  try { ok = !!owner.spellcasting?.some?.((e) => e.counteraction); } catch { /* нет записи */ }
  if (!ok && isActiveGM() && !warned.has(owner.uuid)) {
    warned.add(owner.uuid);
    whisper(owner, L("events.counter.noEntry", { name: esc(owner.name) }), null, {}, "", "gm")?.catch?.(() => {});
  }
  return ok;
}

/**
 * Токены сцены, которые могут сорвать это сотворение: запись counter с подходящими расстоянием/стеной и when, реакция доступна, не сам заклинатель.
 * -> [{ owner, token, found, i, entry, options, dist }] по возрастанию расстояния. Сотворение — карточка заклинания (events.eventOfMessage).
 */
export function candidates(message) {
  if (events.eventOfMessage(message) !== "spell-cast") return [];
  const caster = message.actor, cTok = message.token;
  if (!caster || !cTok?.parent) return [];
  const scene = cTok.parent, unit = scene.grid?.distance || 5, targets = messageTargets(message), out = [], settled = settledImmunities(caster);
  for (const t of scene.tokens) {
    const owner = t.actor;
    if (!owner || t.id === cTok.id || owner.uuid === caster.uuid || owner.isDead || owner.isOfType?.("creature") === false || !reactionAvailable(owner)) continue;
    for (const found of events.eventItems(owner)) {
      const wl = found.rule.onEvent.filter((e) => e.counter);
      if (!wl.length || compat.shouldYield(found.rule, { slug: rules.slugOf(null, found.item), sourceUuid: rules.sourceOf(null, found.item) })) continue;
      const options = counterOptions({ message, owner, ownerToken: t, caster, targets, when: wl.map((e) => e.when) });
      for (const { i, entry } of events.matchEntries(found.rule, "spell-cast", "near", options)) {
        const radius = entry.counter ? nearRadius(entry, t) : null;
        if (radius == null || exhausted(owner, found.item) || (entry.counter.immunity && (checks.hasImmunity(caster, entry.counter.immunity, owner.uuid) || settled.has(entry.counter.immunity.slug))) || !canCounteract(owner, entry.counter) || (entry.counter.expend && !slotChoices(owner, found.item, entry.counter.expend, message).length)) continue;   // частота исчерпана, заклинатель иммунен, нет подходящей ячейки — молча, как «реакция потрачена»
        const [a, b] = [rectOf(t), rectOf(cTok)];
        if (insideAura(radius, a, b, unit) && !events.wallBlocked(t, a, b)) out.push({ owner, token: t, found, i, entry, options, dist: auraFeet(a, b, unit) });
      }
    }
  }
  return out.sort((x, y) => x.dist - y.dist);
}

/** Удержание имеет смысл при активном ГМ и работающих проверках/шагах: иначе окно и карточка проверки не откроются (тишина, реакция цела). */
export const counterEnabled = (gm = !!game.users?.activeGM) => gm && modeOf("challenge") !== "off" && modeOf("effect") !== "off";

/** preCreateChatMessage на клиенте создателя: карточка сотворения рождается удержанной, только если есть кандидат; нет — карточку не трогаем. Сомнение — не удерживаем. */
export function onPreCreate(message) {
  try { if (counterEnabled() && !hold.isHeld(message) && candidates(message).length) events.markCounterHold(message); }
  catch (e) { console.warn(`${MOD} | counterspell.onPreCreate`, e); }
}

/* ---------- диспетчер ---------- */

/**
 * Следующий кандидат удержанного сотворения id (очередь counter:<id>): окно -> реакция -> карточка проверки (дальше — onResult); отказ/нет — следующий;
 * кандидаты кончились — выпуск. Уже спросённые кандидаты отсекает дедуп runEntry (fired и журнал events карточки). deps — для тестов.
 */
export async function advance(id, { run = events.runEntry, list = candidates } = {}) {
  let cast = game.messages.get(id);
  if (!cast || !hold.isCounterHold(cast) || hold.hostOf(cast)) return;   // решено / проверка уже ждёт броска
  for (const c of list(cast)) {
    cast = game.messages.get(id);
    if (!cast || !hold.isCounterHold(cast)) return;   // пока ждали окно, ГМ решил вручную
    hold.armCounter(cast);   // страховочный таймер — заново: окно предыдущего кандидата его уже проело
    const log = [], ev = { id, key: events.entryKey(id, c.found.item.uuid, c.i), message: cast, options: c.options, other: cast.actor, otherToken: cast.token, ownerToken: c.token };
    try { await run(ev, c.owner, c.found, { i: c.i, entry: c.entry }, log); } catch (e) { console.error(`${MOD} | counterspell ${c.found.item.name}`, e); }
    const recs = log.filter((r) => r.recs?.length || r.host);
    if (recs.length) await cast.update({ [flagPath("events")]: [...(cast.flags?.[MOD]?.events ?? []), ...recs] }).catch((e) => console.warn(`${MOD} | counterspell.log`, e));
    if (hold.hostOf(game.messages.get(id) ?? cast)) return;   // карточка проверки создана: исход — onResult
  }
  const now = game.messages.get(id);
  if (now && hold.isCounterHold(now)) await hold.resolveManual(id, "release");
}

/** createChatMessage (активный ГМ): удержанная карточка сотворения -> обход кандидатов. Ручное удержание (gate.manual, живые сценарии) не трогаем. */
export async function onCreate(message) {
  if (!isActiveGM() || !hold.isCounterHold(message) || message.flags?.[MOD]?.gate?.manual) return;
  await queue(`counter:${message.id}`, () => advance(message.id));
}

/**
 * Ветка counterspell в events.execEntry: окно владельцу (его игрок, иначе ведущий) -> spend() реакции -> карточка проверки.
 * Модификатор — плоский mod записи либо статистика владельца (counteract / spell-attack / навык); СЛ — СЛ заклинания-триггера (ГМ правит кнопкой «СЛ»).
 * counter.expend: варианты ячейки (slotChoices) считаются перед окном (нет ни одного — тихий null: кандидат прождал очередь), игрок выбирает кнопкой/строкой окна,
 * ячейка тратится внутри spend(pay) раньше реакции; контр-ранг — counter.rank ?? ранг ячейки, проверка без mod/statistic — counteraction записи потраченной ячейки (check.entry).
 * -> id карточки проверки | null (отказ, закрытое окно, реакция недоступна, нет ячейки)
 */
export async function run({ ev, owner, item, entry, key, spend, build, ask = apply.askChoice }) {
  const cast = ev.message, spell = cast?.item, c = entry.counter, caster = ev.other;
  const held = () => hold.isCounterHold(game.messages.get(cast?.id));   // ГМ выпустил/отменил или сработала страховка, пока ждало окно — реакцию не тратим
  if (!held()) return null;
  const choices = c.expend ? slotChoices(owner, item, c.expend, cast) : null;
  if (choices && !choices.length) return null;   // ячейку потратили, пока кандидат ждал очередь: окна нет, реакция цела
  const targetRank = targetRankOf(cast), spellName = spell?.name ?? cast?.flags?.pf2e?.origin?.name ?? "";
  const cond = triggerText(item);
  const pay = choices?.length === 1 ? ` ${L("events.counter.expends", { what: choices[0].label })}` : choices ? ` ${L("events.counter.choose")}` : "";
  const prompt = `${L("events.counter.prompt", { item: item.name, spell: spellName, caster: caster?.name ?? "", rank: targetRank })}${pay}${cond ? ` ${L("events.counter.trigger", { text: cond })}` : ""}`;
  const buttons = choices?.length > 1 ? choices.map((o) => ({ value: o.id, label: L("events.counter.pick", { what: o.label }) })) : [{ value: "yes", label: L("events.counter.use") }];
  const yes = await ask(apply.ownerPlayer(owner), item.name, prompt, buttons, WINDOW_MS);
  const pick = choices?.length > 1 ? choices.find((o) => o.id === yes) : choices?.[0];
  let paid = null;
  const payIt = async () => {   // свежие данные: выбранной ячейки могли лишить между окном и «да» — берём ту же пару (запись, ранг), иначе отказ до траты реакции
    const o = slotChoices(owner, item, c.expend, cast).find((x) => x.entry === pick.entry && x.rank === pick.rank), e = o && owner.spellcasting?.get(o.entry);
    const prev = o?.slot == null ? e?.system?.slots?.[`slot${o?.rank}`]?.value : null;
    let ok = false;
    try { ok = !!e && !!(await e.consume(owner.items.get(o.spell), o.rank, o.slot ?? undefined)); } catch (err) { console.warn(`${MOD} | counterspell.consume`, err); }   // consume бросает ErrorPF2e, если слота нет
    if (!ok) { whisper(owner, L("events.counter.noSlot", { item: esc(item.name) }))?.catch?.(() => {}); return null; }
    paid = o;
    return { op: "slotExpended", actor: owner.uuid, entry: o.entry, rank: o.rank, slot: o.slot ?? null, spell: o.spell, prev };
  };
  if (yes == null || (choices && !pick) || !held() || !(await (choices ? spend(payIt, held) : spend()))) return null;
  const counterRank = counterRankOf(c, owner) ?? paid?.rank;
  const dc = spellDcOf(spell) ?? levelDc(caster?.level ?? 0);   // нет записи колдовства (врождённое без записи) — СЛ по уровню, ГМ поправит
  // цель карточки остаётся владельцем (права строки проверки, сокеты и скрытые итоги — как у любой проверки автора); заклинатель — получатель to:"target", его токен лежит в state.counter.caster (saves.applyByDegree)
  const { byDegree, immunity } = stepsByDegree(c, counterRank, targetRank);
  const check = { statistic: c.statistic ?? "counteract", label: item.name, ...(c.mod != null && { mod: c.mod }), ...(paid && c.mod == null && c.statistic == null && { entry: paid.entry }), vs: { dc }, rollerRole: "author", basic: false, byDegree, ...(immunity && { immunity }) };
  return events.hostChallenge({
    owner, other: owner, otherToken: ev.ownerToken, rowName: caster?.name, check, dc, key, name: item.name, build, text: "events.counter.host", castRank: targetRank,   // castRank: формулы шагов (@item.rank) берут ранг сорванного заклинания
    vars: { spell: esc(spellName), caster: esc(caster?.name ?? ""), dc, counterRank, rank: targetRank },
    counter: { cast: cast.id, counterRank, targetRank, spell: spellName, by: { item: item.name, actor: owner.name }, caster: { token: (ev.otherToken ?? cast.token)?.uuid ?? null, actor: caster?.uuid ?? null } }
  });
}

/**
 * Итог проверки (saves.afterRecord): степень -> counteractOutcome. Сорвано — cancel (карточка без кнопок, плашка «Сорвано: …»), иначе следующий кандидат (или release).
 * Идемпотентно (state.counter.done); решённое вручную сотворение (нет удержания) не трогаем. deps.next — для тестов.
 */
export async function onResult(hostId, { next = advance, apply: applyConsequences = null } = {}) {
  if (!isActiveGM()) return;
  const first = game.messages.get(hostId)?.flags?.[MOD]?.use?.state?.counter;
  if (!first) return;
  return queue(`counter:${first.cast}`, async () => {
    const host = game.messages.get(hostId), st = host?.flags?.[MOD]?.use?.state, c = st?.counter, r = Object.values(st?.challenge?.results ?? {})[0];
    if (!c || !r) return;
    if (c.done) {   // переброс (очко героя, fortune) после исхода: решённое не переигрываем, ГМ решает сам
      if (r.degree === c.degree) return;
      const was = counteractOutcome({ degree: c.degree, counterRank: c.counterRank, targetRank: c.targetRank }).counteracted;
      const now = counteractOutcome({ degree: r.degree, counterRank: c.counterRank, targetRank: c.targetRank }).counteracted;
      await host.update({ [flagPath("use", "state", "counter", "degree")]: r.degree, ...(now && c.reverted && { [flagPath("use", "state", "counter", "reverted")]: false }) });   // переброс снова срывает: после «Отменить» последствия можно применить
      const played = game.messages.get(c.cast)?.flags?.[MOD]?.gate?.replayed === true;   // сотворение уже исполнено: «Отменить» нет, «Вернуть» не нужно
      if (was === now || (played && !now)) return;
      const key = now ? (played ? "events.counter.rerollLate" : "events.counter.rerollYes") : "events.counter.rerollNo";
      await whisper(null, L(key, { item: esc(c.by.item), spell: esc(c.spell), total: r.total }), null, {}, "", "gm");
      return;
    }
    // метка — от записи done до cancel/next: hostOf решённую карточку уже не видит, и страховка (таймер, sweep) не должна выпустить сотворение в любой точке этого блока
    return hold.whileApplying(c.cast, async () => {
    await host.update({ [flagPath("use", "state", "counter")]: { done: true, degree: r.degree } });
    const cast = game.messages.get(c.cast);
    if (!cast || !hold.isCounterHold(cast)) return;
    const out = counteractOutcome({ degree: r.degree, counterRank: c.counterRank, targetRank: c.targetRank });
    // публичная карточка — метаигра pf2e как в chat.mjs: итог и степень по metagame.results, СЛ по metagame.dcs (СЛ заклинателя-PC видна всегда); исход виден всем
    const meta = game.pf2e?.settings?.metagame, dcShown = !!meta?.dcs || !!fromUuidSync(c.caster?.actor)?.hasPlayerOwner;
    const detail = meta?.results ? L("events.counter.resultDetail", {
      total: r.total, dc: dcShown ? L("events.counter.resultDc", { dc: r.dc ?? host.flags[MOD].use.dc ?? "?" }) : "", degree: game.i18n.localize(`PF2E.Check.Result.Degree.Check.${DEGREES[r.degree]}`), counterRank: c.counterRank, rank: c.targetRank
    }) : "";
    const text = L(out.counteracted ? "events.counter.resultYes" : "events.counter.resultNo", { item: esc(c.by.item), spell: esc(c.spell), detail });
    await ChatMessage.create({ speaker: { alias: c.by.item }, content: card(text, "", { title: esc(c.by.item), icon: "fa-wand-sparkles" }) });
    // последствия (шаги onCounter/onFail, иммунитет) — обычное применение по степеням карточки проверки; done уже записан, hostOf её не видит — поэтому явная метка whileApplying (страховка не выпустит сотворение посреди применения)
    if (applyConsequences) await applyConsequences().catch((e) => console.error(`${MOD} | counterspell.apply`, e));
    if (out.counteracted) await hold.resolveManual(c.cast, "cancel", c.by);
    else await next(c.cast);
    });
  });
}

/**
 * «Вернуть» сорванное сотворение (hold.resolveManual release): последствия срыва откатываются штатным откатом применения — у карточки(ек) проверки,
 * которые сорвали (решённую hostOf отбрасывает, поэтому ищем по state.counter.cast) снимаются состояние/урон-эффект/иммунитет заклинателю.
 * Реакция и частота не возвращаются: проверка была брошена. -> число откатанных карточек
 */
export async function revert(castId) {
  let n = 0;
  // по степени, которая реально применена (после переброса state.counter.degree уже другая): провалившиеся прежние кандидаты (их onFail, иммунитет) остаются в силе
  const countered = (st) => { const c = st?.counter, d = Object.values(st?.challenge?.applied ?? {})[0]?.degree ?? c?.degree; return c?.cast === castId && c.done && counteractOutcome({ degree: d, counterRank: c.counterRank, targetRank: c.targetRank }).counteracted; };
  for (const h of game.messages.contents.filter((m) => countered(m.flags?.[MOD]?.use?.state))) {
    const st = h.flags[MOD].use.state, c = st.counter;
    let dmg = false;
    for (const t of h.flags[MOD].use.targets ?? []) {
      dmg ||= [st.challenge?.applied?.[t.key], st.apply?.[t.key]].some((rec) => rec?.ops?.some((o) => o.op === "damaged"));   // undoOps мгновенный урон не откатывает (его откатывает карточка pf2e)
      if ((await apply.undoOps(h, t.key))?.undone) n++;
    }
    await h.update({ [flagPath("use", "state", "counter", "reverted")]: true }).catch((e) => console.warn(`${MOD} | counterspell.reverted`, e));   // срыв отменён: «Применить» на этой карточке больше не предлагается и не исполняется
    if (dmg) await whisper(null, L("events.counter.revertDamage", { item: esc(c.by.item), spell: esc(c.spell) }), null, {}, "", "gm");
  }
  return n;
}

export function init() {
  Hooks.on("preCreateChatMessage", onPreCreate);
  Hooks.on("createChatMessage", (m) => { onCreate(m).catch((e) => console.error(`${MOD} | counterspell`, e)); });
}
