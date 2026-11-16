async () => {
  // Живые сценарии контрзаклинания (M4). Первые пять (fireball-release … use-apply) — удержание hold.mjs БЕЗ диспетчера: флаг ставится вручную через api.markCounterHold (gate.manual: диспетчер такую карточку не трогает).
  // counter-* — диспетчер целиком (шаги 3–4): реактор-NPC с записью counter, окно ведущему (e.answers), бросок, срыв / выпуск / «Вернуть».
  // counter-slot-* — трата ячейки (M4.9, counter.expend): NPC-контрзаклинатель с записью колдовства, проверка слота/журнала slotExpended, «Вернуть» ячейку не возвращает.
  // Ожидание: пока удержано — эффект не исполняется (нет регионов/целей/спасбросков/урона), кнопки скрыты, плашка с «Выпустить»/«Отменить»;
  // «Выпустить» — исполняется ровно один раз; «Отменить» — ничего, кнопки скрыты; «Вернуть» после отмены = выпуск.
  // Копии «AF тест: …» и сцена создаются и удаляются сценарием. Параметры: window.__afCS = { only, skip, cleanOnly }. Результат — window.__afCSResult.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const opts = { only: null, skip: [], ...(window.__afCS ?? {}) };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let cur = null;
  const waitFor = async (fn, ms = 8000, step = 150) => {
    const end = Date.now() + ms, env = cur;
    while (Date.now() < end) { if (!env || env.dead) return null; try { const v = await fn(); if (v) return v; } catch { /* ещё не готово */ } await wait(step); }
    return null;
  };
  class Skip extends Error {}
  const bound = (label, p, ms = 30000) => {
    let tm;
    return Promise.race([p, new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(`завис шаг «${label}» (>${ms / 1000} с)`)), ms); })]).finally(() => clearTimeout(tm));
  };
  const DEG = ["criticalFailure", "failure", "success", "criticalSuccess"];
  const SHIFT = () => new MouseEvent("click", { shiftKey: !!game.user.flags.pf2e?.settings?.showCheckDialogs });
  const api = () => game.modules.get(MOD).api;
  const setting = (k) => game.settings.get(MOD, k);

  // ---------- уборка ----------
  const killCombat = async (c) => { for (let i = 0; i < 3 && game.combats.has(c.id); i++) { await game.combats.get(c.id).delete().catch(() => {}); if (game.combats.has(c.id)) await wait(800); } };
  const sweep = async (extraMsgIds = []) => {
    const test = (n) => typeof n === "string" && n.startsWith(PFX);
    for (const c of game.combats.filter((c) => test(c.scene?.name) || c.combatants.some((x) => test(x.actor?.name) || test(x.name) || test(game.scenes.get(x.sceneId)?.name)))) await killCombat(c);
    const scenes = game.scenes.filter((s) => test(s.name));
    const actorIds = new Set(game.actors.filter((a) => test(a.name)).map((a) => a.id));
    const sceneIds = new Set(scenes.map((s) => s.id));
    const ids = [...new Set([...extraMsgIds, ...game.messages.filter((m) => actorIds.has(m.speaker?.actor) || sceneIds.has(m.speaker?.scene)).map((m) => m.id)])].filter((id) => game.messages.has(id));
    for (const s of scenes) if (s.regions.size) await s.deleteEmbeddedDocuments("Region", s.regions.map((r) => r.id)).catch(() => {});
    if (ids.length) { await ChatMessage.deleteDocuments(ids).catch(() => {}); await wait(800); }   // снятие якорей Поддержания по удалению сообщений должно уйти до удаления сцены (иначе сервер отвечает «Scene … does not exist»)
    for (const s of scenes) await s.delete().catch(() => {});
    for (const a of game.actors.filter((a) => test(a.name))) await a.delete().catch(() => {});
    return game.actors.filter((a) => test(a.name)).length + game.scenes.filter((s) => test(s.name)).length;
  };
  if (opts.cleanOnly) return { left: await sweep() };

  // ---------- окружение прогона ----------
  const prevScene = game.scenes.viewed, prevCombat = game.combats.viewed;
  const pfSet = game.user.flags.pf2e?.settings ?? {};
  const origFlags = { showCheckDialogs: pfSet.showCheckDialogs, showDamageDialogs: pfSet.showDamageDialogs };
  const tbPrev = game.settings.get(MOD, "useToolbeltTargetHelper");
  const notes = [];
  const N = ui.notifications, nOrig = { warn: N.warn, error: N.error };
  const ceOrig = console.error;
  console.error = function (...a) { const er = a.find((x) => x instanceof Error); if (er) notes.push(`console.error: ${String(a[0]).slice(0, 80)} ${String(er.stack ?? er.message).replace(/\s+/g, " ").slice(0, 500)}`); return ceOrig.apply(this, a); };
  const onErr = (ev) => { const er = ev.error ?? ev.reason; notes.push(`uncaught: ${String(er?.stack ?? er?.message ?? ev.message).replace(/\s+/g, " ").slice(0, 500)}`); };
  window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onErr);
  for (const k of Object.keys(nOrig)) N[k] = function (m, ...r) { notes.push(`${k}: ${String(m).slice(0, 120)}`); return nOrig[k].call(this, m, ...r); };
  const setFlags = (v) => game.user.update(Object.fromEntries(Object.entries(v).map(([k, x]) => x === undefined ? [`flags.pf2e.settings.-=${k}`, null] : [`flags.pf2e.settings.${k}`, x])));

  const idx = {};
  const find = async (pack, slug) => {
    const p = game.packs.get(pack);
    if (!p) throw new Error(`нет пака ${pack}`);
    idx[pack] ??= await p.getIndex({ fields: ["system.slug"] });
    const e = idx[pack].find((i) => i.system?.slug === slug);
    if (!e) throw new Skip(`нет в ${pack}: ${slug}`);
    return (await p.getDocument(e._id)).toObject();
  };
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";

  const newEnv = async (id) => {
    const e = { dead: false, id, tracked: new Set(), answers: [], stop: false, d20: null };
    const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) e.tracked.add(m.id); });
    e.scene = await Scene.create({ name: `${PFX}сцена ${id}`, width: 2400, height: 2000, padding: 0, grid: { size: 100, distance: 5 }, navigation: false, tokenVision: false });
    await e.scene.view(); await wait(700);
    // окна модуля: ответ из e.answers (число действий и т. п.), иначе закрыть; окна бросков pf2e — «Бросок»
    const seen = new Set();
    (async () => {
      while (!e.stop) {
        for (const el of document.querySelectorAll(".paf-dialog")) {
          if (seen.has(el.id)) continue;
          seen.add(el.id);
          const sel = el.querySelector("select[name=choice]"), want = e.answers.length ? e.answers.shift() : null;
          const o = sel && want != null ? [...sel.options].find((x) => x.value === String(want) || x.textContent.toLowerCase().includes(String(want).toLowerCase())) : null;
          const btn = !sel && want != null ? el.querySelector(`button[data-action='${want}']`) : null;   // окно ГМа (sharedDialog) — кнопки вариантов, не список
          if (o) { sel.value = o.value; el.querySelector("button[data-action=ok]")?.click(); } else if (btn) btn.click(); else foundry.applications.instances.get(el.id)?.close();
        }
        for (const app of [...Object.values(globalThis.ui?.windows ?? {}), ...foundry.applications.instances.values()]) {
          const aid = app.appId ?? app.id;
          if (seen.has(aid) || !/damage|modifiers|урон|check/i.test(`${app.constructor.name} ${app.title}`)) continue;
          seen.add(aid);
          const root = app.element?.[0] ?? app.element, bs = root?.querySelectorAll?.("button");
          (root?.querySelector?.("button.roll") ?? bs?.[bs.length - 1])?.click();
        }
        await wait(150);
      }
    })();
    const live = () => { if (e.dead) throw new Error("сценарий остановлен"); };
    e.add = (data) => live() ?? Actor.create({ folder: game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null, ownership: { default: 0 }, ...data, name: PFX + data.name });
    e.foe = async (name) => { const a = await e.add({ ...(await fromUuid(GOBLIN)).toObject(), name }); await a.update({ "system.attributes.hp.value": a.hitPoints.max }); return a; };
    e.give = (a, ...docs) => live() ?? a.createEmbeddedDocuments("Item", docs);
    e.tok = async (a, x, y, disposition) => { live(); const [t] = await e.scene.createEmbeddedDocuments("Token", [{ ...(await a.getTokenDocument({ x, y })).toObject(), disposition }]); return t; };
    e.T = (t) => e.scene.tokens.get(t.id);
    e.A = (t) => e.scene.tokens.get(t.id)?.actor;
    e.aim = async (ctrl, ...targets) => {
      e.T(ctrl).object.control({ releaseOthers: true });
      game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
      for (const t of targets) e.T(t).object.setTarget(true, { releaseOthers: false });
      await wait(300);
    };
    e.rig = (actor, selector, value) => live() ?? actor.createEmbeddedDocuments("Item", [{ type: "effect", name: "AF rig", system: { slug: "af-rig", rules: [{ key: "FlatModifier", selector, value }] } }]);
    e.fix = async (n) => {
      if (n != null) live();
      if (e.d20 === null) e.d20 = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = n == null ? e.d20 : () => 1 - (n - 0.5) / 20;
    };
    e.since = () => Date.now();
    e.msgs = (t0) => game.messages.contents.filter((m) => m._stats.createdTime >= t0);
    e.dom = (m) => document.querySelector(`#chat [data-message-id="${m?.id}"]`);
    e.use = (m) => game.messages.get(m?.id)?.flags?.[MOD]?.use;
    e.gate = (m) => game.messages.get(m?.id)?.flags?.[MOD]?.gate ?? {};
    e.dispose = async () => {
      e.dead = true; e.stop = true;
      await wait(2500);
      if (prevScene && prevScene.id !== e.scene.id && game.scenes.has(prevScene.id)) { await prevScene.view().catch(() => {}); await wait(1000); }
      Hooks.off("createChatMessage", hook);
      try { await e.fix(null); } catch { /* ok */ }
      game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
      document.querySelectorAll(".paf-dialog").forEach((el) => foundry.applications.instances.get(el.id)?.close());
      return sweep([...e.tracked]);
    };
    return e;
  };

  // ---------- общие шаги ----------
  const S = [];
  const sc = (id, title, run) => S.push({ id, title, run });
  const openChat = () => { try { ui.sidebar?.expand?.(); ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* ok */ } };
  const victim = async (e, name) => { const a = await e.foe(name); await a.update({ "system.details.alliance": "party" }); return a; };
  const rigSave = async (e, G, stat, dc, deg) => {
    for (const i of G.itemTypes.effect.filter((i) => i.slug === "af-rig")) await i.delete();
    await e.rig(G, stat, dc + ({ criticalSuccess: 0, success: -10, failure: -11, criticalFailure: -20 })[deg] - G.saves[stat].mod);
  };
  /** NPC-заклинатель с врождённой записью и заклинанием slug (опционально — правило модуля в флаге). -> {A0, sp0, entry} */
  const caster = async (e, slug, rule = null) => {
    const A0 = await e.foe("заклинатель");
    const [entry] = await e.give(A0, { type: "spellcastingEntry", name: "AF", system: { ability: { value: "cha" }, spelldc: { value: 0, dc: 20 }, tradition: { value: "arcane" }, prepared: { value: "spontaneous" }, slots: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [`slot${r}`, { max: 5, value: 5 }])) } });   // спонтанная с ячейками: врождённое — один каст в день
    const d = await find("pf2e.spells-srd", slug); d.system.location = { value: entry.id };
    if (rule) { const v = api().validateRule(rule); if (!v.ok) throw new Error(`правило невалидно: ${v.errors.map(String).join("; ")}`); d.flags = { ...d.flags, [MOD]: { ...d.flags?.[MOD], rule } }; }
    const [sp0] = await e.give(A0, d);
    return { A0, sp0, entry };
  };
  /** Следующая карточка сотворения этого заклинания рождается удержанной (как поставит диспетчер M4 в onPreCreate). hold=false — обычная. */
  /** Карточка сотворения (не «в чат»): context.type "spell-cast" pf2e ставит только заклинаниям со спасброском, признак — cast-a-spell в origin. */
  const isCast = (m, sp) => m.flags?.pf2e?.origin?.uuid === sp.uuid && !!m.flags.pf2e.origin.rollOptions?.includes("origin:action:slug:cast-a-spell");
  const castCard = async (e, ent, sp, rank, hold) => {
    const t0 = e.since();
    const h = hold ? Hooks.on("preCreateChatMessage", (m) => { if (isCast(m, sp)) { api().markCounterHold(m); Hooks.off("preCreateChatMessage", h); } }) : null;
    try { await bound("cast", ent.cast(sp, { rank, message: true })); } finally { if (h) Hooks.off("preCreateChatMessage", h); }
    return waitFor(() => e.msgs(t0).find((x) => isCast(x, sp)), 8000);
  };
  const region = async (e, m, x, y, r) => (await e.scene.createEmbeddedDocuments("Region", [{ name: `${PFX}область`, color: "#00aa55", shapes: [{ type: "circle", hole: false, x, y, radius: r }], behaviors: [], flags: { pf2e: { messageId: m.id, areaShape: "burst", origin: { uuid: m.item?.uuid, type: m.item?.type, actor: m.actor?.uuid, token: m.token?.uuid } } } }]))[0];
  /** Что в DOM карточки видно из кнопок (после скрытия классом). Плашка .paf-hold не считается. */
  const visibleButtons = (e, m) => {
    const root = e.dom(m);
    if (!root) return ["нет DOM"];
    return [...root.querySelectorAll(".card-buttons button, .message-buttons button, .spell-button button, .paf-damage-box button, .paf-area-box button, .paf-maneuver-box button, .pf2e-automato button, [data-action=spell-damage], [data-action=spell-save], [data-action=spell-template]")]
      .filter((b) => !b.closest(".paf-hold") && b.offsetParent !== null).map((b) => b.dataset.action || b.textContent.trim());
  };
  const plaqueBtn = (e, m, which) => e.dom(m)?.querySelector(`.paf-hold button[data-hold=${which}]`);
  const saveMsgs = (e, t0) => e.msgs(t0).filter((x) => x.flags?.pf2e?.context?.type === "saving-throw");
  const dmgMsgs = (e, t0, uuid) => e.msgs(t0).filter((x) => x.flags?.pf2e?.context?.type === "damage-roll" && x.flags?.pf2e?.origin?.uuid === uuid);

  // ---------- сценарии ----------
  const fireballSetup = async (e) => {
    const { A0, sp0, entry } = await caster(e, "fireball"), V1 = await victim(e, "жертва 1"), V2 = await victim(e, "жертва 2");
    const tA = await e.tok(A0, 600, 1000, -1), t1 = await e.tok(V1, 1300, 1000, 1), t2 = await e.tok(V2, 1300, 1200, 1);   // заклинатель вне собственного шара (r 400 от 1300,1100)
    await wait(900);
    await rigSave(e, e.A(t1), "reflex", 20, "failure"); await rigSave(e, e.A(t2), "reflex", 20, "success");
    await e.fix(10); await e.aim(tA);
    return { tA, t1, t2, sp: e.A(tA).items.get(sp0.id), ent: e.A(tA).items.get(entry.id) };
  };

  sc("fireball-release", "Огненный шар: удержано — ничего не исполняется и кнопок нет; «Выпустить» — область, спасброски обеих целей ровно один раз", async (e, t) => {
    openChat();
    const { t1, t2, sp, ent } = await fireballSetup(e);
    const t0 = e.since(), hp1 = e.A(t1).hitPoints.value;
    const m = await castCard(e, ent, sp, 3, true);
    t.ok(!!m && e.gate(m).hold === "counter", `карточка удержана (${JSON.stringify(e.gate(m))})`);
    t.ok(m?.flags?.["xdy-pf2e-workbench"]?.noAutoDamageRoll === true || !game.modules.get("xdy-pf2e-workbench")?.active, "Workbench: noAutoDamageRoll");
    const r = await region(e, m, 1300, 1100, 400);   // шаблон поставлен, пока держится
    await wait(5000);
    t.ok(!e.use(m)?.state?.area && !Object.keys(e.use(m)?.state?.challenge?.results ?? {}).length, `область/результаты не взяты (${JSON.stringify(e.use(m)?.state?.area)})`);
    t.ok(saveMsgs(e, t0).length === 0 && !e.use(m)?.state?.done, "спасбросков и исполнения нет");
    t.ok(e.A(t1).hitPoints.value === hp1 && dmgMsgs(e, t0, sp.uuid).length === 0, "урона нет");
    t.ok(e.dom(m)?.classList.contains("paf-counter-block"), "класс paf-counter-block на корне");
    const vis = visibleButtons(e, m);
    t.ok(vis.length === 0, `кнопки скрыты (${vis})`);
    if (game.modules.get("pf2e-toolbelt")?.active) t.ok([...(e.dom(m)?.querySelectorAll(".pf2e-toolbelt-target-targetRows") ?? [])].every((el) => el.offsetParent === null), "строки целей Toolbelt скрыты");
    else t.ok(true, "Toolbelt не активен — проверка строк пропущена");
    t.ok(!!plaqueBtn(e, m, "release") && !!plaqueBtn(e, m, "cancel"), "плашка: «Выпустить» и «Отменить»");
    plaqueBtn(e, m, "release")?.click();
    t.ok(await waitFor(() => (e.use(m)?.state?.area?.keys?.length ?? 0) >= 2, 12000), "после выпуска: цели области взяты (resumeRegion)");
    t.ok(await waitFor(() => Object.keys(e.use(m)?.state?.challenge?.results ?? {}).length >= 2, 14000), "спасброски обеих целей");
    await wait(4000);
    t.ok(saveMsgs(e, t0).length === 2, `спасбросков ровно 2 (${saveMsgs(e, t0).length})`);
    t.ok(!e.dom(m)?.classList.contains("paf-counter-block") && !e.dom(m)?.querySelector(".paf-hold"), "класс и плашка сняты");
    t.ok(!!r, "регион был");
  });

  sc("fireball-cancel", "Огненный шар: «Отменить» — ничего, кнопки скрыты, плашка «Вернуть»; «Вернуть» — исполняется один раз", async (e, t) => {
    openChat();
    const { t1, sp, ent } = await fireballSetup(e);
    const t0 = e.since(), hp1 = e.A(t1).hitPoints.value;
    const m = await castCard(e, ent, sp, 3, true);
    t.ok(!!m && e.gate(m).hold === "counter", "удержана");
    (await waitFor(() => plaqueBtn(e, m, "cancel"), 6000))?.click();   // плашка дорисовывается после создания карточки
    t.ok(await waitFor(() => e.gate(m).cancelled === true && !e.gate(m).hold, 6000), `отменена (${JSON.stringify(e.gate(m))})`);
    await region(e, m, 1300, 1100, 400);
    await wait(5000);
    t.ok(!e.use(m)?.state?.area && saveMsgs(e, t0).length === 0 && !e.use(m)?.state?.done, "после отмены область, спасброски и исполнение не стартуют");
    t.ok(e.A(t1).hitPoints.value === hp1, "урона нет");
    t.ok(await waitFor(() => e.dom(m)?.classList.contains("paf-counter-block"), 4000), "класс paf-counter-block");
    t.ok(visibleButtons(e, m).length === 0, `кнопки скрыты (${visibleButtons(e, m)})`);
    t.ok(!!plaqueBtn(e, m, "release") && !plaqueBtn(e, m, "cancel"), "плашка: только «Вернуть»");
    plaqueBtn(e, m, "release")?.click();
    t.ok(await waitFor(() => Object.keys(e.use(m)?.state?.challenge?.results ?? {}).length >= 2, 16000), "«Вернуть»: спасброски пошли");
    await wait(4000);
    t.ok(saveMsgs(e, t0).length === 2, `ровно один раз (${saveMsgs(e, t0).length} спасбросков)`);
  });

  sc("cancel-region", "Огненный шар: «Отменить» убирает мгновенный шаблон этого сотворения со сцены", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const m = await castCard(e, ent, sp, 3, true);
    t.ok(!!m && e.gate(m).hold === "counter", "удержана");
    const r = await region(e, m, 1300, 1100, 400);
    t.ok(!!r && e.scene.regions.has(r.id), "шаблон стоит");
    (await waitFor(() => plaqueBtn(e, m, "cancel"), 6000))?.click();
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 6000), "отменена");
    t.ok(await waitFor(() => !e.scene.regions.has(r.id), 6000), "шаблон удалён");
  });

  sc("missiles", "Волшебная стрела (variable-cast): удержано — урона нет; «Выпустить» — снаряды бросаются один раз, столько же, сколько без удержания", async (e, t) => {
    openChat();
    const { A0, sp0, entry } = await caster(e, "force-barrage"), V1 = await victim(e, "цель");
    const tA = await e.tok(A0, 1000, 1000, -1), t1 = await e.tok(V1, 1200, 1000, 1);
    await wait(900);
    const sp = e.A(tA).items.get(sp0.id), ent = e.A(tA).items.get(entry.id);
    await e.aim(tA, t1);
    // эталон: без удержания
    e.answers.push("2");
    let t0 = e.since();
    const base = await castCard(e, ent, sp, 1, false);
    await waitFor(() => dmgMsgs(e, t0, sp.uuid).length >= 1, 15000);
    await wait(3000);
    const expected = dmgMsgs(e, t0, sp.uuid).length;
    t.ok(!!base && expected >= 1, `эталон без удержания: ${expected} бросков урона`);
    // с удержанием
    await e.aim(tA, t1);
    e.answers.push("2");
    t0 = e.since();
    const m = await castCard(e, ent, sp, 1, true);
    t.ok(!!m && e.gate(m).hold === "counter", "удержана");
    t.ok(await waitFor(() => game.messages.get(m.id)?.flags?.[MOD]?.cast?.actions === 2, 8000), "число действий выбрано (окно осталось)");
    t.ok(await waitFor(() => game.messages.get(m.id)?.flags?.[MOD]?.cast?.missilesHeld === true, 5000), "снаряды отложены (missilesHeld)");
    await wait(3000);
    t.ok(dmgMsgs(e, t0, sp.uuid).length === 0, "урона нет, пока удержано");
    t.ok(visibleButtons(e, m).length === 0, `кнопки скрыты (${visibleButtons(e, m)})`);
    plaqueBtn(e, m, "release")?.click();
    t.ok(await waitFor(() => dmgMsgs(e, t0, sp.uuid).length >= expected, 15000), "после выпуска снаряды брошены");
    await wait(4000);
    t.ok(dmgMsgs(e, t0, sp.uuid).length === expected, `ровно один раз: ${dmgMsgs(e, t0, sp.uuid).length} из ${expected}`);
    t.ok(game.messages.get(m.id)?.flags?.[MOD]?.cast?.missilesHeld === false, "отметка снята");
  });

  sc("use-apply", "Заклинание с onUse.apply: удержано — эффекта нет; «Отменить» — нет и после; «Вернуть» — состояние наложено", async (e, t) => {
    openChat();
    const rule = { v: 1, onUse: { targets: "self", apply: [{ to: "self", condition: { slug: "frightened", value: 1 } }] } };
    const { A0, sp0, entry } = await caster(e, "sure-strike", rule);
    const tA = await e.tok(A0, 1000, 1000, -1);
    await wait(900);
    const sp = e.A(tA).items.get(sp0.id), ent = e.A(tA).items.get(entry.id);
    const cnd = () => e.A(tA).itemTypes.condition.find((c) => c.slug === "frightened")?.value ?? 0;
    await e.aim(tA);
    const m = await castCard(e, ent, sp, 1, true);
    t.ok(!!m && !!(await waitFor(() => e.use(m), 6000)), "карточка со снимком use");
    await wait(4000);
    t.ok(cnd() === 0 && !e.use(m)?.state?.done, `эффект не наложен (${cnd()})`);
    (await waitFor(() => plaqueBtn(e, m, "cancel"), 6000))?.click();   // плашка дорисовывается после создания карточки
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 6000), "отменена");
    await wait(4000);
    t.ok(cnd() === 0 && !e.use(m)?.state?.done, "после отмены эффекта нет");
    plaqueBtn(e, m, "release")?.click();
    t.ok(await waitFor(() => cnd() === 1, 10000), `«Вернуть»: испуг 1 (${cnd()})`);
    await wait(3000);
    t.ok(cnd() === 1 && e.A(tA).itemTypes.condition.filter((c) => c.slug === "frightened").length === 1, "ровно один раз");
  });

  // ---------- диспетчер реакции (M4, шаги 3–4): без ручного удержания, карточку держит сам модуль ----------
  const counterRule = (counter, extra = {}) => {
    const rule = { v: 1, onEvent: [{ on: "spell-cast", side: "near", range: 30, cost: "reaction", counter, ...extra }] };
    const v = api().validateRule(rule);
    if (!v.ok) throw new Error(`правило невалидно: ${v.errors.map(String).join("; ")}`);
    return rule;
  };
  /** NPC-контрзаклинатель с записью counter (предмет-действие с правилом в флаге) и токеном на сцене. Окно владельцу — NPC, значит ведущему: отвечает e.answers ("0" — принять, "__decline" — отказ). */
  const reactor = async (e, name, x, y, counter, extra = {}, system = {}) => {   // extra — поля записи (range "any"), system — поля предмета (frequency)
    const A = await e.foe(name);
    await e.give(A, { type: "action", name: "AF контрзаклинание", system: { actionType: { value: "reaction" }, description: { value: "<p><strong>Trigger</strong> A creature Casts a Spell.</p>" }, ...system }, flags: { [MOD]: { rule: counterRule(counter, extra) } } });
    return { A, tok: await e.tok(A, x, y, -1) };
  };
  const WIN = { mod: 40, rank: 3 }, LOSE = { mod: -30, rank: 3 };   // d20 зафиксирован на 10: итог 50 — крит. успех, -20 — крит. провал
  const hosts = (m) => game.messages.contents.filter((x) => String(x.flags?.[MOD]?.use?.state?.event ?? "").startsWith(`${m.id}:`));
  const settled = (m, n = 1) => hosts(m).filter((h) => h.flags[MOD].use.state.counter?.done).length >= n;
  const hasButtons = (e, m) => visibleButtons(e, m).length > 0;

  sc("counter-success", "Контрзаклинание: окно -> бросок -> сорвано: кнопок нет, плашка «Сорвано: …», область/спасброски/урон не стартуют, итоговая строка", async (e, t) => {
    openChat();
    const { sp, ent, t1 } = await fireballSetup(e);
    await reactor(e, "контрзаклинатель", 400, 1000, WIN);
    await wait(900);
    const t0 = e.since(), hp1 = e.A(t1).hitPoints.value;
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(!!m, "карточка сотворения");
    t.ok(await waitFor(() => e.gate(m).cancelled === true && !e.gate(m).hold, 25000), `сорвано (${JSON.stringify(e.gate(m))})`);
    const h = hosts(m)[0], st = h?.flags?.[MOD]?.use?.state;
    t.ok(hosts(m).length === 1 && st?.counter?.done === true && st.counter.degree === 3, `одна карточка проверки с исходом (${JSON.stringify(st?.counter)})`);
    t.ok(!game.messages.get(m.id).content.includes("card-buttons"), "content без card-buttons");
    t.ok(!!game.messages.get(m.id).flags[MOD].counterContent, "оригинал content во флаге");
    t.ok(await waitFor(() => e.dom(m)?.querySelector(".paf-hold")?.textContent.includes("AF контрзаклинание"), 6000), "плашка называет, кто сорвал");
    t.ok(!hasButtons(e, m), `кнопок нет (${visibleButtons(e, m)})`);
    t.ok(e.msgs(t0).some((x) => x.speaker?.alias === "AF контрзаклинание" && /сорвано/.test(x.content)), "итоговая строка");
    await region(e, m, 1300, 1100, 400);
    await wait(5000);
    t.ok(!e.use(m)?.state?.area && saveMsgs(e, t0).length === 0 && dmgMsgs(e, t0, sp.uuid).length === 0 && e.A(t1).hitPoints.value === hp1, "область, спасброски и урон не стартуют");
  });

  sc("counter-fail", "Контрзаклинание: провал проверки -> кандидатов больше нет -> выпуск: заклинание идёт, кнопки на месте, спасброски целей по одному разу", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    await reactor(e, "контрзаклинатель", 400, 1000, LOSE);
    await wait(900);
    const t0 = e.since();
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).replayed === true && !e.gate(m).hold, 25000), `выпущено (${JSON.stringify(e.gate(m))})`);
    t.ok(!e.gate(m).cancelled && settled(m) && hosts(m)[0].flags[MOD].use.state.counter.degree === 0, "карточка проверки: крит. провал, не сорвано");
    t.ok(game.messages.get(m.id).content.includes("card-buttons") && await waitFor(() => hasButtons(e, m), 4000), "кнопки pf2e на месте");
    await region(e, m, 1300, 1100, 400);
    t.ok(await waitFor(() => Object.keys(e.use(m)?.state?.challenge?.results ?? {}).length >= 1, 16000), "спасбросок цели пошёл");
    await wait(3000);
    t.ok(saveMsgs(e, t0).length === 2, `спасбросок каждой из двух целей ровно один раз (${saveMsgs(e, t0).length})`);
  });

  sc("counter-range", "Контрзаклинание: вне 30 фт и за стеной — окна нет, карточка не задерживается", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    await reactor(e, "далеко", 2200, 1000, WIN);   // 1600 px = 80 фт
    await reactor(e, "за стеной", 400, 1000, WIN);
    await e.scene.createEmbeddedDocuments("Wall", [{ c: [500, 800, 500, 1200], move: CONST.WALL_MOVEMENT_TYPES.NORMAL, sight: 20, light: 20, sound: 20 }]);
    await wait(900);
    e.answers.push("0", "0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(!!m && !e.gate(m).hold && !e.gate(m).cancelled, `не удержана (${JSON.stringify(e.gate(m))})`);
    await wait(3000);
    t.ok(e.answers.length === 2 && hosts(m).length === 0, "окон и карточек проверки нет");
    t.ok(game.messages.get(m.id).content.includes("card-buttons"), "кнопки на месте");
  });

  sc("counter-chain", "Два контрзаклинателя: ближний проваливает проверку -> дальний; его успех срывает; третьего окна нет", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const r1 = await reactor(e, "ближний", 400, 1000, LOSE), r2 = await reactor(e, "дальний", 200, 1000, WIN);
    await wait(900);
    e.answers.push("0", "0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true && settled(m, 2), 30000), `сорвано после двух проверок (${JSON.stringify(e.gate(m))}, карточек ${hosts(m).length})`);
    const hs = hosts(m).sort((a, b) => a._stats.createdTime - b._stats.createdTime);
    t.ok(hs.length === 2, `карточек проверки две (${hs.length})`);
    t.ok(hs[0]?.flags[MOD].use.state.counter.by.actor === e.T(r1.tok).name && hs[0].flags[MOD].use.state.counter.degree === 0, "первой — ближний, провал");
    t.ok(hs[1]?.flags[MOD].use.state.counter.by.actor === e.T(r2.tok).name && hs[1].flags[MOD].use.state.counter.degree === 3, "второй — дальний, успех");
    t.ok(e.answers.length === 0, "оба окна были, лишних нет");
    t.ok(e.gate(m).by?.actor === e.T(r2.tok).name, "плашка: сорвал дальний");
  });

  sc("counter-restore", "«Вернуть»: после срыва кнопки возвращаются, эффект onUse.apply наложен ровно один раз; пока сорвано — эффекта нет", async (e, t) => {
    openChat();
    const rule = { v: 1, onUse: { targets: "self", apply: [{ to: "self", condition: { slug: "frightened", value: 1 } }] } };
    const { A0, sp0, entry } = await caster(e, "sure-strike", rule);
    const tA = await e.tok(A0, 1000, 1000, -1);
    await reactor(e, "контрзаклинатель", 800, 1000, WIN);
    await wait(900);
    const sp = e.A(tA).items.get(sp0.id), ent = e.A(tA).items.get(entry.id);
    const cnd = () => e.A(tA).itemTypes.condition.find((c) => c.slug === "frightened")?.value ?? 0;
    await e.fix(10); await e.aim(tA);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 1, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 25000), "сорвано");
    await wait(4000);
    t.ok(cnd() === 0 && !e.use(m)?.state?.done, "пока сорвано — эффекта нет");
    (await waitFor(() => plaqueBtn(e, m, "release"), 6000))?.click();
    t.ok(await waitFor(() => cnd() === 1, 12000), `«Вернуть»: испуг 1 (${cnd()})`);
    await wait(3000);
    t.ok(cnd() === 1 && e.A(tA).itemTypes.condition.filter((c) => c.slug === "frightened").length === 1, "ровно один раз, повторного окна нет");
    t.ok(game.messages.get(m.id).content.includes("card-buttons") && !game.messages.get(m.id).flags[MOD].counterContent, "content восстановлен");
    t.ok(e.answers.length === 0 && hosts(m).length === 1, "новой проверки при выпуске не было");
  });

  sc("counter-none", "Нет контрзаклинателей на сцене: карточка уходит сразу (без удержания), эффект onUse.apply — как обычно", async (e, t) => {
    openChat();
    const rule = { v: 1, onUse: { targets: "self", apply: [{ to: "self", condition: { slug: "frightened", value: 1 } }] } };
    const { A0, sp0, entry } = await caster(e, "sure-strike", rule);
    const tA = await e.tok(A0, 1000, 1000, -1);
    await wait(900);
    const sp = e.A(tA).items.get(sp0.id), ent = e.A(tA).items.get(entry.id);
    await e.aim(tA);
    const m = await castCard(e, ent, sp, 1, false);
    t.ok(!!m && !e.gate(m).hold && !e.gate(m).cancelled, `без удержания (${JSON.stringify(e.gate(m))})`);
    t.ok(await waitFor(() => (e.A(tA).itemTypes.condition.find((c) => c.slug === "frightened")?.value ?? 0) === 1, 10000), "эффект наложен");
  });

  sc("counter-sustain", "Поддержание сорванного заклинания: якорь не ставится; «Вернуть» — якорь появляется", async (e, t) => {
    openChat();
    const { A0, sp0, entry } = await caster(e, "figment");
    const tA = await e.tok(A0, 1000, 1000, -1);
    await wait(900);
    const sp = e.A(tA).items.get(sp0.id), ent = e.A(tA).items.get(entry.id);
    const anchors = () => e.A(tA).items.filter((i) => i.flags?.[MOD]?.sustain);
    await e.aim(tA);
    await castCard(e, ent, sp, 1, false);   // эталон: без контрзаклинателей якорь ставится
    if (!(await waitFor(() => anchors().length, 8000))) throw new Skip("якорь Поддержания в этом мире не ставится даже без контрзаклинания");
    for (const a of anchors()) await a.delete();
    await reactor(e, "контрзаклинатель", 800, 1000, WIN);
    await wait(900);
    await e.fix(10); await e.aim(tA);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 1, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 25000), "сорвано");
    await wait(4000);
    t.ok(anchors().length === 0, "якоря нет");
    (await waitFor(() => plaqueBtn(e, m, "release"), 6000))?.click();
    t.ok(await waitFor(() => anchors().length === 1, 10000), "после «Вернуть» якорь есть");
  });

  // ---------- M4.8: последствия по исходу, иммунитет, частота, range any, переброс ----------
  const PERS = { to: "target", persistent: { formula: "1d10", damageType: "void" } };
  const IMM = { slug: "af-heretic", scope: "slug", duration: { value: 24, unit: "hours" } };
  const hasPers = (A) => A.itemTypes.condition.some((c) => c.slug === "persistent-damage");
  const hasImm = (A) => A.itemTypes.effect.some((i) => i.flags?.[MOD]?.immunity?.slug === IMM.slug);
  const casterDc = (ent) => ent.statistic?.dc?.value ?? ent.system?.spelldc?.dc ?? 20;
  const saves = () => import("/modules/pf2e-automato/scripts/saves.mjs");

  sc("counter-chastise", "Срыв с уроном заклинателю (Chastise-подобная): продолжительный void на заклинателе после итога, иммунитета нет; «Вернуть» снимает урон", async (e, t) => {
    openChat();
    const { tA, sp, ent } = await fireballSetup(e);
    await reactor(e, "контрзаклинатель", 400, 1000, { ...WIN, onCounter: [PERS], immunity: IMM });
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true && settled(m), 25000), `сорвано (${JSON.stringify(e.gate(m))})`);
    t.ok(await waitFor(() => hasPers(e.A(tA)), 10000), "продолжительный урон на заклинателе");
    t.ok(!hasImm(e.A(tA)), "при срыве иммунитета нет");
    const h = hosts(m)[0];
    t.ok(Object.keys(h.flags[MOD].use.state.challenge?.applied ?? {}).length === 1, "применение — по штатному пути карточки проверки (state.challenge.applied)");
    (await waitFor(() => plaqueBtn(e, m, "release"), 6000))?.click();
    t.ok(await waitFor(() => !hasPers(e.A(tA)), 10000), "«Вернуть»: продолжительный урон снят");
  });

  sc("counter-immunity", "Иммунитет по несрыву: успех, но ранг заклинания выше контр-ранга, — заклинание идёт, иммунитет на заклинателе, повторное сотворение окна не открывает", async (e, t) => {
    openChat();
    const { tA, sp, ent } = await fireballSetup(e);
    const dc = casterDc(ent);
    await reactor(e, "контрзаклинатель", 400, 1000, { mod: dc - 8, rank: 3, onCounter: [PERS], immunity: IMM });   // d20 = 10: итог dc+2 — успех; ранг 5 против 3 не срывается
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 5, false);
    t.ok(await waitFor(() => e.gate(m).replayed === true && !e.gate(m).hold && settled(m), 25000), `выпущено (${JSON.stringify(e.gate(m))})`);
    const st = hosts(m)[0].flags[MOD].use.state;
    t.ok(st.counter.degree === 2 && !e.gate(m).cancelled, `успех без срыва (степень ${st.counter.degree})`);
    t.ok(await waitFor(() => hasImm(e.A(tA)), 10000), "иммунитет на заклинателе");
    t.ok(!hasPers(e.A(tA)), "onCounter не исполнялся");
    e.answers.push("0");
    const m2 = await castCard(e, ent, sp, 5, false);
    await wait(3500);
    t.ok(!!m2 && !e.gate(m2).hold && hosts(m2).length === 0 && e.answers.length === 1, "повторное сотворение: окна и проверки нет");
    e.answers.length = 0;
  });

  sc("counter-frequency", "Частота 1/день: после срыва окно второго сотворения не открывается; счётчик предмета 0", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const r = await reactor(e, "контрзаклинатель", 400, 1000, WIN, {}, { frequency: { value: 1, max: 1, per: "day" } });
    const item = () => e.A(r.tok).items.find((i) => i.name === "AF контрзаклинание");
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 25000), "сорвано");
    t.ok(await waitFor(() => item().system.frequency.value === 0, 6000), `частота списана (${item().system.frequency.value})`);
    e.answers.push("0");
    const m2 = await castCard(e, ent, sp, 3, false);
    await wait(3500);
    t.ok(!!m2 && !e.gate(m2).hold && hosts(m2).length === 0 && e.answers.length === 1, "второе сотворение: окна нет");
    e.answers.length = 0;
  });

  sc("counter-range-any", "range \"any\": контрзаклинатель в 80 фт получает окно; за стеной — нет (стены в силе)", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    await reactor(e, "далеко", 2200, 1000, WIN, { range: "any" });   // 80 фт от заклинателя
    await reactor(e, "за стеной", 400, 1000, WIN, { range: "any" });
    await e.scene.createEmbeddedDocuments("Wall", [{ c: [500, 800, 500, 1200], move: CONST.WALL_MOVEMENT_TYPES.NORMAL, sight: 20, light: 20, sound: 20 }]);
    await wait(900);
    e.answers.push("0", "0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 25000), `дальний сорвал (${JSON.stringify(e.gate(m))})`);
    t.ok(hosts(m).length === 1 && e.answers.length === 1, `окно одно (карточек ${hosts(m).length}, неиспользованных ответов ${e.answers.length}): за стеной окна нет`);
    e.answers.length = 0;
  });

  sc("counter-reroll-after-apply", "Переброс после применения: changedAfterApply, последствия не повторяются, исход не переигрывается; «Вернуть» снимает применённое", async (e, t) => {
    openChat();
    const { tA, sp, ent } = await fireballSetup(e);
    await reactor(e, "контрзаклинатель", 400, 1000, { ...WIN, onCounter: [PERS] });
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true && hasPers(e.A(tA)), 25000), "сорвано, урон наложен");
    const h = hosts(m)[0], key = Object.keys(h.flags[MOD].use.state.challenge.results)[0];
    const r = await (await saves()).recordResult(h.id, key, { degree: 0, total: 1, dc: 20, isReroll: true, rollMessageId: "af-reroll" });
    t.ok(r.ok && r.changed, `переброс принят после применения (${JSON.stringify(r)})`);
    const st = game.messages.get(h.id).flags[MOD].use.state;
    t.ok(st.challenge.results[key].changedAfterApply === true && st.counter.degree === 0, "changedAfterApply, исход обновлён");
    await wait(2500);
    t.ok(e.A(tA).itemTypes.condition.filter((c) => c.slug === "persistent-damage").length === 1 && e.gate(m).cancelled === true, "урон один раз, срыв не переигран");
    (await waitFor(() => plaqueBtn(e, m, "release"), 6000))?.click();
    t.ok(await waitFor(() => !hasPers(e.A(tA)), 10000), "«Вернуть» снимает применённое");
  });

  // ---------- трата ячейки (M4.9, counter.expend): NPC-контрзаклинатель с записью колдовства ----------
  /** Контрзаклинатель с записью «AF» (kind: spontaneous | prepared) и правилом counter. spells — slug заклинаний записи; slots — {ранг: число} (спонтанная) либо
   *  prep — {ранг: [slug | {slug, expended}]} (подготовленная). party — союзник «партии» (враг для заклинателя-монстра: нужен записям каталога с when origin:enemy). */
  const slotReactor = async (e, name, x, y, counter, { kind = "spontaneous", spells = ["fireball"], slots = { 3: 2 }, prep = {}, extra = {}, party = false, item = null } = {}) => {
    const A = party ? await victim(e, name) : await e.foe(name);
    const lv = (r) => (kind === "prepared" ? (prep[r]?.length ?? 0) : (slots[r] ?? 0));
    const [entry] = await e.give(A, { type: "spellcastingEntry", name: "AF", system: { ability: { value: "cha" }, spelldc: { value: 30, dc: 40 }, tradition: { value: "arcane" }, prepared: { value: kind }, slots: Object.fromEntries([1, 2, 3, 4, 5].map((r) => [`slot${r}`, { max: lv(r), value: kind === "prepared" ? 0 : lv(r) }])) } });
    const docs = [];
    for (const slug of spells) { const d = await find("pf2e.spells-srd", slug); d.system.location = { value: entry.id }; docs.push(d); }
    const made = await e.give(A, ...docs);
    if (kind === "prepared") {
      const idOf = (slug) => made.find((s) => s.slug === slug)?.id;
      await entry.update(Object.fromEntries(Object.entries(prep).map(([r, list]) => [`system.slots.slot${r}.prepared`, Object.fromEntries(list.map((p, i) => [i, { id: idOf(p.slug ?? p), expended: !!p.expended }]))])));
    }
    await e.give(A, item ?? { type: "action", name: "AF контрзаклинание", system: { actionType: { value: "reaction" }, description: { value: "<p><strong>Trigger</strong> A creature Casts a Spell.</p>" } }, flags: { [MOD]: { rule: counterRule(counter, { range: "any", ...extra }) } } });
    return { A, tok: await e.tok(A, x, y, party ? 1 : -1), entryId: entry.id };
  };
  const entryOf = (A) => A.itemTypes.spellcastingEntry.find((x) => x.name === "AF");
  const spentOps = (m) => (game.messages.get(m.id)?.flags?.[MOD]?.events ?? []).flatMap((r) => (r.recs ?? []).flatMap((x) => x.ops ?? [])).filter((o) => o.op === "slotExpended");
  const prepExpended = (A, rank) => Object.values(entryOf(A).system.slots[`slot${rank}`].prepared).map((p) => !!p.expended);

  sc("counter-slot-spont", "Спонтанная запись: ячейка 3-го ранга потрачена одна (запись журнала slotExpended), проверка — counteraction этой записи, контр-ранг = ранг ячейки; «Вернуть» ячейку не возвращает", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const r = await slotReactor(e, "спонтанный", 400, 1000, { expend: { from: "slot", spell: "same" } });
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 25000), `сорвано (${JSON.stringify(e.gate(m))})`);
    const A = () => e.A(r.tok), h = hosts(m)[0], use = h?.flags?.[MOD]?.use;
    t.ok(entryOf(A()).system.slots.slot3.value === 1, `ячейка потрачена одна: ${entryOf(A()).system.slots.slot3.value}/2`);
    const ops = spentOps(m);
    t.ok(ops.length === 1 && ops[0].rank === 3 && ops[0].prev === 2 && ops[0].slot === null && ops[0].entry === r.entryId, `запись журнала: ${JSON.stringify(ops)}`);
    t.ok(use?.rule?.onUse?.check?.entry === r.entryId && use.rule.onUse.check.mod === undefined, `проверка закреплена за записью (${JSON.stringify(use?.rule?.onUse?.check)})`);
    t.ok(use?.state?.counter?.counterRank === 3, `контр-ранг — ранг ячейки (${use?.state?.counter?.counterRank})`);
    (await waitFor(() => plaqueBtn(e, m, "release"), 6000))?.click();
    await wait(4000);
    t.ok(entryOf(A()).system.slots.slot3.value === 1 && spentOps(m).length === 1, "«Вернуть»: ячейка не возвращается (цена сотворения потрачена), повторной траты нет");
  });

  sc("counter-slot-prepared", "Подготовленная запись: две копии заклинания в слотах 3-го ранга — тратится один слот (первый неистраченный), потраченный ранее не трогается; без окна выбора", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const r = await slotReactor(e, "подготовленный", 400, 1000, { expend: { from: "prepared", spell: "same" } }, { kind: "prepared", prep: { 3: [{ slug: "fireball", expended: true }, "fireball", "fireball"] } });
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => e.gate(m).cancelled === true, 25000), `сорвано (${JSON.stringify(e.gate(m))})`);
    t.ok(prepExpended(e.A(r.tok), 3).join() === "true,true,false", `потрачен первый неистраченный слот (${prepExpended(e.A(r.tok), 3)})`);
    const ops = spentOps(m);
    t.ok(ops.length === 1 && ops[0].slot === 1 && ops[0].rank === 3, `запись журнала: ${JSON.stringify(ops)}`);
    t.ok(e.answers.length === 0, "окно одно, без дополнительных вопросов");
  });

  sc("counter-slot-choose", "Несколько ячеек (3-й и 5-й ранг, «не ниже»): окно с вариантами; выбран 5-й — потрачен он, контр-ранг 5; 3-й цел", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const r = await slotReactor(e, "выбор", 400, 1000, { expend: { from: "prepared", spell: "same", rank: "min" } }, { kind: "prepared", prep: { 3: ["fireball"], 5: ["fireball"] } });
    await wait(900);
    e.answers.push("1");   // второй вариант в списке — 5-й ранг
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => hosts(m).length === 1, 25000), "карточка проверки создана");
    t.ok(prepExpended(e.A(r.tok), 5).join() === "true" && prepExpended(e.A(r.tok), 3).join() === "false", `потрачен 5-й ранг, 3-й цел (3: ${prepExpended(e.A(r.tok), 3)}, 5: ${prepExpended(e.A(r.tok), 5)})`);
    t.ok(hosts(m)[0].flags[MOD].use.state.counter.counterRank === 5, `контр-ранг 5 (${hosts(m)[0].flags[MOD].use.state.counter.counterRank})`);
    t.ok(e.answers.length === 0, "ответ окна израсходован");
  });

  sc("counter-slot-none", "Нет подходящей ячейки (ячейки кончились / заговор, а не ячейка): окна нет, карточка не удержана, реакция и ячейки целы", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const r = await slotReactor(e, "пустой", 400, 1000, { expend: { from: "slot", spell: "same" } }, { slots: { 3: 0 } });
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    await wait(3500);
    t.ok(!!m && !e.gate(m).hold && hosts(m).length === 0 && e.answers.length === 1, `ячеек нет — окна нет (${JSON.stringify(e.gate(m))}, ответов ${e.answers.length})`);
    t.ok(spentOps(m).length === 0 && entryOf(e.A(r.tok)).system.slots.slot3.value === 0, "ничего не потрачено");
    e.answers.length = 0;
    // заговор в репертуаре: pf2e consume для заговора ничего не списывает — «бесплатной ячейки» быть не должно
    const c = await caster(e, "ray-of-frost");
    const tC = await e.tok(c.A0, 600, 1400, -1);
    await slotReactor(e, "заговорщик", 400, 1400, { expend: { spell: "same" } }, { spells: ["ray-of-frost"], slots: { 1: 3 } });
    await wait(900);
    await e.aim(tC);
    e.answers.push("0");
    const m2 = await castCard(e, e.A(tC).items.get(c.entry.id), e.A(tC).items.get(c.sp0.id), 1, false);
    await wait(3500);
    t.ok(!!m2 && !e.gate(m2).hold && hosts(m2).length === 0 && e.answers.length === 1, `заговор не открывает окно (${JSON.stringify(e.gate(m2))})`);
    e.answers.length = 0;
  });

  sc("counter-slot-when", "Условие триггера отдельно от траты: spell-cast:prepared — заклинание не подготовлено, окна нет, хотя слот другого заклинания есть; подготовили — окно, тратится любое подготовленное", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const r = await slotReactor(e, "условие", 400, 1000, { expend: { from: "prepared", spell: "any" } }, { kind: "prepared", spells: ["fireball", "sure-strike"], prep: { 3: ["sure-strike"] }, extra: { when: ["spell-cast:prepared"] } });
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    await wait(3500);
    t.ok(!!m && !e.gate(m).hold && hosts(m).length === 0 && e.answers.length === 1, `не подготовлено — окна нет (${JSON.stringify(e.gate(m))})`);
    const A = e.A(r.tok), fb = A.items.find((i) => i.slug === "fireball"), ss = A.items.find((i) => i.slug === "sure-strike");
    await entryOf(A).update({ "system.slots.slot3.max": 2, "system.slots.slot3.prepared": { 0: { id: ss.id, expended: false }, 1: { id: fb.id, expended: false } } });
    await wait(500);
    const m2 = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => hosts(m2).length === 1, 25000), "подготовлено — окно открылось, карточка проверки создана");
    t.ok(prepExpended(e.A(r.tok), 3).join() === "true,false", `потрачено первое подготовленное в ранге, любое («Верный удар»): ${prepExpended(e.A(r.tok), 3)}`);
    e.answers.length = 0;
  });

  sc("counter-slot-catalog", "Каталог: Dueling Counter (любая ячейка) у союзника партии против монстра-заклинателя — окно, трата ячейки; запись берётся из каталога по источнику, when origin:enemy", async (e, t) => {
    openChat();
    const { sp, ent } = await fireballSetup(e);
    const dc = await find("pf2e.actionspf2e", "dueling-counter");
    const r = await slotReactor(e, "дуэлянт", 400, 1000, null, { slots: { 3: 2 }, party: true, item: dc });
    await wait(900);
    e.answers.push("0");
    const m = await castCard(e, ent, sp, 3, false);
    t.ok(await waitFor(() => hosts(m).length === 1, 25000), `окно открылось, проверка создана (${JSON.stringify(e.gate(m))})`);
    t.ok(entryOf(e.A(r.tok)).system.slots.slot3.value === 1 && spentOps(m).length === 1, `ячейка потрачена одна: ${entryOf(e.A(r.tok)).system.slots.slot3.value}/2`);
    e.answers.length = 0;
  });

  // ---------- прогон ----------
  const rows = [];
  const pick = S.filter((s) => (!opts.only || opts.only.includes(s.id)) && !opts.skip.includes(s.id));
  const applyPrev = setting("mode.apply");
  try {
    await setFlags({ showCheckDialogs: false, showDamageDialogs: false });
    await game.settings.set(MOD, "useToolbeltTargetHelper", false);
    if (applyPrev !== "auto") await game.settings.set(MOD, "mode.apply", "auto");
    for (const s of pick) {
      const t = { fails: [], n: 0, ok(c, label) { this.n++; if (!c) this.fails.push(label); } };
      let e = null, status = "ok", detail = "";
      notes.length = 0;
      try {
        e = await newEnv(s.id); cur = e;
        const run = s.run(e, t); run.catch(() => {});
        let timer;
        try { await Promise.race([run, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("таймаут 170 с")), 170000); })]); }
        finally { clearTimeout(timer); }
        if (t.fails.length) { status = "fail"; detail = t.fails.join("; "); } else detail = `${t.n} проверок`;
      } catch (err) {
        if (err instanceof Skip) { status = "skip"; detail = err.message; }
        else { status = "fail"; detail = `${t.fails.length ? t.fails.join("; ") + "; " : ""}ошибка: ${String(err?.message ?? err).slice(0, 400)}`; console.error(`${MOD} counterspell | ${s.id}`, err); }
      } finally {
        const left = e ? await e.dispose().catch((x) => `dispose: ${x}`) : 0;
        if (left) { status = "fail"; detail += ` | после уборки осталось: ${left}`; }
      }
      const errs = notes.filter((n) => /^(console\.error|uncaught)/.test(n) && !/createScrollingText|showFloatyText|reading 'position'\) at set y|dice-calculator/.test(n));
      if (errs.length) { status = "fail"; detail += ` | ошибки: ${errs.slice(0, 3).join(" / ")}`; }
      else if (status === "fail" && notes.length) detail += ` | уведомления: ${notes.slice(0, 4).join(" / ")}`;
      rows.push({ id: s.id, title: s.title, status, detail });
    }
  } finally {
    Object.assign(N, nOrig);
    console.error = ceOrig;
    window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onErr);
    try { await game.settings.set(MOD, "mode.apply", applyPrev); } catch { /* ok */ }
    try { await game.settings.set(MOD, "useToolbeltTargetHelper", tbPrev); } catch { /* ok */ }
    try { await setFlags(origFlags); } catch { /* ok */ }
    await sweep();
    await prevScene?.view();
    if (prevCombat) { try { await ui.combat.initialize({ combat: prevCombat }); } catch { /* ok */ } }
  }
  const out = rows.map((r) => `${r.status === "ok" ? "PASS" : r.status.toUpperCase()} ${r.id}: ${r.detail}`);
  console.table(rows.map(({ id, status, detail }) => ({ сценарий: id, статус: status, подробности: detail })));
  window.__afCSResult = out;
  return out;
}
