async () => {
  // Живой сценарий гейта требований манёвров (builtin/maneuver-gate.mjs). Копии «AF тест: …» и сцена создаются и удаляются сценарием.
  // NPC-копия (гоблин): Trip/Grapple по Huge-цели и вне досягаемости — броска нет; с Alt, [[/act]] из чужого описания — бросок есть; Demoralize дальше 30 фт — блок.
  // PC-копии (у NPC нет рук): нет свободной руки, меч+щит, кнут по диагонали, Trip крит (урон ОДИН раз, @Damage в заметке погашена), Sly Disarm, Goading Feint, unchecked у Improved Grab.
  // Окна выбора модуля закрываются/отвечаются фоновым циклом. Результат — window.__afMGResult.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(150); } return null; };
  const SHIFT = () => new MouseEvent("click", { shiftKey: !!game.user.flags.pf2e?.settings?.showCheckDialogs });
  const rows = [], warns = [];
  const N = ui.notifications, warnOrig = N.warn;
  N.warn = function (m, ...r) { warns.push(String(m)); return warnOrig.call(this, m, ...r); };
  const prevScene = game.scenes.viewed;
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const created = { msgs: new Set() };
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.msgs.add(m.id); });
  let scene, me, foe, big, tMe, tFoe, tBig, stop = false, d20 = null;
  const mode = game.settings.get(MOD, "mode.limits"), modeApply = game.settings.get(MOD, "mode.apply");
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const mk = async (name, size) => { const a = await Actor.create({ ...(await fromUuid(GOBLIN)).toObject(), name: PFX + name, folder, ownership: { default: 0 } }); if (size) await a.update({ "system.traits.size.value": size }); return a; };
  const tok = async (a, x, y) => (await scene.createEmbeddedDocuments("Token", [{ ...(await a.getTokenDocument({ x, y })).toObject() }]))[0];
  // герой-копия: пустой персонаж + предметы из компендиев по slug; held: { slug: рук }
  const pk = async (pack, slug) => {
    const idx = await game.packs.get(pack).getIndex({ fields: ["system.slug"] });
    const e = idx.find((x) => x.system?.slug === slug);
    if (!e) throw new Error(`нет ${slug} в ${pack}`);
    return (await fromUuid(e.uuid)).toObject();
  };
  const pc = async (name, { held = {}, feats = [] } = {}) => {
    const a = await Actor.create({ name: PFX + name, type: "character", folder, ownership: { default: 0 } });
    for (const [slug, hands] of Object.entries(held)) {
      const src = await pk("pf2e.equipment-srd", slug);
      src.system.equipped = { carryType: "held", handsHeld: hands };
      await a.createEmbeddedDocuments("Item", [src]);
    }
    for (const slug of feats) await a.createEmbeddedDocuments("Item", [await pk("pf2e.feats-srd", slug)]);
    await wait(300);
    return a;
  };
  const rig = (a, selector, value = 30) => a.createEmbeddedDocuments("Item", [{ type: "effect", name: "AF rig", system: { slug: "af-rig", rules: [{ key: "FlatModifier", selector, value }] } }]);
  const fix = async (n) => {
    if (d20 === null) d20 = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = n == null ? d20 : () => 1 - (n - 0.5) / 20;
  };
  const dom = (m) => ui.chat.element?.querySelector?.(`[data-message-id="${m.id}"]`) ?? document.querySelector(`[data-message-id="${m.id}"]`);
  const target = (from, tgt) => {
    from.object.control({ releaseOthers: true });
    game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
    tgt.object.setTarget(true, { releaseOthers: false });
    return wait(300);
  };
  const rolledMsg = (slug, t0) => game.messages.contents.find((m) => m._stats.createdTime >= t0 && (m.flags?.pf2e?.context?.options ?? []).includes(`action:${slug}`));
  const attempt = async (slug, actor, tFrom, tTo, { alt = false, statistic } = {}) => {
    const t0 = Date.now(); warns.length = 0;
    await target(tFrom, tTo);
    const orig = game.keyboard.isModifierActive.bind(game.keyboard);
    if (alt) game.keyboard.isModifierActive = (k) => k === "Alt" || orig(k);
    try { await game.pf2e.actions.get(slug).use({ actors: [actor], target: tTo.object, event: SHIFT(), ...(statistic && { statistic }) }); } finally { game.keyboard.isModifierActive = orig; }
    await wait(800);
    const m = rolledMsg(slug, t0);
    return { m, t0, rolled: !!m, warned: warns.some((w) => /Alt/.test(w)) };
  };
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  // окна модуля (выбор шага choose): первый вариант, иначе закрыть
  (async () => {
    const seen = new Set();
    while (!stop) {
      for (const el of document.querySelectorAll(".paf-dialog")) {
        if (seen.has(el.id)) continue;
        seen.add(el.id);
        const sel = el.querySelector("select[name=choice]"), radio = el.querySelector("input[name=choice]");
        if (sel) { sel.selectedIndex = 0; el.querySelector("button[data-action=ok]")?.click(); }
        else if (radio) { radio.checked = true; el.querySelector("button[data-action=ok]")?.click(); }
        else foundry.applications.instances.get(el.id)?.close();
      }
      await wait(200);
    }
  })();
  try {
    await game.settings.set(MOD, "mode.limits", "auto");
    await game.settings.set(MOD, "mode.apply", "auto");
    scene = await Scene.create({ name: `${PFX}сцена`, width: 2400, height: 2000, padding: 0, grid: { size: 100, distance: 5 }, navigation: false, tokenVision: false });
    await scene.view(); await wait(700);
    me = await mk("гоблин"); foe = await mk("враг"); big = await mk("великан", "huge");
    tMe = await tok(me, 100, 100); tFoe = await tok(foe, 200, 100); tBig = await tok(big, 200, 200);
    await wait(500);
    const a = (slug, t, o) => attempt(slug, me, tMe, t, o);
    // --- NPC-копия ---
    let r = await a("trip", tFoe); row("NPC, рядом: бросок", r.rolled && !r.warned);
    r = await a("trip", tBig); row("Huge-цель (на 2 размера больше Small): блок", !r.rolled && r.warned);
    r = await a("trip", tBig, { alt: true }); row("Huge-цель + Alt: бросок", r.rolled);
    await tFoe.update({ x: 1100 }); await wait(400);
    r = await a("trip", tFoe); row("вне досягаемости: блок", !r.rolled && r.warned);
    r = await a("demoralize", tFoe); row("Demoralize дальше 30 фт: блок", !r.rolled && r.warned);
    await tFoe.update({ x: 200 }); await wait(400);

    // --- PC: нет свободной руки / меч+щит ---
    const two = await pc("два меча", { held: { longsword: 1 } });
    const sw2 = await pk("pf2e.equipment-srd", "longsword"); sw2.system.equipped = { carryType: "held", handsHeld: 1 };
    await two.createEmbeddedDocuments("Item", [sw2]); await wait(300);
    const tTwo = await tok(two, 100, 400);
    row("предпосылка: handsReallyFree двух мечей = 0", two.handsReallyFree === 0, `really=${two.handsReallyFree}, free=${two.handsFree}`);
    r = await attempt("trip", two, tTwo, tFoe); row("нет свободной руки: Trip блок", !r.rolled && r.warned);
    r = await attempt("demoralize", two, tTwo, tFoe); row("нет свободной руки: Demoralize не требует руки", r.rolled);

    const shd = await pc("меч и щит", { held: { longsword: 1, "steel-shield": 1 } });
    const tShd = await tok(shd, 100, 600);
    row("предпосылка: меч+щит — really 0, free 1 (pf2e щит руку не считает)", shd.handsReallyFree === 0, `really=${shd.handsReallyFree}, free=${shd.handsFree}`);
    r = await attempt("trip", shd, tShd, tFoe); row("меч + щит: Trip блок", !r.rolled && r.warned);

    // --- кнут по диагонали: щит+кнут (руки нет, оружие trip, reach 10), цель в двух клетках по диагонали (10 фт по правилу pf2e) ---
    const wh = await pc("кнут", { held: { whip: 1, "steel-shield": 1 } });
    const tWh = await tok(wh, 100, 900), tDiag = await tok(await mk("цель по диагонали"), 300, 1100);
    await wait(400);
    r = await attempt("trip", wh, tWh, tDiag); row("кнут, цель по диагонали на 2 клетки: бросок (не блок 15 > 10)", r.rolled && !r.warned, `warns=${warns.join("|")}`);

    // --- Trip крит. успех: урон ОДИН раз, @Damage в заметке погашена ---
    const trp = await pc("подсекающий");
    const tTrp = await tok(trp, 100, 1300), vic = await mk("жертва"), tVic = await tok(vic, 200, 1300);
    await rig(trp, "athletics"); await wait(300);
    await fix(10);
    const va = tVic.actor;   // несвязанный токен: урон ложится на актёра токена, не мира
    const hp0 = va.system.attributes.hp.value;
    r = await attempt("trip", trp, tTrp, tVic);
    await waitFor(() => va.system.attributes.hp.value < hp0, 15000);   // шаги по степени идут после анимации Dice So Nice (4–5 с)
    await wait(800);
    const drop = hp0 - va.system.attributes.hp.value;
    row("Trip крит. успех: исход critical", r.m?.flags?.pf2e?.context?.outcome === "criticalSuccess", String(r.m?.flags?.pf2e?.context?.outcome));
    row("Trip крит.: урон нанесён один раз (1d6 при d20=10 -> 3)", drop === 3, `hp ${hp0} -> ${va.system.attributes.hp.value}, потеряно ${drop}`);
    const el = r.m && dom(r.m);
    row("Trip крит.: ссылка @Damage в заметке pf2e погашена", !!el && !el.querySelector("a.inline-roll[data-damage-roll]") && !!el.querySelector(".paf-dealt"), el ? "" : "нет DOM карточки");
    await fix(null);

    // --- Sly Disarm: черта + бросок Воровством -> off-guard ---
    const sly = await pc("хитрый", { feats: ["sly-disarm"] });
    const tSly = await tok(sly, 100, 1500), dv = await mk("обезоруживаемый"), tDv = await tok(dv, 200, 1500);
    await rig(sly, "thievery"); await wait(300); await fix(10);
    r = await attempt("disarm", sly, tSly, tDv, { statistic: "thievery" });
    const og = await waitFor(() => tDv.actor.itemTypes.condition.some((c) => c.slug === "off-guard"), 15000);   // после анимации кубиков
    row("Sly Disarm (Воровство): цель off-guard", !!r.m && !!og, `исход ${r.m?.flags?.pf2e?.context?.outcome}`);
    await fix(null);

    // --- Goading Feint: выбор -> эффект на цель ---
    const gd = await pc("подначивающий", { feats: ["goading-feint"] });
    const tGd = await tok(gd, 100, 1700), gv = await mk("подначиваемый"), tGv = await tok(gv, 200, 1700);
    await rig(gd, "deception"); await wait(300); await fix(10);
    r = await attempt("feint", gd, tGd, tGv);
    const ef = await waitFor(() => tGv.actor.itemTypes.effect.some((i) => i.sourceId === "Compendium.pf2e.feat-effects.Item.rflbFzV44Fd6aBLE"), 15000);
    row("Goading Feint (выбор goading): эффект на цели", !!r.m && !!ef, `исход ${r.m?.flags?.pf2e?.context?.outcome}; окно выбора отвечает первым вариантом (goading)`);
    await fix(null);

    // --- Improved Grab у NPC: Захват по Huge (на 2 размера больше) идёт через unchecked ---
    const melee = me.itemTypes.melee[0];
    if (!melee) row("Improved Grab: у NPC нет Удара melee", false);
    else {
      await melee.update({ "system.attackEffects.value": ["improved-grab"] });
      await rig(me, "attack-roll"); await rig(me, "athletics"); await wait(300); await fix(10);
      await target(tMe, tBig);
      const t0 = Date.now(); warns.length = 0;
      const strike = me.system.actions.find((x) => x.item?.id === melee.id);
      await strike.variants[0].roll({ event: SHIFT() });
      const g = await waitFor(() => rolledMsg("grapple", t0), 10000);
      row("Improved Grab по Huge: Захват брошен (unchecked), без блока", !!g && !warns.some((w) => /Alt/.test(w)), `warns=${warns.join("|")}`);
      await fix(null);
    }

    // --- [[/act]] из описания чужого предмета: пропуск; без чужого предмета (журнал) — блок ---
    const giver = sly.items.find((i) => i.type === "feat");
    const msg = await giver.toMessage();
    const html = document.createElement("div"); html.className = "chat-message";
    html.innerHTML = `<span data-pf2-action="trip">Trip</span>`;
    document.body.append(html);
    html.querySelector("span").dispatchEvent(new MouseEvent("click", { bubbles: true }));   // без data-message-id и листа предмета — «голый»
    r = await a("trip", tBig); row("клик по ссылке вне предмета (журнал): бросок по Huge блокируется", !r.rolled && r.warned);
    await wait(2200);
    html.dataset.messageId = msg.id;
    html.querySelector("span").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    r = await a("trip", tBig); row("клик по ссылке из карточки чужого предмета: бросок по Huge не блокируется", r.rolled, "настоящий [[/act]] из Slam Down проверить руками");
    html.remove();
  } catch (e) { row("ошибка", false, String(e?.stack ?? e).slice(0, 300)); }
  finally {
    stop = true; await fix(null).catch(() => {});
    N.warn = warnOrig; Hooks.off("createChatMessage", hook);
    try { await game.settings.set(MOD, "mode.limits", mode); await game.settings.set(MOD, "mode.apply", modeApply); } catch { /* ok */ }
    if (created.msgs.size) await ChatMessage.deleteDocuments([...created.msgs].filter((id) => game.messages.has(id))).catch(() => {});
    if (prevScene && prevScene.id !== scene?.id) await prevScene.view().catch(() => {});
    await wait(800);
    await scene?.delete().catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
  }
  console.table(rows);
  window.__afMGResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afMGResult;
}
