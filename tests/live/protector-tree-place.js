async () => {
  // Живой сценарий размещения дерева (summon.mjs createObject, nexus-tokens findAsset; plan-protector-tree.md, кусок А).
  // Копии «AF тест: …», своя сцена, всё удаляется. Результат — window.__afPPResult.
  //  1. карточка Древа-защитника несёт кнопку «Разместить»;  2. дальше 30 фт — отказ far;  3. размещение: имя = item.name, ПЗ 10 (ранг 1), флаг guard, без владельцев;
  //  4. картинка — ассет FA (Trees) и масштаб по суффиксу;  5. 0 ПЗ — токен скрыт, ПЗ > 0 — снова виден;  6. ранг 3 — 30 ПЗ;
  //  7. Древесный страж: второе дерево убирает первое того же автора.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const created = new Set();
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.add(m.id); });
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const prevScene = game.scenes.viewed;
  const TREE = "Compendium.pf2e.spells-srd.Item.K9gI08enGtmih5X1", SENTINEL = "Compendium.pf2e.feats-srd.Item.aHlcMMNQ85VLK7QT";
  const summon = await import(`/modules/${MOD}/scripts/summon.mjs`);
  let scene;
  const objActors = () => game.actors.filter((a) => String(a.flags?.[MOD]?.summonSource ?? "").startsWith("object:"));
  const hadObj = new Set(objActors().map((a) => a.id));   // общий актёр-объект мира: удаляем только созданный прогоном
  const pc = async (name, level = 1) => {
    const a = await Actor.create({ name: PFX + name, type: "character", folder, ownership: { default: 0 }, system: { details: { alliance: "party", level: { value: level } } } });
    const anc = (await game.packs.get("pf2e.ancestries").getIndex({ fields: ["system.slug"] })).find((i) => i.system?.slug === "human");
    if (anc) await a.createEmbeddedDocuments("Item", [(await game.packs.get("pf2e.ancestries").getDocument(anc._id)).toObject()]);
    await a.update({ "system.attributes.hp.value": a.hitPoints.max });
    return a;
  };
  const tok = async (a, x, y) => (await scene.createEmbeddedDocuments("Token", [{ ...(await a.getTokenDocument({ x, y })).toObject() }]))[0];
  const trees = () => scene.tokens.filter((t) => t.flags?.[MOD]?.summoned?.kind === "object");
  try {
    scene = await Scene.create({ name: PFX + "сцена", width: 3000, height: 2000, grid: { size: 100, distance: 5 }, padding: 0 });
    await scene.view(); await wait(1500);
    const kepi = await pc("Кепи", 5);
    const [entry] = await kepi.createEmbeddedDocuments("Item", [{ type: "spellcastingEntry", name: "AF колдовство", system: { tradition: { value: "primal" }, prepared: { value: "spontaneous" }, ability: { value: "wis" } } }]);
    const [spell] = await kepi.createEmbeddedDocuments("Item", [{ ...(await fromUuid(TREE)).toObject(), system: { ...(await fromUuid(TREE)).toObject().system, location: { value: entry.id } } }]);
    await tok(kepi, 500, 500);
    const cast = async (rank) => {
      const t0 = Date.now();
      await (rank ? spell.loadVariant({ castRank: rank }) : spell).toMessage(null, { create: true, data: rank ? { castRank: rank } : {} });
      await wait(1500);
      return game.messages.contents.filter((m) => m._stats.createdTime >= t0 && m.item?.slug === "protector-tree").at(-1);
    };

    // 1. карточка
    const msg = await cast();
    const html = msg && (ui.chat.element ?? document).querySelector(`[data-message-id="${msg.id}"] [data-af-summon]`);
    row("карточка: кнопка «Разместить»", !!html, html?.textContent?.trim() ?? "нет карточки/кнопки");

    // 2. дальность
    const far = msg && await summon.handlers.create(msg.id, null, 0, { sceneId: scene.id, x: 1500, y: 500 });
    row("дальше 30 фт — отказ far", far?.reason === "far", JSON.stringify(far));

    // 3–4. размещение
    const born = [];
    const bornHook = Hooks.on("createToken", (t) => { if (t.flags?.[MOD]?.summoned?.kind === "object") born.push(t.texture.src); });
    const res = msg && await summon.handlers.create(msg.id, null, 0, { sceneId: scene.id, x: 700, y: 500 });
    await wait(2500);
    row("токен создан сразу с картинкой Nexus (без иконки)", born.length === 1 && /Trees\//.test(born[0]), JSON.stringify(born));
    const tree = res?.token ? fromUuidSync(res.token) : null;
    row("размещено", !!tree, JSON.stringify(res));
    if (tree) {
      const f = tree.flags[MOD].summoned;
      row("имя = item.name, ПЗ 10", tree.name === spell.name && tree.actor.system.attributes.hp.max === 10 && tree.actor.system.attributes.hp.value === 10, `${tree.name} ${tree.actor.system.attributes.hp.value}/${tree.actor.system.attributes.hp.max}`);
      row("флаг guard: союзники, 5 фт, alliance party", f.guard?.on === "strike" && f.guard?.adjacent === 5 && f.guard?.alliance === "party" && f.by === kepi.uuid, JSON.stringify(f.guard));
      row("актёр hazard, игрокам не принадлежит", tree.actor.type === "hazard" && !game.users.some((u) => !u.isGM && tree.actor.testUserPermission(u, "OWNER")));
      const src = tree.texture.src, m = /_(\d+)x\d+\./.exec(src);
      row("картинка — дерево FA, масштаб по суффиксу", /Trees\//.test(src) && Math.abs(tree.texture.scaleX - (m && Number(m[1]) >= 6 ? 2 : 1)) < 0.01, `${src} scale=${tree.texture.scaleX}`);
      // 5. 0 ПЗ — скрыт, затем виден
      await tree.actor.update({ "system.attributes.hp.value": 0 }); await wait(1200);
      row("0 ПЗ: токен скрыт, не удалён", !!scene.tokens.get(tree.id) && scene.tokens.get(tree.id).hidden === true);
      await tree.actor.update({ "system.attributes.hp.value": 5 }); await wait(1200);
      row("ПЗ > 0: токен снова виден", scene.tokens.get(tree.id)?.hidden === false);
    }

    // 6. ранг 3
    const msg3 = await cast(3);
    const tc = Date.now();
    const res3 = msg3 && await summon.handlers.create(msg3.id, null, 0, { sceneId: scene.id, x: 500, y: 700 });
    row("размещение после сотворения — без ожидания каталога (< 1,5 с)", Date.now() - tc < 1500, `${Date.now() - tc} мс`);
    await wait(2000);
    const t3 = res3?.token ? fromUuidSync(res3.token) : null;
    Hooks.off("createToken", bornHook);
    row("ранг 3: 30 ПЗ", t3?.actor?.system?.attributes?.hp?.max === 30, `${JSON.stringify(res3)} hp=${t3?.actor?.system?.attributes?.hp?.max}`);

    // 7. Древесный страж: одно дерево на автора
    const [feat] = await kepi.createEmbeddedDocuments("Item", [(await fromUuid(SENTINEL)).toObject()]);
    const castFeat = async () => { const t0 = Date.now(); await feat.toMessage(null, { create: true }); await wait(1500); return game.messages.contents.filter((m) => m._stats.createdTime >= t0 && m.item?.slug === "timber-sentinel").at(-1); };
    const before = trees().length;
    const s1 = await castFeat(); const r1 = s1 && await summon.handlers.create(s1.id, null, 0, { sceneId: scene.id, x: 400, y: 500 }); await wait(2000);
    const s2 = await castFeat(); const r2 = s2 && await summon.handlers.create(s2.id, null, 0, { sceneId: scene.id, x: 400, y: 400 }); await wait(2500);
    const sentinels = trees().filter((t) => t.flags[MOD].summoned.src === SENTINEL);
    row("Древесный страж: ПЗ 10×ceil(5/2)=30", !!r1?.token && r2?.token && fromUuidSync(r2.token)?.actor?.system?.attributes?.hp?.max === 30, `hp=${r2?.token && fromUuidSync(r2.token)?.actor?.system?.attributes?.hp?.max}`);
    row("Древесный страж: второе дерево убрало первое", sentinels.length === 1 && sentinels[0].uuid === r2?.token && trees().length === before + 1, `стражей ${sentinels.length}, всего ${trees().length} (было ${before})`);

    // 8. цели области: дерево не цель (Сон по кругу с деревом и врагом)
    const SLEEP = "Compendium.pf2e.spells-srd.Item.o4lRVTwSxnOOn5vl";
    const foe = await Actor.create({ name: PFX + "враг", type: "character", folder, ownership: { default: 0 }, system: { details: { alliance: "opposition" } } });
    const tFoe = await tok(foe, 800, 500);
    const [sleep] = await kepi.createEmbeddedDocuments("Item", [{ ...(await fromUuid(SLEEP)).toObject(), system: { ...(await fromUuid(SLEEP)).toObject().system, location: { value: entry.id } } }]);
    const t8 = Date.now();
    await sleep.toMessage(null, { create: true }); await wait(1500);
    const sm = game.messages.contents.filter((m) => m._stats.createdTime >= t8 && m.item?.slug === "sleep").at(-1);
    const area0 = tree && sm ? scene.tokens.get(tree.id) : null;
    if (sm) await scene.createEmbeddedDocuments("Region", [{ name: `${PFX}область`, color: "#0000aa", shapes: [{ type: "circle", hole: false, x: 800, y: 550, radius: 160 }], behaviors: [], flags: { pf2e: { messageId: sm.id, areaShape: "burst" } } }]);
    let keys = [];
    for (let i = 0; i < 40 && !keys.length; i++) { await wait(250); keys = game.messages.get(sm?.id)?.flags?.[MOD]?.use?.state?.area?.keys ?? []; }
    row("область: враг — цель, дерево — нет", keys.includes(tFoe.id) && !!area0 && !keys.includes(area0.id), `keys=${JSON.stringify(keys)} tree=${area0?.id}`);
  } catch (e) { row("исключение", false, String(e?.stack ?? e).slice(0, 400)); }
  finally {
    Hooks.off("createChatMessage", hook);
    const ids = [...created].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    if (prevScene && prevScene.id !== scene?.id) await prevScene.view().catch(() => {});
    await wait(800);
    await scene?.delete().catch(() => {});
    for (const a of [...game.actors.filter((a) => a.name.startsWith(PFX)), ...objActors().filter((a) => !hadObj.has(a.id))]) await a.delete().catch(() => {});
  }
  console.table(rows);
  window.__afPPResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afPPResult;
}
