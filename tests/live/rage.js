async () => {
  // Ярость варвара (scripts/builtin/rage.mjs) на копии персонажа мира с действием «Ярость» (по умолчанию первый варвар 3 уровня; window.__afRage = { actor: "<id>" }).
  // Проверки: удары инстинкта животного (птица: клюв/коготь) и урон ярости; карточка Ярости эффект сама не кладёт — кнопка pf2e «Применить эффект» (ВОЗ, удары,
  // скорость); второй эффект не создаётся; повтор и утомление — карточки нет, предупреждение (impulse-gate); концентрация в ярости — шёпот; без сознания — конец
  // ярости и иммунитет к ВОЗ; инициатива — шёпот «Вспыльчивость» с кнопкой -> карточка -> кнопка pf2e; конец боя — конец ярости.
  // Пишет в мир только «AF тест: …» и всё убирает. Нужен mode.macro не off.
  const PFX = "AF тест: ", RAGE = "Compendium.pf2e.feat-effects.Item.z3uyCMBddrPK5umr";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(150); } return null; };
  const rows = [], row = (id, ok, detail = "") => rows.push({ id, status: ok ? "ok" : "fail", detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
  const sweep = async () => {
    const test = (n) => typeof n === "string" && n.startsWith(PFX);
    for (const c of game.combats.filter((c) => test(c.scene?.name))) await c.delete().catch(() => {});
    const ids = new Set(game.actors.filter((a) => test(a.name)).map((a) => a.id));
    const msgs = game.messages.filter((m) => ids.has(m.speaker?.actor)).map((m) => m.id);
    if (msgs.length) await ChatMessage.deleteDocuments(msgs).catch(() => {});
    for (const s of game.scenes.filter((s) => test(s.name))) await s.delete().catch(() => {});
    for (const a of game.actors.filter((a) => test(a.name))) await a.delete().catch(() => {});
  };
  if (window.__afRage?.cleanOnly) return sweep();
  if (game.settings.get("pf2e-automato", "mode.macro") === "off") return { summary: "SKIP: mode.macro = off" };
  const base = game.actors.get(window.__afRage?.actor) ?? game.actors.find((a) => a.class?.slug === "barbarian" && a.level === 3);
  if (!base) return { summary: "SKIP: нет варвара" };
  await sweep();
  const rage = await import("/modules/pf2e-automato/scripts/builtin/rage.mjs");
  const src = base.toObject(); delete src._id; src.name = PFX + base.name; src.ownership = { default: 0 };
  const a = await Actor.create(src);
  const rages = () => a.itemTypes.effect.filter((e) => e.slug === "effect-rage");
  const lastWhisper = (since) => game.messages.contents.slice(since).filter((m) => m.flags?.["pf2e-automato"]?.builtin === "rage").at(-1);
  const action = a.itemTypes.action.find((i) => i.slug === "rage");
  const warns = [], N = ui.notifications, warnOrig = N.warn;
  N.warn = function (m, ...r) { warns.push(String(m)); return warnOrig.call(this, m, ...r); };
  ui.sidebar?.expand?.(); ui.sidebar?.changeTab?.("chat", "primary");
  const card = (since) => waitFor(() => game.messages.contents.slice(since).find((m) => m.flags?.pf2e?.context?.type === "self-effect" && m.speaker?.actor === a.id), 4000);
  const applyBtn = (m) => waitFor(() => document.querySelector(`#chat [data-message-id="${m?.id}"] button[data-action=applyEffect]`), 4000);
  try {
    // 1. удары инстинкта: нет вне ярости
    const instinct = () => a.system.actions.filter((s) => s.slug?.startsWith("instinct-"));
    row("no-rage-strikes", instinct().length === 0, instinct().map((s) => s.slug));
    // 2. карточка Ярости: эффект сам не кладётся; кнопка pf2e «Применить эффект» -> эффект и ВОЗ
    const speed0 = a.system.movement?.speeds?.land?.value;
    let n = game.messages.size;
    await game.pf2e.rollItemMacro(action.uuid);
    const c1 = await card(n);
    await wait(1500);
    row("rage-card-manual", !!c1 && !rages().length, { card: !!c1, effects: rages().length });
    (await applyBtn(c1))?.click();
    await waitFor(() => rages().length && a.system.attributes.hp.temp);
    await wait(300);
    const want = a.level + a.system.abilities.con.mod;
    row("rage-apply-button", rages().length === 1 && a.system.attributes.hp.temp === want, { effects: rages().length, temp: a.system.attributes.hp.temp, want });
    const footfalls = a.items.some((i) => i.slug === "furious-footfalls") ? 5 : 0;   // «Яростная поступь» (3 ур.): +5 в ярости; до 3 уровня скорость не меняется
    row("rage-speed", a.system.movement?.speeds?.land?.value === speed0 + footfalls, { before: speed0, after: a.system.movement?.speeds?.land?.value, footfalls });
    // 3. удары инстинкта и урон ярости (+2, у быстрого — +1)
    const dmg = async (slug) => { const s = a.system.actions.find((x) => x.slug === slug); return s && String(await s.damage({ getFormula: true })); };
    const beak = await dmg("instinct-beak"), talon = await dmg("instinct-talon");
    const animal = a.items.find((i) => i.slug === "animal-instinct")?.flags?.pf2e?.rulesSelections?.animalInstinct;
    row("instinct-strikes", animal !== "bird" || (/1d10/.test(beak) && /1d6/.test(talon) && +beak.match(/\+ ?(\d+)/)?.[1] - +talon.match(/\+ ?(\d+)/)?.[1] === 1), { animal, beak, talon, strikes: instinct().map((s) => s.slug) });
    // 4. второй эффект (кнопка pf2e) не создаётся
    await a.createEmbeddedDocuments("Item", [(await fromUuid(RAGE)).toObject()]).catch(() => {});
    row("no-duplicate", rages().length === 1, { effects: rages().length });
    // 5. повторная Ярость — карточки нет, предупреждение «уже в ярости»
    n = game.messages.size; warns.length = 0;
    await game.pf2e.rollItemMacro(action.uuid);
    const again = await card(n);
    row("again-blocked", !again && rages().length === 1 && warns.some((w) => /ярост|raging/i.test(w)), warns.join(" | ").slice(0, 160));
    // 6. концентрация в ярости (Деморализация) — шёпот
    n = game.messages.size;
    await game.pf2e.actions.get("demoralize")?.use({ actors: [a], event: new MouseEvent("click", { shiftKey: !!game.user.flags.pf2e?.settings?.showCheckDialogs }) }).catch((e) => e);
    const conc = await waitFor(() => lastWhisper(n));
    row("concentrate-whisper", !!conc, conc?.content.replace(/<[^>]+>/g, "").slice(0, 120));
    // 7. без сознания — конец ярости, иммунитет
    await a.increaseCondition("unconscious");
    const gone = await waitFor(() => !rages().length && a.itemTypes.effect.some((e) => e.slug === "effect-rage-temporary-hit-points-immunity"));
    row("unconscious-ends", !!gone && a.system.attributes.hp.temp === 0, { effects: a.itemTypes.effect.map((e) => e.slug), temp: a.system.attributes.hp.temp });
    await a.decreaseCondition("unconscious", { forceRemove: true });
    // 7б. новая ярость в ту же минуту — эффект есть, ВОЗ нет (иммунитет)
    await a.createEmbeddedDocuments("Item", [(await fromUuid(RAGE)).toObject()]);
    await waitFor(() => rages().length); await wait(1500);
    row("immunity-no-temp", rages().length === 1 && !a.system.attributes.hp.temp, { effects: rages().length, temp: a.system.attributes.hp.temp });
    for (const e of a.itemTypes.effect) await e.delete();
    // 8. утомление — карточки нет, предупреждение «утомлены»
    await a.increaseCondition("fatigued");
    n = game.messages.size; warns.length = 0;
    await game.pf2e.rollItemMacro(action.uuid);
    const fat = await card(n);
    row("fatigued-blocked", !fat && !rages().length && warns.some((w) => /утомл|fatigued/i.test(w)), warns.join(" | ").slice(0, 160));
    await a.decreaseCondition("fatigued", { forceRemove: true });
    // 9. инициатива — шёпот «Вспыльчивость», кнопка -> карточка pf2e -> «Применить эффект» (обработчик напрямую: без сцены и боя, вид ГМа не переключается)
    n = game.messages.size;
    await rage.onMessage({ actor: a, token: null, flags: { pf2e: { context: { type: "initiative" } } } });
    const qt = await waitFor(() => lastWhisper(n));
    const btn = await waitFor(() => document.querySelector(`#chat [data-message-id="${qt?.id}"] [data-af-rage]`));
    n = game.messages.size;
    btn?.click();
    const qc = await card(n);
    await wait(1000);
    const manual = !rages().length;
    (await applyBtn(qc))?.click();
    row("quick-tempered", manual && !!(await waitFor(() => rages().length === 1)), { whisper: !!qt, button: !!btn, card: !!qc, manual, effects: rages().length });
    // 10. конец боя — конец ярости
    await rage.onCombatEnd({ combatants: [{ actor: a }] });
    row("combat-end", !!(await waitFor(() => !rages().length)), { effects: a.itemTypes.effect.map((e) => e.slug) });
  } catch (e) {
    row("error", false, String(e?.stack ?? e).slice(0, 300));
  } finally {
    N.warn = warnOrig;
    await sweep();
  }
  const fail = rows.filter((r) => r.status !== "ok").length;
  console.table(rows);
  return (window.__afRageResult = { summary: `${rows.length - fail}/${rows.length} ok`, rows });
}
