async () => {
  // Живой сценарий «минимум Сглаза действует, пока ведьма видит цель» (scripts/sight-gate.mjs). Вкладка активного ГМа.
  // Эффект-минимум кладётся applyEffect с теми же meta, что у шага gate:"sight"; потеря видимости — слепота ведьмы, стена, невидимость, ячейка PF2e Vision.
  // Копии «AF тест: …» и сцена «AF тест: Сцена» создаются здесь и убираются в finally; прежняя просматриваемая сцена возвращается.
  // Параметры: window.__afES = { only: [...], skip: [...] }. Результат — window.__afESResult (массив «PASS|FAIL id: детали»).
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const opts = { only: null, skip: [], ...(window.__afES ?? {}) };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const imp = (f) => import(`/modules/${MOD}/scripts/${f}`);
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const FLOOR = "Compendium.pf2e-automato.effects.Item.EvilEyeFloorEf01";
  const rows = [];
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const prevScene = canvas.scene;
  const created = new Set();   // свои сообщения (карточки «Видимость» на слепоту/невидимость) — убрать в finally
  const msgHook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.add(m.id); });
  let cur = "", scene = null, witch, goblin, wTok, gTok, apply;
  const ok = (cond, text, detail = "") => rows.push({ id: `${cur}: ${text}`, status: cond ? "PASS" : "FAIL", detail: cond ? "" : String(detail) });
  const mk = async (name) => { const src = (await fromUuid(GOBLIN)).toObject(); return Actor.create({ ...src, name: PFX + name, folder, ownership: { default: 0 }, prototypeToken: { ...src.prototypeToken, actorLink: true } }); };   // связанный токен: эффект и состояния на том же актёре, что на сцене
  const floorOf = (a) => a.itemTypes.effect.find((e) => e.flags?.[MOD]?.meta?.gate === "sight") ?? null;
  const grantedSick = (a) => a.itemTypes.condition.some((c) => c.slug === "sickened" && c.grantedBy);
  const dormant = () => Object.keys(witch.flags?.[MOD]?.sightDormant ?? {});
  const settle = () => wait(1800);
  const KEY = `afes:${Date.now()}`;
  const WALL = { c: [400, 0, 400, 1000], sight: 20, move: 20, light: 20, sound: 20 };

  /** Положить минимум-эффект на гоблина как шаг apply.mjs: meta с gate, sustainOf/sustainBy. */
  const putFloor = async () => {
    const meta = { key: `${KEY}:t`, source: "challenge", message: "afes", by: witch.uuid, sustainOf: `${KEY}:sustain`, sustainBy: witch.uuid, gate: "sight" };
    // как настоящий провал: шаг condition кладёт свою тошноту, шаг effect — минимум (выданную тошноту)
    if (!goblin.itemTypes.condition.some((c) => c.slug === "sickened" && !c.grantedBy)) await goblin.increaseCondition("sickened", { value: 1 });
    const r = await apply.applyEffect(goblin, { uuid: FLOOR }, meta, { originActor: witch, originToken: wTok });
    await wait(1200);
    return r;
  };
  const blind = async (on) => { if (on !== witch.hasCondition("blinded")) await witch.toggleCondition("blinded"); };

  const S = [];
  const sc = (id, fn) => S.push({ id, fn });

  sc("clear", async () => {
    await putFloor();
    ok(!!floorOf(goblin) && grantedSick(goblin), "ведьма видит цель: минимум на месте, выдано sickened");
    ok(dormant().length === 0, "ничего не приостановлено");
  });

  sc("blind", async () => {
    const id = floorOf(goblin)?.id;
    await blind(true); await settle();
    ok(!floorOf(goblin) && !grantedSick(goblin), "слепая ведьма: эффект снят вместе с состоянием");
    ok(dormant().length === 1 && dormant()[0] === id, `данные эффекта лежат на ведьме (${dormant()})`);
    await blind(false); await settle();
    const e = floorOf(goblin);
    ok(e && e.id === id && grantedSick(goblin), "прозрела: тот же эффект (тот же id) и sickened вернулись", `effect=${e?.id} want=${id}`);
    ok(dormant().length === 0, "запись приостановки убрана");
  });

  sc("wall", async () => {
    const [w] = await scene.createEmbeddedDocuments("Wall", [WALL]);
    await settle();
    ok(!floorOf(goblin), "стена зрения между токенами: эффект снят");
    await w.delete(); await settle();
    ok(!!floorOf(goblin) && grantedSick(goblin), "стены нет: эффект вернулся");
  });

  sc("moved", async () => {
    const [w] = await scene.createEmbeddedDocuments("Wall", [{ ...WALL, move: 0 }]);   // только зрение: стена движения остановила бы токен у стены (v14)
    await settle();
    ok(!floorOf(goblin), "стена: эффект снят");
    await gTok.update({ x: 100 }); await settle();   // цель перешла на сторону ведьмы
    ok(!!floorOf(goblin), "цель на стороне ведьмы: эффект вернулся (проверка идёт и по перемещению токена)");
    await w.delete(); await gTok.update({ x: 600 }); await settle();
  });

  sc("self-cleared", async () => {
    // вне видимости цель сняла тошноту сама: при возврате видимости минимум не возвращает снятое
    if (!floorOf(goblin)) await putFloor();
    if (!goblin.itemTypes.condition.some((c) => c.slug === "sickened" && !c.grantedBy)) await goblin.increaseCondition("sickened", { value: 1 });
    await blind(true); await settle();
    ok(!floorOf(goblin), "слепая ведьма: минимум снят");
    for (const c of goblin.itemTypes.condition.filter((c) => c.slug === "sickened")) await c.delete();
    await blind(false); await settle();
    ok(!floorOf(goblin) && !goblin.itemTypes.condition.some((c) => c.slug === "sickened"), "прозрела: минимум не вернулся, тошноты нет", goblin.itemTypes.condition.map((c) => c.slug));
    ok(dormant().length === 0, "запись приостановки стёрта", dormant());
    await putFloor();   // для следующих сценариев
  });

  sc("invisible", async () => {
    await goblin.toggleCondition("invisible"); await settle();
    ok(!floorOf(goblin), "цель невидима, see-invisibility нет: эффект снят");
    await goblin.toggleCondition("invisible"); await settle();
    ok(!!floorOf(goblin), "невидимость кончилась: эффект вернулся");
  });

  sc("vision-matrix", async () => {
    if (!game.modules.get("pf2e-vision")?.active) { ok(true, "PF2e Vision не активен: ячейки не проверяем (остальное — запасной путь)"); return; }
    await gTok.update({ "flags.pf2e-vision.visibility": { [wTok.id]: "hidden" } }); await settle();
    ok(!floorOf(goblin), "ячейка «hidden» для ведьмы: эффект снят");
    await gTok.update({ "flags.pf2e-vision.visibility": { [wTok.id]: "concealed" } }); await settle();
    ok(!!floorOf(goblin), "ячейка «concealed» (видит): эффект вернулся");
    await gTok.update({ "flags.pf2e-vision.-=visibility": null }).catch(() => {});
  });

  sc("sustain-end", async () => {
    // конец Поддержания (удаление якоря) стирает приостановленную запись: прозрев позже, эффект уже не вернётся
    const [anchor] = await witch.createEmbeddedDocuments("Item", [{ type: "effect", name: PFX + "якорь", img: "icons/svg/aura.svg", system: { duration: { value: -1, unit: "unlimited", sustained: false, expiry: null } }, flags: { [MOD]: { meta: { source: "sustain", key: `${KEY}:sustain` } } } }]);
    await blind(true); await settle();
    ok(dormant().length === 1, `приостановлено (${dormant().length})`);
    await anchor.delete(); await settle();
    ok(dormant().length === 0, "якорь удалён: запись стёрта");
    await blind(false); await settle();
    ok(!floorOf(goblin), "эффект не вернулся");
  });

  try {
    if (!game.user.isGM || !game.users.activeGM?.isSelf) throw new Error("нужна вкладка активного ГМа");
    apply = await imp("apply.mjs");
    witch = await mk("ведьма"); goblin = await mk("цель");
    scene = await Scene.create({ name: PFX + "Сцена", width: 1400, height: 1000, grid: { size: 100 }, tokenVision: false });
    const place = async (a, x, y) => { const [t] = await scene.createEmbeddedDocuments("Token", [(await a.getTokenDocument({ x, y })).toObject()]); return t; };
    wTok = await place(witch, 200, 400); gTok = await place(goblin, 600, 400);
    await scene.view(); await wait(1500);   // стены проверяются только на просматриваемой сцене
    for (const s of S) {
      if ((opts.only && !opts.only.includes(s.id)) || opts.skip.includes(s.id)) continue;
      cur = s.id;
      try { await s.fn(); } catch (e) { rows.push({ id: `${s.id}: ошибка`, status: "FAIL", detail: String(e?.stack ?? e).slice(0, 300) }); }
    }
  } catch (e) { rows.push({ id: "ошибка", status: "FAIL", detail: String(e?.stack ?? e).slice(0, 300) }); }
  finally {
    Hooks.off("createChatMessage", msgHook);
    const ids = [...created].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    try { if (prevScene && prevScene.id !== scene?.id) await prevScene.view(); } catch { /* ok */ }
    await wait(500);
    if (scene) await scene.delete().catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
  }
  console.table(rows);
  window.__afESResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afESResult;
}
