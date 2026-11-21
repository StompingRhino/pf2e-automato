async () => {
  // Живые сценарии К1 (plan-rustyspirit-gaps.md): flourish, ярость (rage-trait, rage-concentrate, rage-impulse), частота из текста (freq-text), «в вашем пространстве» (in-space), две руки (two-hands), свиток (scroll-list).
  // Копии «AF тест: …» (герои — копии актёров мира по имени), сцена создаётся и удаляется сценарием. Параметры: window.__afLK = { only, skip, cleanOnly }. Результат — window.__afLKResult.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const opts = { only: null, skip: [], ...(window.__afLK ?? {}) };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000, step = 150) => {
    const end = Date.now() + ms, env = cur;   // своё окружение: после таймаута на cur уже следующий сценарий
    if (env) env.step = `ждём: ${String(fn).replace(/\s+/g, " ").slice(0, 100)}`;
    while (Date.now() < end) { if (!env || env.dead) return null; try { const v = await fn(); if (v) return v; } catch { /* ещё не готово */ } await wait(step); }
    return null;
  };
  class Skip extends Error {}
  /** await без таймаута может висеть вечно (бросок pf2e с окном): ограничиваем и называем шаг. */
  const bound = (label, p, ms = 30000) => {
    const env = cur; if (env) env.step = label;
    let tm;
    return Promise.race([p, new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(`завис шаг «${label}» (>${ms / 1000} с)`)), ms); })]).finally(() => clearTimeout(tm));
  };
  /** Что видно при зависании: последний шаг, окна, которые закрывал харнесс, и открытые сейчас. */
  const hangInfo = (e) => `последний шаг: ${e.step}; закрыто окон бросков: [${e.windows}]; окна модуля: [${e.dialogs}]; открыто: [${[...foundry.applications.instances.values(), ...Object.values(ui.windows ?? {})].map((a) => a.constructor.name).join(", ")}]`;
  let cur = null;
  const DEG = ["criticalFailure", "failure", "success", "criticalSuccess"];
  const deg = (v) => (typeof v === "number" ? DEG[v] : v);
  // pf2e: shift ИНВЕРТИРУЕТ настройку show*Dialogs (eventToRollParams). Прогон ставит их в false (окон нет), поэтому shift окно как раз ПОКАЗЫВАЕТ и бросок
  // ждёт его вечно. Shift — только если окна включены; на всякий случай окна модификаторов ниже закрываются кнопкой броска.
  const SHIFT = () => new MouseEvent("click", { shiftKey: !!game.user.flags.pf2e?.settings?.showCheckDialogs });
  const api = () => game.modules.get(MOD).api;
  const imp = (f) => import(`/modules/${MOD}/scripts/${f}`);
  const setting = (k) => game.settings.get(MOD, k);

  // ---------- уборка (аварийная: window.__afLK = {cleanOnly: true}) ----------
  // Бой удаляем с проверкой: молчаливый catch оставлял бой без сцены (сцену удаляли следом). Не удалился — повтор, потом предупреждение в консоль.
  const killCombat = async (c) => {
    for (let i = 0; i < 3 && game.combats.has(c.id); i++) { await game.combats.get(c.id).delete().catch((err) => console.warn("combat delete", c.id, err)); if (game.combats.has(c.id)) await wait(800); }
    if (game.combats.has(c.id)) console.warn("rustyspirit: бой не удалился", c.id);
  };
  const sweep = async (extraMsgIds = []) => {
    const test = (n) => typeof n === "string" && n.startsWith(PFX);
    const mine = (n) => test(n) || (typeof n === "string" && n.startsWith("Тест: "));   // копии героев: «AF тест: » и «Тест: »
    // бои сцены (до её удаления), а также бои без сцены, чьи участники — наши копии
    for (const c of game.combats.filter((c) => test(c.scene?.name) || (!c.scene && c.combatants.some((x) => mine(x.actor?.name) || mine(x.name))) || c.combatants.some((x) => test(x.actor?.name) || test(x.name) || test(game.scenes.get(x.sceneId)?.name)))) await killCombat(c);
    const scenes = game.scenes.filter((s) => test(s.name));
    const actorIds = new Set(game.actors.filter((a) => test(a.name)).map((a) => a.id));
    const sceneIds = new Set(scenes.map((s) => s.id));
    const msgIds = new Set([...extraMsgIds, ...game.messages.filter((m) => actorIds.has(m.speaker?.actor) || sceneIds.has(m.speaker?.scene)).map((m) => m.id)]);
    const ids = [...msgIds].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    for (const s of scenes) await s.delete().catch(() => {});
    for (const a of game.actors.filter((a) => test(a.name))) await a.delete().catch(() => {});
    return game.actors.filter((a) => test(a.name)).length + game.scenes.filter((s) => test(s.name)).length;
  };
  if (opts.cleanOnly) return { left: await sweep() };

  // ---------- общее окружение прогона ----------
  const prevScene = game.scenes.viewed, prevCombat = game.combats.viewed;
  const pfSet = game.user.flags.pf2e?.settings ?? {};
  const origFlags = { showCheckDialogs: pfSet.showCheckDialogs, showDamageDialogs: pfSet.showDamageDialogs };
  const tbPrev = game.settings.get(MOD, "useToolbeltTargetHelper");
  const notes = [];
  const N = ui.notifications, nOrig = { warn: N.warn, error: N.error };
  const ceOrig = console.error;   // стек ошибок модуля (в уведомление попадает только сообщение)
  console.error = function (...a) { const er = a.find((x) => x instanceof Error); if (er) notes.push(`console.error: ${String(a[0]).slice(0, 80)} ${String(er.stack ?? er.message).replace(/\s+/g, " ").slice(0, 700)}`); return ceOrig.apply(this, a); };
  const onErr = (ev) => { const er = ev.error ?? ev.reason; notes.push(`uncaught: ${String(er?.stack ?? er?.message ?? ev.message).replace(/\s+/g, " ").slice(0, 700)}`); };
  window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onErr);
  for (const k of Object.keys(nOrig)) N[k] = function (m, ...r) { notes.push(`${k}: ${String(m).slice(0, 120)}`); return nOrig[k].call(this, m, ...r); };
  const setFlags = (v) => game.user.update(Object.fromEntries(Object.entries(v).map(([k, x]) => x === undefined ? [`flags.pf2e.settings.-=${k}`, null] : [`flags.pf2e.settings.${k}`, x])));
  const viewCombat = async (c) => { try { await ui.combat.initialize({ combat: c ?? null }); } catch (e) { console.warn("viewCombat", e); } };

  // ---------- компендиумы (slug — по 8.6.1, tools/out/items.json) ----------
  const idx = {};
  const find = async (pack, slug) => {
    const p = game.packs.get(pack);
    if (!p) throw new Error(`нет пака ${pack}`);
    idx[pack] ??= await p.getIndex({ fields: ["system.slug"] });
    const e = idx[pack].find((i) => i.system?.slug === slug);
    if (!e) throw new Error(`нет в ${pack}: ${slug}`);
    return (await p.getDocument(e._id)).toObject();
  };
  const equip = (s) => find("pf2e.equipment-srd", s);
  const held = (d, hands = 1) => { d.system.equipped = { carryType: "held", handsHeld: hands }; return d; };
  /** Источник предмета по uuid (в т.ч. вложенного в актёра компендиума); нет — skip. */
  const src = async (uuid) => {
    const d = await fromUuid(uuid).catch(() => null);
    if (!d) throw new Skip(`нет в паках: ${uuid}`);
    const o = d.toObject(); delete o._id;
    return o;
  };
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";

  // ---------- окружение одного сценария ----------
  const newEnv = async (id) => {
    const e = { dead: false, id, tracked: new Set(), dialogs: [], windows: [], step: "старт", stop: false, d20: null };
    const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) e.tracked.add(m.id); });
    e.scene = await Scene.create({ name: `${PFX}сцена ${id}`, width: 2400, height: 2000, padding: 0, grid: { size: 100, distance: 5 }, navigation: false, tokenVision: false });
    await e.scene.view(); await wait(700);
    // окна: наши .paf-dialog закрываются (отмена); ChoiceSet pf2e — первый вариант. Список e.dialogs — «окно появилось».
    const seen = new Set();
    (async () => {
      while (!e.stop) {
        for (const el of document.querySelectorAll(".paf-dialog")) {
          if (seen.has(el.id)) continue;
          seen.add(el.id);
          const sel = el.querySelector("select[name=choice]"), opts = sel ? [...sel.options].map((o) => `${o.value}=${o.textContent.trim()}`) : [];
          e.dialogs.push(`${el.querySelector(".window-title")?.textContent?.trim() ?? el.id}: ${opts.join(" / ")}`);
          const want = e.answers?.length ? e.answers.shift() : null, o = sel && want != null ? [...sel.options].find((x) => x.value === want || x.textContent.toLowerCase().includes(String(want).toLowerCase())) : null;
          if (o) { sel.value = o.value; el.querySelector("button[data-action=ok]")?.click(); } else foundry.applications.instances.get(el.id)?.close();
        }
        for (const app of foundry.applications.instances.values()) {
          if (seen.has(app.id) || !app.element || !/Prompt|Picker/i.test(app.constructor.name)) continue;
          seen.add(app.id);
          if (Array.isArray(app.choices) && app.choices.length) { app.selection = app.choices[0]; app.close(); }
        }
        for (const app of [...Object.values(globalThis.ui?.windows ?? {}), ...foundry.applications.instances.values()]) {   // окна бросков pf2e (проверка / урон): жмём «Бросок»
          const id = app.appId ?? app.id;
          if (seen.has(id) || !/damage|modifiers|урон|check/i.test(`${app.constructor.name} ${app.title}`)) continue;
          seen.add(id);
          e.windows.push(`${app.constructor.name} «${app.title}»`);
          const root = app.element?.[0] ?? app.element, bs = root?.querySelectorAll?.("button");
          (root?.querySelector?.("button.roll") ?? bs?.[bs.length - 1])?.click();
        }
        await wait(150);
      }
    })();

    const live = () => { if (e.dead) throw new Error("сценарий остановлен"); };
    e.add = (data) => live() ?? Actor.create({ folder: null, ownership: { default: 0 }, ...data, name: PFX + data.name });
    e.foe = async (name) => {
      const a = await e.add({ ...(await fromUuid(GOBLIN)).toObject(), name });
      await a.update({ "system.attributes.hp.value": a.hitPoints.max });
      return a;
    };
    e.pc = async (name, items = []) => {
      const a = await e.add({ name, type: "character", system: { details: { alliance: "party", languages: { value: ["common"] } } } });
      await a.createEmbeddedDocuments("Item", [await find("pf2e.ancestries", "human"), ...items]);
      await a.update({ "system.attributes.hp.value": a.hitPoints.max });
      return a;
    };
    e.give = (a, ...docs) => live() ?? a.createEmbeddedDocuments("Item", docs);
    e.tok = async (a, x, y, disposition) => {
      live();
      const [t] = await e.scene.createEmbeddedDocuments("Token", [{ ...(await a.getTokenDocument({ x, y })).toObject(), disposition }]);
      return t;
    };
    e.T = (t) => e.scene.tokens.get(t.id);
    e.A = (t) => e.scene.tokens.get(t.id)?.actor;   // у NPC токен «развязан»: все проверки и выдача предметов — на этом актёре, не на исходном
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
      if (n != null && (await new Roll("1d20").evaluate()).total !== n) throw new Skip("не удалось зафиксировать d20 (CONFIG.Dice.randomUniform)");
    };
    e.since = () => Date.now();
    e.msgs = (t0) => game.messages.contents.filter((m) => m._stats.createdTime >= t0);
    e.dom = (m) => document.querySelector(`#chat [data-message-id="${m?.id}"]`);
    e.applyAll = async (m) => { for (const b of [...(e.dom(m)?.querySelector(".pf2e-automato")?.querySelectorAll("button[data-action^=apply]:not([disabled])") ?? [])]) { live(); b.click(); await wait(1200); } };
    e.cond = (a, slug) => a.itemTypes.condition.find((c) => c.slug === slug) ?? null;
    e.use = (m) => game.messages.get(m?.id)?.flags?.[MOD]?.use;
    e.results = (m) => Object.fromEntries(Object.entries(e.use(m)?.state?.challenge?.results ?? {}).map(([k, v]) => [k, deg(v.degree)]));
    e.strike = (a) => a.system.actions.find((s) => s.item?.isMelee);
    e.hit = async (att, def) => {   // первый ближний Удар att по токену def (shift-клик без окна); сообщение атаки
      await e.aim(att, def);
      const t0 = e.since(), s = e.strike(e.A(att));
      if (!s) throw new Error("у атакующего нет ближнего Удара");
      await bound("бросок Удара (variants[0].roll)", s.variants[0].roll({ event: SHIFT() }));
      return waitFor(() => e.msgs(t0).find((m) => m.flags?.pf2e?.context?.type === "attack-roll"), 8000);
    };
    /** Мировой предмет-действие с правилом в флаге: rule валидируется заранее (ошибка — в detail). */
    e.ruleItem = async (actor, rule) => {
      const v = api().validateRule(rule);
      if (!v.ok) throw new Error(`правило невалидно: ${v.errors.map(String).join("; ")}`);
      const [it] = await e.give(actor, { type: "action", name: "AF правило", system: { slug: `af-test-${id}`, actionType: { value: "action" }, actions: { value: 1 }, description: { value: "<p>тест</p>" } }, flags: { [MOD]: { rule } } });
      return it;
    };
    /** Использовать предмет «в чат» с целями; -> сообщение со снимком use (после done). Уступка pf2e-automations — skip. */
    e.fire = async (item, att, ...targets) => {
      await e.aim(att, ...targets);
      const t0 = e.since();
      await bound("item.toMessage", item.toMessage(undefined, { create: true }));
      const m = await waitFor(() => e.msgs(t0).find((x) => x.flags?.pf2e?.origin?.uuid === item.uuid && x.flags?.[MOD]?.use), 10000);
      if (!m) throw new Error(`у карточки «${item.name}» нет снимка use (правило не найдено или модуль не слушает)`);
      if (e.use(m).state?.yielded) throw new Skip(`правило уступает pf2e-automations (${e.use(m).state.yielded})`);
      await waitFor(() => e.use(m)?.state?.done, 10000);
      return game.messages.get(m.id);
    };
    e.combat = async (toks, inits) => {
      live();
      const c = await Combat.create({ scene: e.scene.id, active: true });
      await c.createEmbeddedDocuments("Combatant", toks.map((t, i) => ({ tokenId: t.id, sceneId: e.scene.id, actorId: t.actor.id, initiative: inits[i] })));
      await viewCombat(c);
      return c;
    };
    e.dispose = async () => {
      e.dead = true; e.stop = true;
      await wait(2500);   // модуль ещё дописывает флаги/эффекты карточек: сцену удаляем после, иначе «Scene … does not exist»
      for (const c of game.combats.filter((c) => c.scene?.id === e.scene.id || c.combatants.some((x) => x.sceneId === e.scene.id))) await killCombat(c);   // бой — до ухода со сцены и до её удаления
      if (prevScene && prevScene.id !== e.scene.id && game.scenes.has(prevScene.id)) { await prevScene.view().catch(() => {}); await wait(1000); }   // холст не должен рисовать удаляемую сцену
      Hooks.off("createChatMessage", hook);
      try { await e.fix(null); } catch { /* ok */ }
      game.user.targets.forEach((t) => t.setTarget(false, { releaseOthers: false }));
      document.querySelectorAll(".paf-dialog").forEach((el) => foundry.applications.instances.get(el.id)?.close());
      const left = await sweep([...e.tracked]);
      await viewCombat(prevCombat);
      return left;
    };
    return e;
  };

  // Копии противников «AF тест: …» с их способностями; жертвы — гоблины на стороне партии (NPC бросают сами). Сетка 100 px / 5 фт.
  const S = [];
  const sc = (id, title, run) => S.push({ id, title, run });
  const EN = { spirit: "kLU5GWkHlFZhChxY", fox: "1E85fDMsHCCrOw0m", guard: "k4YZBN0sa876sJQk", sprout: "qbaMCMwu7xwk1Gi8" };
  const DEGREE_MOD = { criticalSuccess: 0, success: -10, failure: -11, criticalFailure: -20 };
  const copyFoe = async (e, id, name) => {
    const h = game.actors.get(id);
    if (!h) throw new Skip(`нет противника ${id}`);
    const d = h.toObject(); delete d._id; delete d.folder;
    return e.add({ ...d, name: name ?? h.name });
  };
  const victim = async (e, name, traits) => {
    const a = await e.foe(name);
    await a.update({ "system.details.alliance": "party", ...(traits && { "system.traits.value": [...a.system.traits.value, ...traits] }) });
    return a;
  };
  const rigSave = async (e, G, stat, dc, deg) => {
    for (const i of G.itemTypes.effect.filter((i) => i.slug === "af-rig")) await i.delete();
    await e.rig(G, stat, dc + DEGREE_MOD[deg] - G.saves[stat].mod);
  };
  const bySlug = (a, slug) => a.items.find((i) => i.system.slug === slug) ?? null;
  const cnd = (a, slug) => a.itemTypes.condition.find((c) => c.slug === slug)?.value ?? (a.itemTypes.condition.some((c) => c.slug === slug) ? true : 0);
  const openChat = () => { try { ui.sidebar?.expand?.(); ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* ok */ } };
  /** Использование действия путём pf2e (createUseActionMessage: списание частоты) -> карточка или null. */
  const useAction = async (e, item, ms = 8000) => {
    const t0 = e.since();
    await bound("rollItemMacro", game.pf2e.rollItemMacro(item.uuid));
    return waitFor(() => e.msgs(t0).find((m) => m.flags?.pf2e?.origin?.uuid === item.uuid), ms);
  };
  const area = async (e, m, x, y, r, shape) => {
    await waitFor(() => e.use(m)?.state?.awaitingRegion || e.use(m)?.state?.done, 8000);
    const made = await e.scene.createEmbeddedDocuments("Region", [{ name: `${PFX}область`, color: "#00aa55", shapes: [{ type: "circle", hole: false, x, y, radius: r }], behaviors: [], flags: { pf2e: { messageId: m.id, areaShape: shape, origin: { uuid: m.item?.uuid, type: m.item?.type, actor: m.actor?.uuid, token: m.token?.uuid } } } }]);   // origin — как у шаблона pf2e: по нему проверка дальности области
    if (made.length) await waitFor(() => (e.use(m)?.state?.area?.keys?.length ?? 0) >= 1, 10000);
    return made[0] ?? null;
  };
  const dmgOf = async (e, tAtt) => {
    const t0 = e.since(), s = e.strike(e.A(tAtt));
    await bound("урон Удара", s.damage({ event: SHIFT() }));
    return waitFor(() => e.msgs(t0).find((m) => m.flags?.pf2e?.context?.type === "damage-roll"), 8000);
  };
  const withAlt = async (f) => { const k = game.keyboard.downKeys; k.add("AltLeft"); try { return await f(); } finally { k.delete("AltLeft"); } };


  // ---------- сценарии K1 (plan-rustyspirit-gaps.md): flourish, ярость, частота из текста, в пространстве, две руки, свиток ----------
  const HERO = (name) => game.actors.find((a) => (a.name === name || a.name.startsWith(`${name} `)) && !a.name.startsWith(PFX) && a.type === "character");   // «Леонард» -> «Леонард Шеллиас»
  const heroCopy = async (e, name) => {
    const h = HERO(name);
    if (!h) throw new Skip(`нет героя «${name}»`);
    const d = h.toObject(); delete d._id; delete d.folder;
    const a = await e.add({ ...d, name });
    await a.update({ "system.attributes.hp.value": a.hitPoints.max });
    return a;
  };
  /** Предмет из пака с источником (compendiumSource: без него оверлей use-limits предмет не узнает). */
  const fromPack = async (uuid) => {
    const o = await src(uuid);
    o._stats = { ...o._stats, compendiumSource: uuid };
    return o;
  };
  const RAGE_EFFECT = "Compendium.pf2e.feat-effects.Item.z3uyCMBddrPK5umr";
  const W = {   // тексты предупреждений (ru/en): builtin.limit.*
    flourish: /уже было действие с признаком|already used an action with/i,
    rage: /в ярости нельзя|while raging you can't/i,
    rageTrait: /только в ярости|can only be used while raging/i,
    freqText: /использований не осталось — по тексту|no uses left — by its text/i,
    inSpace: /в вашем пространстве|in your space/i,
    twoHands: /две свободные руки|two free hands/i
  };
  const warned = (n0, re) => notes.slice(n0).some((x) => re.test(x));
  const act = (name, slug, traits = [], extra = {}) => ({ type: "action", name, system: { slug, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: traits }, description: { value: "<p>тест</p>" }, ...extra } });
  const startCombat = async (e, toks, inits = [20, 10]) => { const c = await e.combat(toks, inits); await c.startCombat(); await wait(600); return c; };
  /** Карточка через путь pf2e (как с листа) -> сообщение или null (блок). */
  const tryUse = (e, item, ms = 2500) => useAction(e, item, ms);
  const flagOf = (a, k) => a.flags?.[MOD]?.[k];

  sc("flourish", "Flourish: второе действие с чертой в раунде — блок; Alt пускает; следующий раунд; удаление карточки возвращает метку", async (e, t) => {
    openChat();
    const P0 = await e.pc("флёриш"), F0 = await victim(e, "враг");
    await e.give(P0, act("AF флёриш 1", "af-fl-1", ["flourish"]), act("AF флёриш 2", "af-fl-2", ["flourish"]));
    const tP = await e.tok(P0, 500, 500, 1), tF = await e.tok(F0, 600, 500, -1);
    await wait(700);
    const P = e.A(tP), c = await startCombat(e, [tP, tF]);
    const it = (s) => P.items.find((i) => i.system.slug === s);
    const m1 = await useAction(e, it("af-fl-1"));
    t.ok(!!m1, "первое: карточка");
    await waitFor(() => flagOf(P, "flourishRound"), 6000);
    t.ok(flagOf(P, "flourishRound") === `${c.id}:${c.round}`, `метка раунда: ${flagOf(P, "flourishRound")}`);
    const n0 = notes.length;
    t.ok(!(await tryUse(e, it("af-fl-2"))), "второе (другое действие с чертой) в том же раунде: блок");
    t.ok(warned(n0, W.flourish), `предупреждение «flourish» (${notes.slice(n0).join(" | ").slice(0, 160)})`);
    t.ok(!!(await withAlt(() => useAction(e, it("af-fl-2")))), "Alt: пускает");
    await c.nextRound(); await wait(600);
    const m4 = await useAction(e, it("af-fl-1"));
    t.ok(!!m4, "следующий раунд: пускает");
    await game.messages.get(m4.id).delete();
    t.ok(!!(await waitFor(() => !flagOf(P, "flourishRound"), 6000)), "удаление карточки сняло метку");
    t.ok(!!(await useAction(e, it("af-fl-2"))), "после отката в том же раунде пускает");
  });

  sc("rage-trait", "Черта rage — только в ярости: без ярости блок, Alt, в ярости пускает; NPC не трогаем", async (e, t) => {
    openChat();
    const P0 = await e.pc("ярость"), N0 = await e.foe("npc");
    await e.give(P0, act("AF яростное", "af-rage-only", ["rage"])); await e.give(N0, act("AF яростное", "af-rage-only", ["rage"]));
    const tP = await e.tok(P0, 500, 500, 1), tN = await e.tok(N0, 700, 500, -1);
    await wait(700);
    const P = e.A(tP), N = e.A(tN), it = P.items.find((i) => i.system.slug === "af-rage-only");
    const n0 = notes.length;
    t.ok(!(await tryUse(e, it)), "без ярости: блок");
    t.ok(warned(n0, W.rageTrait), `предупреждение rageTrait (${notes.slice(n0).join(" | ").slice(0, 140)})`);
    t.ok(!!(await withAlt(() => useAction(e, it))), "Alt: пускает");
    await e.give(P, await src(RAGE_EFFECT));
    await wait(500);
    t.ok(!!(await useAction(e, it)), "в ярости: пускает");
    t.ok(!!(await useAction(e, N.items.find((i) => i.system.slug === "af-rage-only"))), "NPC без эффекта ярости: не блок (только персонажи)");
  });

  sc("rage-concentrate", "Ярость: concentrate без rage — блок; с rage / Moment of Clarity / Seek — пускает; Alt", async (e, t) => {
    openChat();
    const P0 = await e.pc("яростный");
    await e.give(P0, act("AF концентрация", "af-conc", ["concentrate"]), act("AF конц+ярость", "af-conc-rage", ["concentrate", "rage"]), act("AF Миг ясности", "moment-of-clarity", ["concentrate", "rage"]), act("AF Поиск", "seek", ["concentrate", "secret"]));
    const tP = await e.tok(P0, 500, 500, 1);
    await wait(700);
    const P = e.A(tP), it = (s) => P.items.find((i) => i.system.slug === s);
    await e.give(P, await src(RAGE_EFFECT));
    await wait(500);
    const n0 = notes.length;
    t.ok(!(await tryUse(e, it("af-conc"))), "concentrate в ярости: блок");
    t.ok(warned(n0, W.rage), `предупреждение rage (${notes.slice(n0).join(" | ").slice(0, 140)})`);
    t.ok(!!(await withAlt(() => useAction(e, it("af-conc")))), "Alt: пускает");
    t.ok(!!(await useAction(e, it("af-conc-rage"))), "concentrate + rage: пускает");
    t.ok(!!(await useAction(e, it("seek"))), "Seek: пускает");
    t.ok(!(await tryUse(e, it("af-conc"))), "до Мига ясности: блок");
    t.ok(!!(await useAction(e, it("moment-of-clarity"))), "Moment of Clarity: карточка");
    await waitFor(() => flagOf(P, "clarityUntil"), 6000);
    t.ok(!!(await useAction(e, it("af-conc"))), "после Мига ясности concentrate пускает (вне боя — срок 6 с по времени мира)");
  });

  sc("rage-impulse", "Ярость + импульсы Леонарда: стихия инстинкта проходит, чужая — блок, Alt пускает", async (e, t) => {
    openChat();
    const L0 = await heroCopy(e, "Леонард");
    const tL = await e.tok(L0, 500, 500, 1);
    await wait(700);
    const A = e.A(tL), EL = ["air", "earth", "fire", "metal", "water", "wood"];
    const opts = A.getRollOptions(["all"]).filter((o) => o.startsWith("elemental-instinct:"));
    // своей и чужой стихии у героя может не быть: недостающий импульс 1 уровня — из пака (с источником)
    const fidx = await game.packs.get("pf2e.feats-srd").getIndex({ fields: ["system.traits.value", "system.level.value"] });
    const has = (pred) => A.items.some((i) => i.system.traits?.value?.includes("impulse") && pred(i.system.traits.value));
    const mine = (tr) => tr.some((x) => opts.includes(`elemental-instinct:${x}`)), alien = (tr) => tr.some((x) => EL.includes(x)) && !mine(tr);
    for (const pred of [mine, alien]) {
      if (has(pred)) continue;
      const f = fidx.find((i) => i.system?.traits?.value?.includes("impulse") && i.system.level?.value === 1 && pred(i.system.traits.value));
      if (f) await e.give(A, await fromPack(`Compendium.pf2e.feats-srd.Item.${f._id}`));
    }
    await wait(300);
    const imps = A.items.filter((i) => i.system.traits?.value?.includes("impulse"));
    if (!imps.length) throw new Skip("у Леонарда нет импульсов");
    const own = imps.find((i) => i.system.traits.value.some((x) => opts.includes(`elemental-instinct:${x}`))), other = imps.find((i) => i.system.traits.value.some((x) => EL.includes(x)) && !i.system.traits.value.some((x) => opts.includes(`elemental-instinct:${x}`)));
    t.ok(opts.length > 0, `у Леонарда опция elemental-instinct:* (${opts.join(",") || "нет"}; иначе строка rage опирается на rulesSelections)`);
    if (!own || !other) throw new Skip(`нужны импульсы своей и чужой стихии (свой: ${own?.name}, чужой: ${other?.name})`);
    await e.give(A, await src(RAGE_EFFECT));
    await wait(500);
    // блок по ярости виден по тексту предупреждения (аура и руки проверяются раньше и могут дать другую причину — это не ярость)
    let n0 = notes.length;
    await tryUse(e, own);
    t.ok(!warned(n0, W.rage), `импульс своей стихии (${own.name}): предупреждения «в ярости» нет`);
    n0 = notes.length;
    t.ok(!(await tryUse(e, other)), `импульс чужой стихии (${other.name}): карточки нет`);
    t.ok(warned(n0, W.rage) || warned(n0, /аура|aura|рук|hand/i), `предупреждение (${notes.slice(n0).join(" | ").slice(0, 160)})`);
    t.ok(!!(await withAlt(() => useAction(e, other))), "Alt: пускает");
  });

  sc("freq-text", "Частота из текста: «Scrappy Defiance» (раз в день) — второй блок, Alt, отдых сбрасывает; NPC «раз в раунд» — блок в бою, в следующем раунде пускает", async (e, t) => {
    openChat();
    const P0 = await e.pc("частота");   // действие персонажа «раз в день» — первое из оверлея freq (actionspf2e)
    const ov0 = await (await fetch(foundry.utils.getRoute(`modules/${MOD}/rules/use-limits.json`))).json();
    const src1 = Object.entries(ov0.freq?.bySource ?? {}).find(([u, v]) => u.startsWith("Compendium.pf2e.actionspf2e.") && v.unit === "days" && v.value === 1)?.[0];
    if (!src1) throw new Skip("в оверлее freq нет действия actionspf2e «раз в день»");
    const [feat] = await e.give(P0, await fromPack(src1));
    const tP = await e.tok(P0, 500, 500, 1);
    await wait(700);
    const P = e.A(tP), it = P.items.get(feat.id);
    if (it.system.frequency) throw new Skip("у предмета есть system.frequency — pf2e считает сам");
    t.ok(!!(await useAction(e, it)), "первое использование: карточка");
    await waitFor(() => flagOf(P, `fq_${it.id}`), 6000);
    t.ok(flagOf(P, `fq_${it.id}`)?.log?.length === 1, `счётчик fq_<id>: ${JSON.stringify(flagOf(P, `fq_${it.id}`))}`);
    const n0 = notes.length;
    t.ok(!(await tryUse(e, it)), "второе в день: блок");
    t.ok(warned(n0, W.freqText), `предупреждение freqText (${notes.slice(n0).join(" | ").slice(0, 160)})`);
    const m3 = await withAlt(() => useAction(e, it));
    t.ok(!!m3, "Alt: пускает");
    await game.messages.get(m3.id).delete();
    await wait(800);
    t.ok(flagOf(P, `fq_${it.id}`)?.log?.length === 1, "удаление карточки вернуло прежний счётчик (одна запись)");
    Hooks.callAll("pf2e.restForTheNight", P);   // то, что зовёт pf2e при отдыхе
    t.ok(!!(await waitFor(() => !flagOf(P, `fq_${it.id}`), 6000)), "отдых сбросил счётчик");
    t.ok(!!(await useAction(e, it)), "после отдыха пускает");

    // NPC: «раз в раунд» — любой документ оверлея с единицей rounds, который открывается по uuid
    const ov = await (await fetch(foundry.utils.getRoute(`modules/${MOD}/rules/use-limits.json`))).json();
    let npcSrc = null;
    for (const [uuid, v] of Object.entries(ov.freq?.bySource ?? {})) {
      if (v.unit !== "rounds" || v.value !== 1 || (v.uses ?? 1) !== 1 || !/\.Actor\./.test(uuid)) continue;
      const d = await fromUuid(uuid).catch(() => null);
      if (d?.type === "action" && d.system.actionType?.value) { npcSrc = uuid; break; }
    }
    if (!npcSrc) { t.ok(false, "в оверлее нет «раз в раунд» с открываемым uuid"); return; }
    const N0 = await e.foe("npc-раунд"), F0 = await victim(e, "жертва");
    const [ni] = await e.give(N0, await fromPack(npcSrc));
    const tN = await e.tok(N0, 700, 700, -1), tF = await e.tok(F0, 800, 700, 1);
    await wait(700);
    const N = e.A(tN), nit = N.items.get(ni.id), c = await startCombat(e, [tN, tF]);
    t.ok(!!(await useAction(e, nit)), `NPC (${nit.name}): первое в бою — карточка`);
    const n1 = notes.length;
    t.ok(!(await tryUse(e, nit)), "второе в том же раунде: блок");
    t.ok(warned(n1, W.freqText), "предупреждение freqText у NPC");
    await c.nextRound(); await wait(600);
    t.ok(!!(await useAction(e, nit)), "следующий раунд: пускает");
  });

  sc("in-space", "Исцеляющий фамильяр: токен фамильяра вне клетки мастера — блок, на клетке — пускает, без токена мастера — пускает; второй раз в день — блок; отдых мастера сбрасывает", async (e, t) => {
    openChat();
    const idx = await game.packs.get("pf2e.familiar-abilities").getIndex({ fields: ["system.slug"] });
    const ab = idx.find((i) => i.system?.slug === "restorative-familiar");
    if (!ab) throw new Skip("нет restorative-familiar");
    const M0 = await e.pc("мастер");
    const F0 = await e.add({ name: "фамильяр", type: "familiar", system: { master: { id: M0.id } } });
    const [it0] = await e.give(F0, await fromPack(`Compendium.pf2e.familiar-abilities.Item.${ab._id}`));
    const tM = await e.tok(M0, 500, 500, 1), tF = await e.tok(F0, 700, 500, 1);
    await wait(700);
    const F = e.A(tF), it = F.items.get(it0.id);
    const n0 = notes.length;
    t.ok(!(await tryUse(e, it)), "фамильяр в 10 фт от мастера: карточки нет (блок или карточка не создаётся — см. предупреждение)");
    t.ok(warned(n0, W.inSpace), `предупреждение inSpace (${notes.slice(n0).join(" | ").slice(0, 160)})`);
    await e.T(tF).update({ x: 500, y: 500 }); await wait(500);
    const m = await useAction(e, it);
    t.ok(!!m, "на клетке мастера: карточка есть (иначе у пассивки способности фамильяра нет use-карточки — проверить отдельно)");
    await waitFor(() => flagOf(F, `fq_${it.id}`), 6000);
    const n1 = notes.length;
    t.ok(!(await tryUse(e, it)), "второй раз в день: блок");
    t.ok(warned(n1, W.freqText), "предупреждение freqText у фамильяра");
    Hooks.callAll("pf2e.restForTheNight", e.A(tM));
    t.ok(!!(await waitFor(() => !flagOf(F, `fq_${it.id}`), 6000)), "отдых мастера снял счётчик фамильяра");
    await e.scene.deleteEmbeddedDocuments("Token", [tM.id]); await wait(500);
    await e.T(tF).update({ x: 900, y: 500 }); await wait(500);
    t.ok(!!(await useAction(e, it)), "мастера нет на сцене: положение неизвестно — не блок");
  });

  sc("two-hands", "Рубящий шквал: две цели при занятой руке — блок; одна цель и Alt — пускает", async (e, t) => {
    openChat();
    const hero = ["Марена", "Искрик", "Леонард", "Еся", "Каштан"].map(HERO).find((a) => a?.items.some((i) => i.slug === "slashing-gust"));
    if (!hero) throw new Skip("нет героя с Slashing Gust");
    const H0 = await heroCopy(e, hero.name), F1 = await e.foe("цель 1"), F2 = await e.foe("цель 2");
    const tH = await e.tok(H0, 500, 500, 1), t1 = await e.tok(F1, 600, 500, -1), t2 = await e.tok(F2, 600, 600, -1);
    await wait(700);
    const A = e.A(tH), spell = A.items.find((i) => i.slug === "slashing-gust");
    const [gs] = await e.give(A, held(await equip("greatsword"), 2));   // двуручное оружие: свободных рук 0
    await wait(500);
    t.ok(A.system.hands?.free?.value === 0, `свободных рук: ${A.system.hands?.free?.value}`);
    const cast = () => spell.spellcasting.cast(spell, { rank: spell.rank, consume: false });
    await e.aim(tH, t1, t2);
    let n0 = notes.length;
    await cast(); await wait(600);
    t.ok(warned(n0, W.twoHands), `две цели при занятых руках: предупреждение (${notes.slice(n0).join(" | ").slice(0, 160)})`);
    await e.aim(tH, t1);
    n0 = notes.length;
    await cast(); await wait(600);
    t.ok(!warned(n0, W.twoHands), "одна цель: без предупреждения");
    await e.aim(tH, t1, t2);
    n0 = notes.length;
    await withAlt(async () => { await cast(); await wait(600); });
    t.ok(!warned(n0, W.twoHands), "Alt: пускает без предупреждения");
    await gs.delete();
  });

  sc("scroll-list", "Свиток: pf2e сам не даёт сотворить заклинание чужого типа колдовства (запись свитка не создаётся); своего типа — запись есть", async (e, t) => {
    openChat();
    const spells = {};
    for (const slug of ["force-barrage", "heal"]) {
      const idx = (spells.idx ??= await game.packs.get("pf2e.spells-srd").getIndex({ fields: ["system.slug"] }));
      const f = idx.find((i) => i.system?.slug === slug);
      if (!f) throw new Skip(`нет заклинания ${slug}`);
      spells[slug] = (await game.packs.get("pf2e.spells-srd").getDocument(f._id)).toObject();
    }
    const P0 = await heroCopy(e, "Марена");   // настоящая запись колдовства (occult): у голой заготовки нет statistic, pf2e свиток не строит
    const scroll = (name, sp) => ({ type: "consumable", name, system: { category: "scroll", quantity: 1, spell: sp, traits: { value: ["magical"] } } });
    const [own, foreign] = await P0.createEmbeddedDocuments("Item", [scroll("AF свиток своего типа", spells["force-barrage"]), scroll("AF свиток чужого типа", spells.heal)]);
    await wait(800);
    const A = game.actors.get(P0.id);
    if (!own.embeddedSpell) throw new Skip("consumable.embeddedSpell не построен (формат system.spell изменился)");
    t.ok(!!A.spellcasting.get(`${own.id}-casting`), "свиток своего типа (force-barrage: arcane/occult): запись свитка есть");
    t.ok(!A.spellcasting.get(`${foreign.id}-casting`), "свиток чужого типа (heal: divine/primal): записи нет — pf2e не даёт сотворить");
    // runic-weapon из каталога на заклинание со свитка здесь не проверяется: нужен выбор оружия-цели (отдельная проверка вручную)
  });

  // ---------- прогон ----------
  const rows = [];
  const pick = S.filter((s) => (!opts.only || opts.only.includes(s.id)) && !opts.skip.includes(s.id));
  const applyPrev = setting("mode.apply");
  const limitsPrev = setting("mode.limits");
  try {
    await setFlags({ showCheckDialogs: false, showDamageDialogs: false });
    await game.settings.set(MOD, "useToolbeltTargetHelper", false);   // NPC бросают сами
    if (limitsPrev !== "auto") await game.settings.set(MOD, "mode.limits", "auto");   // прогон проверяет включённый режим; «off» сценарии включают сами
    if (applyPrev !== "auto") await game.settings.set(MOD, "mode.apply", "auto");   // по умолчанию button: результаты не выдаются сами
    for (const s of pick) {
      const t = { fails: [], n: 0, ok(c, label) { this.n++; if (!c) this.fails.push(label); } };
      let e = null, status = "ok", detail = "";
      notes.length = 0;
      try {
        e = await newEnv(s.id); cur = e;
        const run = s.run(e, t); run.catch(() => {});
        let timer;
        try { await Promise.race([run, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`таймаут 170 с; ${hangInfo(e)}`)), 170000); })]); }
        finally { clearTimeout(timer); }
        if (t.fails.length) { status = "fail"; detail = t.fails.join("; "); } else detail = `${t.n} проверок`;
      } catch (err) {
        if (err instanceof Skip) { status = "skip"; detail = err.message; }
        else { status = "fail"; detail = `${t.fails.length ? t.fails.join("; ") + "; " : ""}ошибка: ${String(err?.message ?? err).slice(0, 400)}`; console.error(`${MOD} limits-rustyspirit | ${s.id}`, err); }
      } finally {
        const left = e ? await e.dispose().catch((x) => `dispose: ${x}`) : 0;
        if (left) { status = "fail"; detail += ` | после уборки осталось: ${left}`; }
      }
      // шум ядра/pf2e при уборке: всплывающий текст токена дорисовывается после удаления сцены (не модуль)
      const errs = notes.filter((n) => /^(console\.error|uncaught)/.test(n) && !/createScrollingText|showFloatyText|reading 'position'\) at set y/.test(n));
      if (errs.length) { status = "fail"; detail += ` | ошибки: ${errs.slice(0, 3).join(" / ")}`; }
      else if (status === "fail" && notes.length) detail += ` | уведомления: ${notes.slice(0, 4).join(" / ")}`;
      rows.push({ id: s.id, title: s.title, status, detail });
    }
  } finally {
    Object.assign(N, nOrig);
    console.error = ceOrig;
    window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onErr);
    try { await game.settings.set(MOD, "mode.apply", applyPrev); } catch { /* ok */ }
    try { await game.settings.set(MOD, "mode.limits", limitsPrev); } catch { /* ok */ }
    try { await game.settings.set(MOD, "useToolbeltTargetHelper", tbPrev); } catch { /* ok */ }
    try { await setFlags(origFlags); } catch { /* ok */ }
    await sweep();
    await prevScene?.view();
    await viewCombat(prevCombat);
  }
  const out = rows.map((r) => `${r.status === "ok" ? "PASS" : r.status.toUpperCase()} ${r.id}: ${r.detail}`);
  console.table(rows.map(({ id, status, detail }) => ({ сценарий: id, статус: status, подробности: detail })));
  window.__afLKResult = out;
  return out;
}
