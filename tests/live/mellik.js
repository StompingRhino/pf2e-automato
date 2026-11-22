async () => {
  // Живой прогон Меллика 2 ур. (RustySpirit): посвящение сорвиголовы — «Грязный приём» с бравадой (Негодяй), «Стильный боец» +1 в бою,
  // «Кураж» по успеху/провалу бравады, «Перекат» с бравадой, требование свободной руки, ручной арбалет (перезарядка).
  // Герой — копия «AF тест: Меллик» постоянной копии «Меллик Легкоступ (копия)»; сцена, бой и гоблин создаются и удаляются сценарием.
  // Параметры: window.__afMellik = { hero: "<id актёра>" }. Результат — window.__afMellikResult.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(150); } return null; };
  const SHIFT = () => new MouseEvent("click", { shiftKey: !!game.user.flags.pf2e?.settings?.showCheckDialogs });
  const rows = [], warns = [];
  const N = ui.notifications, warnOrig = N.warn;
  N.warn = function (m, ...r) { warns.push(String(m)); return warnOrig.call(this, m, ...r); };
  const prevScene = game.scenes.viewed, prevCombat = game.combat;
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const PANACHE = "Compendium.pf2e.feat-effects.Item.uBJsxCzNhje8m8jj";
  const created = new Set();
  const hook = Hooks.on("createChatMessage", (m) => m.author?.id === game.user.id && created.add(m.id));
  const modes = Object.fromEntries(["mode.apply", "mode.challenge", "mode.limits"].map((k) => [k, game.settings.get(MOD, k)]));
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const src = game.actors.get(window.__afMellik?.hero) ?? game.actors.find((a) => a.name === "Меллик Легкоступ (копия)");
  let scene, combat, d20 = null;
  const fix = (n) => { if (d20 === null) d20 = CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = n == null ? d20 : () => 1 - (n - 0.5) / 20; };
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const panaches = (a) => a.itemTypes.effect.filter((e) => e.sourceId === PANACHE);
  const clearPanache = async (a) => { const ids = panaches(a).map((e) => e.id); if (ids.length) await a.deleteEmbeddedDocuments("Item", ids); await wait(300); };
  const target = async (from, tgt) => {
    from.object.control({ releaseOthers: true });
    game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
    tgt.object.setTarget(true, { releaseOthers: false });
    await wait(300);
  };
  const lastCheck = (t0, pred) => game.messages.contents.find((m) => m._stats.createdTime >= t0 && m.isCheckRoll && pred(m.flags?.pf2e?.context ?? {}));
  try {
    if (!src) throw new Error("нет постоянной копии «Меллик Легкоступ (копия)»");
    for (const k of Object.keys(modes)) await game.settings.set(MOD, k, "auto");
    scene = await Scene.create({ name: `${PFX}сцена Меллик`, width: 1600, height: 1200, padding: 0, grid: { size: 100, distance: 5 }, navigation: false, tokenVision: false });
    await scene.view(); await wait(700);
    const s = src.toObject(); delete s._id;
    const me = await Actor.create({ ...s, name: PFX + "Меллик", folder, ownership: { default: 0 } });
    const gob = await Actor.create({ ...(await fromUuid(GOBLIN)).toObject(), name: PFX + "гоблин", folder, ownership: { default: 0 } });
    const [tMe, tGob] = await scene.createEmbeddedDocuments("Token", [(await me.getTokenDocument({ x: 300, y: 300 })).toObject(), (await gob.getTokenDocument({ x: 400, y: 300 })).toObject()]);
    await wait(500);
    const M = tMe.actor, G = tGob.actor;   // связанность берём из прототипа героя
    combat = await Combat.create({ scene: scene.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: tMe.id, sceneId: scene.id, actorId: me.id, initiative: 20 }, { tokenId: tGob.id, sceneId: scene.id, actorId: gob.id, initiative: 10 }]);
    await combat.startCombat(); await wait(800);
    const dt = M.items.find((i) => i.slug === "dirty-trick");

    // --- руки: как на листе героя (2 меча + арбалет) ---
    row("лист героя: свободных рук нет (2 меча в двух руках + арбалет в руке)", M.handsReallyFree === 0, `free=${M.handsFree}, really=${M.handsReallyFree}`);
    await target(tMe, tGob);
    let t0 = Date.now(); warns.length = 0;
    await dt.toMessage();
    await wait(2500);
    row("Грязный приём без свободной руки: броска нет, предупреждение с Alt", !lastCheck(t0, (c) => c.options?.includes("action:dirty-trick")) && warns.some((w) => /Alt/.test(w)), `warns=${warns.join(" | ")}`);

    // --- свободная рука: арбалет за пояс, мечи — по одному в руке? стопка ×2 в одной руке не бывает: один меч в руке ---
    const xbow = M.itemTypes.weapon.find((w) => w.slug === "hand-crossbow"), sw = M.itemTypes.weapon.find((w) => w.slug === "shortsword");
    await xbow.update({ "system.equipped": { carryType: "worn", handsHeld: 0 } });
    await sw.update({ "system.equipped.handsHeld": 1 }); await wait(400);
    row("предпосылка: одна свободная рука", M.handsReallyFree === 1, `really=${M.handsReallyFree}`);

    // успех (не крит): итог = СЛ Рефлекса + 2
    const dc = G.saves.reflex.dc.value, thv = M.skills.thievery.mod;
    const rig = async (want) => {
      const old = M.items.filter((i) => i.slug === "af-rig").map((i) => i.id); if (old.length) await M.deleteEmbeddedDocuments("Item", old);
      await M.createEmbeddedDocuments("Item", [{ type: "effect", name: "AF rig", system: { slug: "af-rig", rules: [{ key: "FlatModifier", selector: "skill-check", value: want - 10 - thv - 1 }] } }]);   // −1: «Стильный боец» в бою
      await wait(300);
    };
    await clearPanache(M); await rig(dc + 2); fix(10);
    t0 = Date.now(); warns.length = 0;
    await dt.toMessage();
    const ck = await waitFor(() => lastCheck(t0, (c) => c.options?.includes("action:dirty-trick")));
    const ctx = ck?.flags?.pf2e?.context ?? {}, mods = ck?.flags?.pf2e?.modifiers ?? [];
    row("Грязный приём: бросок Воровства против Рефлекса", !!ck && ctx.dc?.slug === "reflex", `dc=${ctx.dc?.value} (ждали ${dc}), исход=${ctx.outcome}`);
    row("Грязный приём: в опциях броска бравада (Негодяй)", !!ctx.options?.includes("item:trait:bravado"));
    row("Стильный боец: +1 обстоятельств в бою", mods.some((m) => m.slug === "stylish-combatant-skill" && m.enabled !== false && m.modifier === 1), mods.map((m) => `${m.slug}:${m.modifier}`).join(","));
    const clumsy = await waitFor(() => G.conditions.bySlug?.("clumsy")?.length || G.itemTypes.condition.some((c) => c.slug === "clumsy"));
    await wait(1500);
    const cl = G.itemTypes.condition.filter((c) => c.slug === "clumsy");
    const clEff = G.itemTypes.effect.filter((e) => e.system.duration?.unit === "rounds" && e.system.rules?.some((r) => /clumsy/i.test(JSON.stringify(r))));
    row("Успех: цель неуклюжа 1, один раз", !!clumsy && cl.length === 1 && cl[0].value === 1, `состояний=${cl.length}, value=${cl[0]?.value}, эффектов-носителей=${clEff.length}`);
    row("Успех: неуклюжесть на 1 раунд (эффект с длительностью)", clEff.length === 1 && clEff[0].system.duration.value === 1, clEff.map((e) => `${e.name} ${e.system.duration.value} ${e.system.duration.unit} ${e.system.duration.expiry}`).join(";"));
    const p1 = await waitFor(() => panaches(M).length);
    await wait(1000);
    row("Успех бравады: Меллик входит в кураж, один эффект", !!p1 && panaches(M).length === 1, `эффектов куража=${panaches(M).length}`);
    row("Кураж: Стильный боец +5 к скорости", M.system.movement?.speeds?.land?.value === 30 || M.attributes.speed?.total === 30, `скорость=${M.system.movement?.speeds?.land?.value ?? M.attributes.speed?.total}`);

    // повтор в кураже: второй эффект не появляется
    t0 = Date.now();
    await dt.toMessage();
    await waitFor(() => lastCheck(t0, (c) => c.options?.includes("action:dirty-trick")));
    await wait(7000);   // шаги по степени идут после анимации Dice So Nice (4–5 с)
    row("Бравада в кураже: эффект куража не дублируется", panaches(M).length === 1, `эффектов куража=${panaches(M).length}`);

    // провал бравады: кураж до конца следующего хода
    for (const id of G.itemTypes.effect.map((e) => e.id)) await G.deleteEmbeddedDocuments("Item", [id]).catch(() => {});
    for (const c of G.itemTypes.condition.filter((c) => c.slug === "clumsy")) await c.delete().catch(() => {});
    await clearPanache(M); await rig(dc - 3);
    t0 = Date.now();
    await dt.toMessage();
    const ckF = await waitFor(() => lastCheck(t0, (c) => c.options?.includes("action:dirty-trick")));
    const pF = await waitFor(() => panaches(M)[0]);
    await wait(6000);
    row("Провал бравады: кураж до конца следующего хода", ckF?.flags?.pf2e?.context?.outcome === "failure" && !!pF && pF.system.duration.unit === "rounds" && pF.system.duration.expiry === "turn-end", `исход=${ckF?.flags?.pf2e?.context?.outcome}; ${pF ? JSON.stringify(pF.system.duration) : "нет эффекта"}; без неуклюжести: ${!G.itemTypes.condition.some((c) => c.slug === "clumsy")}`);

    // Перекат (бравада от Куража): успех -> кураж
    await clearPanache(M); await rig(G.saves.reflex.dc.value + 2);
    t0 = Date.now();
    await game.pf2e.actions.get("tumble-through").use({ actors: [M], target: tGob.object, event: SHIFT() });
    const ckT = await waitFor(() => lastCheck(t0, (c) => c.options?.includes("action:tumble-through")));
    const pT = await waitFor(() => panaches(M).length);
    row("Перекат: бравада в опциях и кураж по успеху", !!ckT?.flags?.pf2e?.context?.options?.includes("item:trait:bravado") && !!pT, `исход=${ckT?.flags?.pf2e?.context?.outcome}; куража=${panaches(M).length}`);
    fix(null);

    // ручной арбалет: перезарядка 1 (pf2e)
    await xbow.update({ "system.equipped": { carryType: "held", handsHeld: 1 } });
    await sw.update({ "system.equipped": { carryType: "worn", handsHeld: 0 } }); await wait(400);
    await tGob.update({ x: 900 }); await wait(400);
    const strike = () => M.system.actions.find((a) => a.item?.id === xbow.id);
    await xbow.attach(M.itemTypes.ammo.find((a) => a.slug === "bolts"), { quantity: 1, stack: true }); await wait(400);   // pf2e 8: оружие с перезарядкой стреляет заряженным снарядом-подпредметом (лист: «Перезарядка»)
    const loaded = () => xbow.subitems?.filter((s) => s.isOfType("ammo")).reduce((n, s) => n + s.quantity, 0) ?? 0, ammo0 = loaded();
    t0 = Date.now(); warns.length = 0;
    await strike()?.variants[0].roll({ event: SHIFT() }).catch((e) => warns.push("err " + e.message));
    await wait(1500);
    const a1 = !!game.messages.contents.find((m) => m._stats.createdTime >= t0 && m.flags?.pf2e?.context?.type === "attack-roll");
    const q1 = loaded();
    t0 = Date.now(); const w1 = warns.length;
    await strike()?.variants[0].roll({ event: SHIFT() }).catch((e) => warns.push("err " + e.message));
    await wait(1500);
    const a2 = !!game.messages.contents.find((m) => m._stats.createdTime >= t0 && m.flags?.pf2e?.context?.type === "attack-roll");
    row("Ручной арбалет: заряжен, выстрел есть, заряженный болт потрачен", ammo0 === 1 && a1 && q1 === 0, `заряжено ${ammo0} -> ${q1}`);
    row("Ручной арбалет: второй выстрел без перезарядки не идёт (pf2e)", a1 && !a2, `второй бросок=${a2}; предупреждения=${warns.slice(w1).join(" | ")}`);
  } catch (e) { row("ошибка", false, String(e?.stack ?? e).slice(0, 400)); }
  finally {
    fix(null);
    N.warn = warnOrig;
    for (const [k, v] of Object.entries(modes)) await game.settings.set(MOD, k, v).catch(() => {});
    await combat?.delete().catch(() => {});
    await wait(800); Hooks.off("createChatMessage", hook);   // удаление боя пишет «Конец раунда» — его тоже убираем
    if (prevScene && prevScene.id !== scene?.id) await prevScene.view().catch(() => {});
    if (prevCombat && game.combats.has(prevCombat.id)) ui.combat.initialize({ combat: prevCombat });
    await wait(800);
    const ids = [...created].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    await scene?.delete().catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
    game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
  }
  console.table(rows);
  window.__afMellikResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afMellikResult;
}
