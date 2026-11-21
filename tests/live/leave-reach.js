async () => {
  // Живой сценарий реакций «враг уходит из досягаемости» (builtin/reactive-strike.mjs, onLeave/bindLeave; К2 плана plan-rustyspirit-gaps.md §6).
  // Копии «AF тест: …», сцена и бой создаются и удаляются сценарием. Результат — window.__afLRResult.
  //  1. no-escape (черта rage) без ярости: враг уходит — подсказки нет;  2. в ярости — подсказка с кнопкой «Использовать реакцию»;
  //  3. враг сдвинулся внутри досягаемости — подсказки нет;  4. кнопка -> карточка предмета, реакция потрачена: новый уход — подсказки нет;
  //  5. assassins-pursuit без добычи — подсказки нет, с меткой «hunted-prey» на враге — есть.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const NO_ESCAPE = "Compendium.pf2e.feats-srd.Item.lT8XlX1Ig900BblS";
  const prevScene = game.scenes.viewed;
  const created = { msgs: new Set() };
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.msgs.add(m.id); });
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  let scene, combat;
  const leaveHints = (t0) => game.messages.contents.filter((m) => m._stats.createdTime >= t0 && String(m.content).includes("data-af-react-leave"));
  const tok = async (a, x, y) => (await scene.createEmbeddedDocuments("Token", [{ ...(await a.getTokenDocument({ x, y })).toObject() }]))[0];
  const move = async (t, x, y) => { await t.move([{ x, y }], { autoRotate: false }); await wait(1500); };   // без ignoreWalls: такой перенос модуль не считает перемещением
  const pc = async (name) => {   // родословная — ради ПЗ: у голого персонажа 0/0, onLeave такого держателя пропускает как выбывшего; alliance — иначе токен враждебен
    const a = await Actor.create({ name: PFX + name, type: "character", folder, ownership: { default: 0 }, system: { details: { alliance: "party" } } });   // отношение токена pf2e выводит из союзничества
    const anc = (await game.packs.get("pf2e.ancestries").getIndex({ fields: ["system.slug"] })).find((i) => i.system?.slug === "human");
    if (anc) await a.createEmbeddedDocuments("Item", [(await game.packs.get("pf2e.ancestries").getDocument(anc._id)).toObject()]);
    await a.update({ "system.attributes.hp.value": a.hitPoints.max });
    return a;
  };
  try {
    scene = await Scene.create({ name: PFX + "сцена", width: 2000, height: 2000, grid: { size: 100, distance: 5 }, padding: 0 });
    await scene.view(); await wait(1500);
    const leo = await pc("Леонард"), hunter = await pc("Охотник");
    await leo.createEmbeddedDocuments("Item", [(await fromUuid(NO_ESCAPE)).toObject()]);
    await hunter.createEmbeddedDocuments("Item", [{ type: "action", name: "AF преследование", system: { slug: "assassins-pursuit", actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] } } }]);
    const foeActor = await Actor.create({ ...(await fromUuid(GOBLIN)).toObject(), name: PFX + "враг", folder, ownership: { default: 0 } });
    const tLeo = await tok(leo, 500, 500), tHunter = await tok(hunter, 1200, 1200), tFoe = await tok(foeActor, 600, 500);
    await tFoe.update({ disposition: -1 });
    combat = await Combat.create({ scene: scene.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", [tLeo, tHunter, tFoe].map((t, i) => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actor.id, initiative: 20 - i })));
    await combat.startCombat(); await wait(1200);
    const item = leo.items.find((i) => i.slug === "no-escape");
    row("у Леонарда есть No Escape с чертой rage", !!item && item.system.traits.value.includes("rage"));

    // 1. без ярости
    let t0 = Date.now();
    await move(tFoe, 900, 500);
    row("без ярости: подсказки «уходит» нет", leaveHints(t0).length === 0);

    // 2. в ярости: враг возвращается к держателю и уходит снова
    await leo.createEmbeddedDocuments("Item", [{ type: "effect", name: "AF ярость", system: { slug: "effect-rage", rules: [] } }]);
    await wait(300);
    await move(tFoe, 600, 500);
    t0 = Date.now();
    await move(tFoe, 900, 500);
    const hint = leaveHints(t0)[0];
    row("в ярости: подсказка с кнопкой", !!hint, `подсказок: ${leaveHints(t0).length}`);

    // 3. движение внутри досягаемости
    await move(tFoe, 600, 500);
    t0 = Date.now();
    await move(tFoe, 600, 600);
    row("внутри досягаемости: подсказки нет", leaveHints(t0).length === 0);

    // 4. кнопка -> карточка предмета; реакция потрачена
    if (hint) {
      const html = (ui.chat.element ?? document).querySelector(`[data-message-id="${hint.id}"]`);
      const btn = html?.querySelector("[data-af-react-leave]");
      const t1 = Date.now();
      btn?.click(); await wait(2500);
      const card = game.messages.contents.find((m) => m._stats.createdTime >= t1 && m.flags?.pf2e?.origin?.uuid === item.uuid);
      row("кнопка «Использовать реакцию»: карточка No Escape создана", !!btn && !!card);
      row("подсказка помечена использованной", !!game.messages.get(hint.id)?.flags?.[MOD]?.strike?.used);
      await move(tFoe, 600, 500);
      t0 = Date.now();
      await move(tFoe, 900, 500);
      row("реакция потрачена: новой подсказки нет", leaveHints(t0).length === 0);
    }

    // 5. добыча
    await move(tFoe, 1300, 1200);
    t0 = Date.now();
    await move(tFoe, 1600, 1200);
    row("assassins-pursuit без добычи: подсказки нет", leaveHints(t0).length === 0);
    await hunter.createEmbeddedDocuments("Item", [{ type: "effect", name: "AF добыча", system: { slug: "effect-hunt-prey", rules: [{ key: "TokenMark", slug: "hunted-prey", uuid: tFoe.uuid }] } }]);
    await wait(300);
    await move(tFoe, 1300, 1200);
    t0 = Date.now();
    await move(tFoe, 1600, 1200);
    row("с добычей: подсказка есть", leaveHints(t0).length === 1, `подсказок: ${leaveHints(t0).length}`);
  } catch (e) { row("ошибка", false, String(e?.stack ?? e).slice(0, 300)); }
  finally {
    Hooks.off("createChatMessage", hook);
    if (created.msgs.size) await ChatMessage.deleteDocuments([...created.msgs].filter((id) => game.messages.has(id))).catch(() => {});
    await combat?.delete().catch(() => {});
    if (prevScene && prevScene.id !== scene?.id) await prevScene.view().catch(() => {});
    await wait(800);
    await scene?.delete().catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
  }
  console.table(rows);
  window.__afLRResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afLRResult;
}
