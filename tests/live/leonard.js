async () => {
  // Живой прогон Леонарда 2 ур. (RustySpirit): варвар, инстинкт стихии (земля), посвящение кинетика (земля), боевой молот + стальной щит.
  // Проверяет то, чего нет в общих сценариях (rage.js, leave-reach.js, limits-rustyspirit.js rage-impulse): аура «Проведения стихийной энергии»
  // (кнопка pf2e на карточке), Стихийный взрыв земли без ауры / с аурой / в ярости, конец ауры без сознания, «Внезапный натиск» (усилие раз за раунд),
  // Летаргический яд на молоте (не колющее и не рубящее — шёпот), «Блок щитом» по урону при поднятом щите.
  // Герой — копия «AF тест: Леонард» (сам герой не меняется); сцена, бой и гоблин создаются и удаляются сценарием.
  // Параметры: window.__afLeonard = { hero: "<id актёра>" }. Результат — window.__afLeonardResult.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(150); } return null; };
  const SHIFT = () => new MouseEvent("click", { shiftKey: !!game.user.flags.pf2e?.settings?.showCheckDialogs });
  const rows = [], warns = [];
  const N = ui.notifications, warnOrig = N.warn;
  N.warn = function (m, ...r) { warns.push(String(m)); return warnOrig.call(this, m, ...r); };
  const prevScene = game.scenes.viewed;
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const RAGE = "Compendium.pf2e.feat-effects.Item.z3uyCMBddrPK5umr";
  const created = new Set();
  const hook = Hooks.on("createChatMessage", (m) => m.author?.id === game.user.id && created.add(m.id));
  const modes = Object.fromEntries(["mode.apply", "mode.challenge", "mode.limits", "mode.shieldBlock"].map((k) => [k, game.settings.get(MOD, k)]));
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const hero = game.actors.get(window.__afLeonard?.hero) ?? game.actors.find((a) => a.name === "Леонард Шеллиас" && a.type === "character");
  let scene, combat, d20 = null;
  const fix = (n) => { if (d20 === null) d20 = CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = n == null ? d20 : () => 1 - (n - 0.5) / 20; };
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const since = (t0) => game.messages.contents.filter((m) => m._stats.createdTime >= t0);
  const text = (m) => (m?.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const aura = (a) => a.itemTypes.effect.find((e) => e.slug === "effect-kinetic-aura");
  const blastMsg = (t0) => since(t0).find((m) => m.flags?.pf2e?.context?.type === "attack-roll" && m.flags.pf2e.context.options?.includes("action:elemental-blast"));
  try {
    if (!hero) throw new Error("нет героя «Леонард Шеллиас»");
    ui.sidebar.expand?.(); ui.sidebar.changeTab?.("chat", "primary");
    for (const k of Object.keys(modes)) await game.settings.set(MOD, k, "auto");
    scene = await Scene.create({ name: `${PFX}сцена Леонард`, width: 1600, height: 1200, padding: 0, grid: { size: 100, distance: 5 }, navigation: false, tokenVision: false });
    await scene.view(); await wait(700);
    const s = hero.toObject(); delete s._id;
    const me = await Actor.create({ ...s, name: PFX + "Леонард", folder, ownership: { default: 0 } });
    const gob = await Actor.create({ ...(await fromUuid(GOBLIN)).toObject(), name: PFX + "гоблин", folder, ownership: { default: 0 } });
    const [tMe, tGob] = await scene.createEmbeddedDocuments("Token", [(await me.getTokenDocument({ x: 300, y: 300 })).toObject(), (await gob.getTokenDocument({ x: 400, y: 300 })).toObject()]);
    await wait(500);
    const L = await waitFor(() => tMe.actor?.isOfType?.("character") && tMe.actor), G = await waitFor(() => tGob.actor);   // актёр токена появляется не сразу
    const it = (slug) => L.items.find((i) => i.slug === slug);
    combat = await Combat.create({ scene: scene.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: tMe.id, sceneId: scene.id, actorId: me.id, initiative: 20 }, { tokenId: tGob.id, sceneId: scene.id, actorId: gob.id, initiative: 10 }]);
    await combat.startCombat(); await wait(800);
    tMe.object.control({ releaseOthers: true });
    game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
    tGob.object.setTarget(true, { releaseOthers: false });

    // --- Стихийный взрыв без ауры: pf2e не даёт (No kinetic gate) ---
    const blast = () => new game.pf2e.ElementalBlast(L);
    let t0 = Date.now(), err = null;
    await blast().attack({ element: "earth", damageType: "bludgeoning", melee: true, event: SHIFT() }).catch((e) => { err = e.message; });
    await wait(1500);
    row("Взрыв без ауры: броска нет (pf2e: нет кинетических врат)", !blastMsg(t0) && /kinetic gate/i.test(err ?? ""), `ошибка: ${err}`);

    // --- Проведение стихийной энергии: карточка pf2e с кнопкой «Применить эффект», модуль не вмешивается ---
    t0 = Date.now();
    await game.pf2e.rollItemMacro(it("channel-elements").uuid);
    const ce = await waitFor(() => since(t0).find((m) => m.flags?.pf2e?.context?.type === "self-effect"));
    await wait(1500);
    row("Проведение стихийной энергии: карточка pf2e, аура сама не ставится", !!ce && !aura(L), `карточка=${!!ce}, аура=${!!aura(L)}`);
    const btn = await waitFor(() => ui.chat.element?.querySelector(`[data-message-id="${ce?.id}"] button[data-action=applyEffect]`), 5000);
    btn?.click();
    await waitFor(() => aura(L), 5000);
    row("Кнопка «Применить эффект»: кинетическая аура", !!aura(L) && !!L.rollOptions.all["self:effect:kinetic-aura"], `кнопка=${!!btn}`);

    // --- Взрыв с аурой: земля, дробящий ---
    const cfg = blast().configs;
    row("Взрыв: стихия земли, дробящий урон", cfg.some((c) => c.element === "earth" && c.damageTypes.some((d) => d.value === "bludgeoning")), cfg.map((c) => `${c.element}:${c.damageTypes.map((d) => d.value)}`).join(", "));
    t0 = Date.now(); warns.length = 0;
    await blast().attack({ element: "earth", damageType: "bludgeoning", melee: true, event: SHIFT() }).catch((e) => warns.push("err " + e.message));
    row("Взрыв с аурой: бросок атаки", !!(await waitFor(() => blastMsg(t0), 6000)), warns.join(" | "));

    // --- в ярости: взрыв своей стихии (инстинкт земли) пускается ---
    await L.createEmbeddedDocuments("Item", [(await fromUuid(RAGE)).toObject()]); await wait(800);
    t0 = Date.now(); warns.length = 0;
    await blast().attack({ element: "earth", damageType: "bludgeoning", melee: true, mapIncreases: 1, event: SHIFT() }).catch((e) => warns.push("err " + e.message));
    row("В ярости: взрыв земли без блока", !!(await waitFor(() => blastMsg(t0), 6000)) && !warns.some((w) => /ярост|rage/i.test(w)), warns.join(" | "));

    // --- Внезапный натиск: усилие — второе за раунд блокируется ---
    const sc = it("sudden-charge"), scMsg = (t) => since(t).find((m) => m.flags?.pf2e?.origin?.uuid === sc.uuid);
    await combat.nextRound(); await wait(800);
    t0 = Date.now();
    await game.pf2e.rollItemMacro(sc.uuid);
    const sc1 = await waitFor(() => scMsg(t0), 5000);
    t0 = Date.now(); warns.length = 0;
    await game.pf2e.rollItemMacro(sc.uuid);
    await wait(2500);
    row("Внезапный натиск: первый — карточка, второй в том же раунде — блок с предупреждением", !!sc1 && !scMsg(t0) && warns.length > 0, `предупреждения: ${warns.join(" | ").slice(0, 200)}`);

    // --- без сознания: ярость и аура заканчиваются ---
    await L.increaseCondition("unconscious"); await wait(2500);
    row("Без сознания: аура снята (переполнение/без сознания — kinetic-aura)", !aura(L), `аура=${!!aura(L)}`);
    await L.decreaseCondition("unconscious", { forceRemove: true });
    for (const c of ["prone", "blinded", "off-guard"]) if (L.hasCondition(c)) await L.decreaseCondition(c, { forceRemove: true }).catch(() => {});   // «без сознания» оставляет «лёжа»
    await wait(500);
    for (const e of L.itemTypes.effect.filter((e) => /rage/.test(e.slug))) await e.delete().catch(() => {});

    // --- Летаргический яд: одно оружие — носитель на молоте без окна, шёпот «не колющее и не рубящее» ---
    const poison = it("lethargy-poison"), q0 = poison.quantity;
    t0 = Date.now();
    await poison.consume();
    const coat = await waitFor(() => L.itemTypes.effect.find((e) => e.flags?.[MOD]?.coat), 8000);
    const note = await waitFor(() => since(t0).find((m) => /не колющее и не рубящее|not piercing or slashing/i.test(text(m))), 5000);
    row("Летаргический яд: носитель на боевом молоте, доза списана", coat?.flags[MOD].coat.weapon === it("warhammer").id && poison.quantity === q0 - 1, `носитель=${coat?.name}, доза ${q0} -> ${poison.quantity}`);
    row("Летаргический яд на молоте: шёпот «не колющее и не рубящее — яд тратится без действия»", !!note, text(note).slice(0, 160));

    // --- Блок щитом: щит поднят, урон по Леонарду -> подсказка «Блок» ---
    const sh = L.heldShield;
    // состояние листа героя, не автоматизация: сломанный щит pf2e не даёт поднять — только сведения
    rows.push({ id: "Лист героя: стальной щит", status: "INFO", detail: `${sh?.isBroken ? "сломан — Поднять щит недоступен" : "цел"} (ОЗ ${sh?.hitPoints?.value}/${sh?.hitPoints?.max}, порог ${sh?.hitPoints?.brokenThreshold})` });
    if (sh?.isBroken) { await sh.update({ "system.hp.value": sh.hitPoints.max }); await wait(500); }   // дальше — на починенном щите копии
    const ac0 = L.armorClass.value;
    await game.pf2e.actions.raiseAShield({ actors: [L], event: SHIFT() });   // старое API pf2e: в game.pf2e.actions.get его нет
    await waitFor(() => L.attributes.shield?.raised, 4000);
    row("Поднять щит: щит поднят, КБ +2", !!L.attributes.shield?.raised && L.armorClass.value === ac0 + 2, `КБ ${ac0} -> ${L.armorClass.value}`);
    tGob.object.control({ releaseOthers: true });
    game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
    tMe.object.setTarget(true, { releaseOthers: false });
    const gs = G.system.actions.find((a) => a.item?.isMelee !== false) ?? G.system.actions[0];
    fix(19);
    t0 = Date.now();
    await gs.variants[0].roll({ event: SHIFT() });
    await waitFor(() => since(t0).find((m) => m.flags?.pf2e?.context?.type === "attack-roll"), 6000);
    fix(null);
    await wait(500);
    const t1 = Date.now();
    await gs.damage({ event: new MouseEvent("click", { shiftKey: !!game.user.flags.pf2e?.settings?.showDamageDialogs }) });   // у урона своя настройка окна
    const hint = await waitFor(() => since(t1).find((m) => m.flags?.[MOD]?.shieldBlock || /Блок щитом|Shield Block/i.test(text(m)) && m.whisper?.length), 12000);
    row("Удар по Леонарду с поднятым щитом: подсказка «Блок щитом»", !!hint, text(hint).slice(0, 160) || since(t1).map((m) => `${m.flags?.pf2e?.context?.type ?? "?"}:${text(m).slice(0, 40)}`).join(" | "));
  } catch (e) { row("ошибка", false, String(e?.stack ?? e).slice(0, 400)); }
  finally {
    fix(null);
    N.warn = warnOrig;
    for (const [k, v] of Object.entries(modes)) await game.settings.set(MOD, k, v).catch(() => {});
    await combat?.delete().catch(() => {});
    await wait(800); Hooks.off("createChatMessage", hook);   // удаление боя пишет «Конец раунда» — его тоже убираем
    if (prevScene && prevScene.id !== scene?.id) await prevScene.view().catch(() => {});
    await wait(800);
    const ids = [...created].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    await scene?.delete().catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
    game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
  }
  console.table(rows);
  window.__afLeonardResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afLeonardResult;
}
