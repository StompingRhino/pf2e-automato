async () => {
  // Живой сценарий запрета hold недугов (scripts/condition-hold.mjs, plan-affliction-linger-hold.md §3.7). Вкладка активного ГМа.
  // Недуг накладывается напрямую шагами модуля (afflictionStep: создание носителя и стадия, stageDelta: сдвиг по степени), без брошенных спасбросков.
  // Def с holds нормализуется через validateRule (заодно проверяет, что holds/stageLock не отбрасываются). Копии «AF тест: …» создаются и удаляются сценарием, мир не трогаем.
  // Параметры: window.__afAH = { only: ["bare", ...], skip: [...] }. Результат — window.__afAHResult (массив «PASS|FAIL id: детали»).
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const opts = { only: null, skip: [], ...(window.__afAH ?? {}) };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const imp = (f) => import(`/modules/${MOD}/scripts/${f}`);
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const rows = [], warns = [];
  const N = ui.notifications, warnOrig = N.warn;
  N.warn = function (m, ...r) { warns.push(String(m)); return warnOrig.call(this, m, ...r); };
  const created = { msgs: new Set() };
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.msgs.add(m.id); });
  const modeLimits = game.settings.get(MOD, "mode.limits");
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  let cur = "";
  const ok = (cond, text) => rows.push({ id: `${cur}: ${text}`, status: cond ? "PASS" : "FAIL", detail: "" });
  const det = (cond, text, detail) => rows.push({ id: `${cur}: ${text}`, status: cond ? "PASS" : "FAIL", detail: cond ? "" : String(detail) });

  // ---------- окружение ----------
  const mk = async (name) => Actor.create({ ...(await fromUuid(GOBLIN)).toObject(), name: PFX + name, folder, ownership: { default: 0 } });
  const cond = (a, slug) => a.itemTypes.condition.find((c) => c.slug === slug) ?? null;
  const val = (a, slug) => { const c = cond(a, slug); return c ? (c.system?.value?.value ?? 1) : 0; };
  const carrier = (a) => a.items.find((i) => i.flags?.[MOD]?.meta?.affliction) ?? null;
  const meta = (a) => carrier(a)?.flags?.[MOD]?.meta?.affliction ?? null;
  const heldKeys = (a) => Object.keys(meta(a)?.held ?? {}).sort().join(",");
  const st = (conditions) => ({ duration: { value: 1, unit: "days" }, conditions });
  // Стадии: 1 — sickened 1; 2 — sickened 2, clumsy 1, drained 1; 3 — sickened 3, clumsy 2, drained 1. sickened/drained — «голые» (UNLINKED), clumsy — в обёртке.
  const RAW = (o = {}) => ({
    name: `${PFX}недуг`, kind: "disease", save: { statistic: "fortitude", dc: 20 },
    holds: [{ slug: "sickened" }, { slug: "drained" }, { slug: "clumsy" }],
    stages: [st([{ slug: "sickened", value: 1 }]), st([{ slug: "sickened", value: 2 }, { slug: "clumsy", value: 1 }, { slug: "drained", value: 1 }]), st([{ slug: "sickened", value: 3 }, { slug: "clumsy", value: 2 }, { slug: "drained", value: 1 }])],
    ...o
  });
  const findDef = (x) => {
    if (!x || typeof x !== "object") return null;
    if (x.def && x.stage != null) return x.def;
    for (const v of Object.values(x)) { const r = findDef(v); if (r) return r; }
    return null;
  };
  const norm = (raw) => {
    const v = game.modules.get(MOD).api.validateRule({ v: 1, onUse: { targets: "selected", challenge: { statistic: "fortitude", dc: { value: 20 }, basic: false, rollerRole: "target", byDegree: { failure: [{ to: "target", affliction: { stage: 1, def: raw } }] } } } });
    if (!v.ok) throw new Error(`def невалиден: ${v.errors.map(String).join("; ")}`);
    return findDef(v.rule);
  };
  let keyN = 0;
  const ctx = (extra = {}) => ({ meta: { key: `afah:${Date.now()}:${keyN++}`, source: "affliction" }, scope: "apply", use: { dc: 20 }, tokenKey: "afah", degree: 1, selfActor: null, originToken: null, originItem: null, traits: [], ...extra });
  let run, hold;
  /** Наложить недуг на актёра сразу на стадии stage; возвращает результат шага. */
  const start = async (a, def, stage = 1) => { const r = await run.afflictionStep(a, { affliction: { stage, def } }, ctx()); await wait(500); return r; };
  /** Сдвиг стадии по степени спасброска (0 крит. провал … 3 крит. успех). */
  const shift = async (a, def, degree) => { const r = await run.afflictionStep(a, { stageDelta: { slug: aff.slugOfDef(def) } }, ctx({ degree })); await wait(600); return r; };
  let aff;
  const withAlt = async (fn) => {
    const orig = game.keyboard.isModifierActive.bind(game.keyboard);
    game.keyboard.isModifierActive = (k) => k === "Alt" || orig(k);
    try { return await fn(); } finally { game.keyboard.isModifierActive = orig; }
  };
  /** Ручная операция с листа; возвращает, было ли предупреждение удержания именно этого недуга. */
  const manual = async (fn, def) => {
    warns.length = 0; hold.resetToasts();   // тост гасит дубли в течение 2 с на (актёр, slug): сбрасываем, чтобы видеть каждый отказ
    try { await fn(); } catch (e) { warns.push(`ИСКЛЮЧЕНИЕ ${e}`); }
    await wait(500);
    return warns.some((w) => w.includes(def.name) && /Alt/.test(w));
  };
  const holdWarns = (def) => warns.filter((w) => w.includes(def.name) && /Alt/.test(w)).length;
  const lim = (m) => game.settings.set(MOD, "mode.limits", m);

  const S = [];
  const sc = (id, run_) => S.push({ id, run: run_ });

  sc("bare", async () => {
    // Сценарий 1: голое состояние — снятие и снижение с листа отменяются, Alt проходит
    const def = norm(RAW()), a = await mk("голое");
    await start(a, def, 1);
    ok(heldKeys(a) === "sickened", `стадия 1: удерживается sickened (held=[${heldKeys(a)}])`);
    ok(val(a, "sickened") === 1, "sickened 1 наложен");
    let w = await manual(() => a.decreaseCondition("sickened"), def);
    ok(w && val(a, "sickened") === 1, `decreaseCondition(1→0) отменён с предупреждением (warned=${w}, value=${val(a, "sickened")})`);
    w = await manual(() => cond(a, "sickened").delete(), def);
    ok(w && val(a, "sickened") === 1, `item.delete() отменён с предупреждением (warned=${w})`);
    w = await manual(() => withAlt(() => a.decreaseCondition("sickened")), def);
    ok(!w && val(a, "sickened") === 0, `с Alt снимается без предупреждения (warned=${w}, value=${val(a, "sickened")})`);
    // стадия 2: sickened 2 — снижение до 1 запрещено (floor = значение стадии), повышение свободно
    const b = await mk("голое-2");
    await start(b, def, 2);
    ok(val(b, "sickened") === 2 && meta(b)?.held?.sickened?.floor === 2, `стадия 2: sickened 2, floor 2 (value=${val(b, "sickened")}, floor=${meta(b)?.held?.sickened?.floor})`);
    w = await manual(() => b.decreaseCondition("sickened"), def);
    ok(w && val(b, "sickened") === 2, `снижение 2→1 ниже floor отменено (warned=${w}, value=${val(b, "sickened")})`);
    w = await manual(() => b.increaseCondition("sickened"), def);
    ok(!w && val(b, "sickened") === 3, `повышение 2→3 свободно (warned=${w}, value=${val(b, "sickened")})`);
    w = await manual(() => b.decreaseCondition("sickened"), def);
    ok(!w && val(b, "sickened") === 2, `возврат 3→2 (до floor) свободен (warned=${w}, value=${val(b, "sickened")})`);
  });

  sc("wrapped", async () => {
    // Сценарий 2: обёрнутое состояние (clumsy 2 на стадии 3) — снижение значения отменяется; Alt проходит
    const def = norm(RAW()), a = await mk("обёртка");
    await start(a, def, 3);
    ok(val(a, "clumsy") === 2, `clumsy 2 наложен (value=${val(a, "clumsy")})`);
    ok(heldKeys(a) === "clumsy,drained,sickened", `удерживаются все три (held=[${heldKeys(a)}])`);
    let w = await manual(() => a.decreaseCondition("clumsy"), def);
    ok(w && val(a, "clumsy") === 2, `снижение clumsy 2→1 отменено (warned=${w}, value=${val(a, "clumsy")})`);
    w = await manual(() => withAlt(() => a.decreaseCondition("clumsy")), def);
    ok(!w && val(a, "clumsy") === 1, `с Alt снижается (warned=${w}, value=${val(a, "clumsy")})`);
  });

  sc("stage-down", async () => {
    // Сценарий 3: смена стадии вниз выставляет значения сама, без тоста; состояние, которого нет на стадии, перестаёт удерживаться
    const def = norm(RAW()), a = await mk("вниз");
    await start(a, def, 3);
    warns.length = 0;
    await shift(a, def, 2);   // успех: −1 → стадия 2
    ok(carrier(a)?.system?.badge?.value === 2, `стадия 2 (badge=${carrier(a)?.system?.badge?.value})`);
    ok(val(a, "sickened") === 2, `sickened снижен до 2 сам (value=${val(a, "sickened")})`);
    ok(val(a, "clumsy") === 1, `clumsy сменился обёрткой стадии (value=${val(a, "clumsy")})`);
    ok(meta(a)?.held?.sickened?.floor === 2, `floor sickened = 2 (floor=${meta(a)?.held?.sickened?.floor})`);
    det(holdWarns(def) === 0, "смена стадии без предупреждений удержания", warns.join(" | "));
    await shift(a, def, 2);   // стадия 1: нет ни clumsy, ни drained
    ok(carrier(a)?.system?.badge?.value === 1 && val(a, "sickened") === 1, `стадия 1, sickened 1 (value=${val(a, "sickened")})`);
    ok(val(a, "clumsy") === 0, `clumsy ушёл вместе с обёрткой (value=${val(a, "clumsy")})`);
    ok(heldKeys(a) === "sickened", `held только sickened — старые slug убраны (held=[${heldKeys(a)}])`);
    det(holdWarns(def) === 0, "и вторая смена без предупреждений", warns.join(" | "));
    // drained остался (UNLINKED поднимаются и не снимаются), но уже не удерживается
    const w = await manual(() => a.decreaseCondition("drained"), def);
    ok(!w && val(a, "drained") === 0, `drained (не на стадии 1) снимается свободно (warned=${w}, value=${val(a, "drained")})`);
  });

  sc("cure", async () => {
    // Сценарий 4: излечение = удаление носителя — состояния снимаются, без тоста
    const def = norm(RAW()), a = await mk("излечение");
    await start(a, def, 3);
    ok(val(a, "sickened") === 3 && val(a, "drained") === 1 && val(a, "clumsy") === 2, "на стадии 3 все три состояния");
    warns.length = 0;
    await carrier(a).delete();
    await wait(1500);
    ok(!carrier(a), "носитель удалён");
    ok(val(a, "sickened") === 0 && val(a, "drained") === 0 && val(a, "clumsy") === 0, `состояния сняты (sickened=${val(a, "sickened")}, drained=${val(a, "drained")}, clumsy=${val(a, "clumsy")})`);
    det(warns.length === 0, "без предупреждений", warns.join(" | "));
  });

  sc("undo", async () => {
    // Сценарий 5: откат применения стадии — held возвращается к прежнему (замена), созданное стадией снято, предупреждений нет
    const def = norm(RAW()), a = await mk("откат");
    await start(a, def, 1);
    const r = await shift(a, def, 1);   // провал: +1 → стадия 2 (drained и clumsy появились)
    ok(heldKeys(a) === "clumsy,drained,sickened", `на стадии 2 держится три (held=[${heldKeys(a)}])`);
    warns.length = 0;
    await hold.unchecked(() => run.afflictionUndo(carrier(a), r.prev, r.made));   // как undoOps (apply.mjs): откат внутри unchecked
    await wait(800);
    ok(carrier(a)?.system?.badge?.value === 1, `стадия вернулась (badge=${carrier(a)?.system?.badge?.value})`);
    ok(heldKeys(a) === "sickened", `held вернулся к стадии 1: слаги стадии 2 исчезли (held=[${heldKeys(a)}])`);
    ok(val(a, "drained") === 0, `drained, созданный стадией 2, снят откатом (value=${val(a, "drained")})`);
    ok(val(a, "sickened") === 1, `sickened вернулся к 1 (value=${val(a, "sickened")})`);
    const w = await manual(() => a.decreaseCondition("clumsy"), def);
    ok(!w, `после отката clumsy не держится (warned=${w})`);
  });

  sc("stagelock", async () => {
    // Сценарий 6: stageLock — успех на стадии 1 недуг не снимает, на карточке строка; контроль без stageLock снимает
    const def = norm(RAW({ stageLock: true })), ctl = norm(RAW({ name: `${PFX}недуг-контроль` })), a = await mk("замок"), b = await mk("замок-контроль");
    ok(def.stageLock === true, "stageLock дошёл до нормализованного def");
    await start(a, def, 1);
    ok(meta(a)?.locked === true, `meta.locked = true (${meta(a)?.locked})`);
    const t0 = Date.now();
    await shift(a, def, 2);   // успех на стадии 1
    ok(!!carrier(a) && carrier(a).system.badge.value === 1, `носитель на месте, стадия 1 (badge=${carrier(a)?.system?.badge?.value})`);
    const line = game.i18n.format("PF2E_AUTOMATO.affliction.stageLocked", { item: def.name, target: a.name });
    const cards = game.messages.contents.filter((m) => m._stats.createdTime >= t0);
    det(cards.some((m) => m.content.includes(line)), "строка «лечение не проведено» выложена в чат", `новых сообщений ${cards.length}; ждали «${line}»`);
    await shift(a, def, 3);   // крит. успех: −2
    ok(!!carrier(a), "крит. успех (−2) тоже не снимает");
    await start(b, ctl, 1);
    await shift(b, ctl, 2);
    await wait(800);
    ok(!carrier(b), "контроль без stageLock: успех снимает носитель");
  });

  sc("limits-off", async () => {
    // Сценарий 7: mode.limits=off — запрета нет
    const def = norm(RAW()), a = await mk("лимиты");
    await start(a, def, 3);
    await lim("off");
    let w = await manual(() => a.decreaseCondition("clumsy"), def);
    ok(!w && val(a, "clumsy") === 1, `off: clumsy 2→1 без предупреждения (warned=${w}, value=${val(a, "clumsy")})`);
    w = await manual(() => a.decreaseCondition("drained"), def);
    ok(!w && val(a, "drained") === 0, `off: drained снят без предупреждения (warned=${w}, value=${val(a, "drained")})`);
    await lim("auto");
    w = await manual(() => a.decreaseCondition("sickened"), def);
    ok(w && val(a, "sickened") === 3, `auto обратно: sickened 3→2 ниже floor 3 отменяется (warned=${w}, value=${val(a, "sickened")})`);
  });

  sc("present", async () => {
    // Дополнительно: mode "present" (Azarpal) — снижать до 1 можно, снять нельзя
    const def = norm(RAW({ name: `${PFX}недуг-present`, holds: [{ slug: "sickened", mode: "present" }] })), a = await mk("present");
    await start(a, def, 3);
    ok(val(a, "sickened") === 3 && meta(a)?.held?.sickened?.floor === 1, `sickened 3, floor 1 (value=${val(a, "sickened")}, floor=${meta(a)?.held?.sickened?.floor})`);
    let w = await manual(() => a.decreaseCondition("sickened"), def);
    ok(!w && val(a, "sickened") === 2, `3→2 свободно (warned=${w}, value=${val(a, "sickened")})`);
    await a.decreaseCondition("sickened"); await wait(400);
    w = await manual(() => a.decreaseCondition("sickened"), def);
    ok(w && val(a, "sickened") === 1, `1→0 (снять) запрещено (warned=${w}, value=${val(a, "sickened")})`);
  });

  sc("two-afflictions", async () => {
    // Сценарий 8: два недуга на одном slug — излечение одного оставляет состояние, ключ переходит ко второму; излечение второго снимает
    const A = norm(RAW({ name: `${PFX}недуг-А`, holds: [{ slug: "sickened" }] })), B = norm(RAW({ name: `${PFX}недуг-Б`, holds: [{ slug: "sickened" }], stages: [st([{ slug: "sickened", value: 1 }]), st([{ slug: "sickened", value: 1 }]), st([{ slug: "sickened", value: 1 }])] }));
    const a = await mk("два-недуга"), byName = (n) => a.items.find((i) => i.name === n && i.flags?.[MOD]?.meta?.affliction);
    await start(a, A, 1); await start(a, B, 1);
    ok(!!byName(A.name) && !!byName(B.name), "оба носителя на месте");
    await byName(A.name).delete(); await wait(1200);
    ok(val(a, "sickened") >= 1, `после излечения А состояние осталось (value=${val(a, "sickened")})`);
    ok(String(cond(a, "sickened")?.flags?.[MOD]?.meta?.key ?? "").startsWith("affl:"), `ключ документа жив (${cond(a, "sickened")?.flags?.[MOD]?.meta?.key})`);
    const w = await manual(() => a.decreaseCondition("sickened"), B);
    ok(w && val(a, "sickened") >= 1, `Б по-прежнему держит (warned=${w})`);
    await byName(B.name).delete(); await wait(1200);
    ok(val(a, "sickened") === 0, `излечение Б снимает состояние (value=${val(a, "sickened")})`);
  });

  sc("frightened-turn", async () => {
    // Сценарий 9: конец хода (turn-conditions) не опускает испуг ниже floor недуга
    const def = norm(RAW({ name: `${PFX}недуг-испуг`, holds: [{ slug: "frightened" }], stages: [st([{ slug: "frightened", value: 2 }]), st([{ slug: "frightened", value: 2 }]), st([{ slug: "frightened", value: 2 }])] })), a = await mk("испуг");
    await start(a, def, 1);
    ok(val(a, "frightened") === 2, `frightened 2 (value=${val(a, "frightened")})`);
    Hooks.callAll("pf2e.endTurn", { actor: a, id: "afah" }); await wait(1000);
    ok(val(a, "frightened") === 2, `после конца хода не ниже floor 2 (value=${val(a, "frightened")})`);
  });

  sc("wrapper-delete", async () => {
    // Сценарий 10: удаление обёртки, выдавшей удерживаемое состояние, отменяется (каскад pf2e не снимет состояние); после смены стадии держится новый id
    const def = norm(RAW()), a = await mk("обёртка-удаление");
    await start(a, def, 2);
    const wrap = cond(a, "clumsy")?.grantedBy;
    ok(!!wrap, "clumsy выдан обёрткой");
    const w = await manual(() => wrap.delete(), def);
    ok(w && val(a, "clumsy") === 1, `удаление обёртки отменено (warned=${w}, value=${val(a, "clumsy")})`);
    await shift(a, def, 1);   // провал: стадия 3, обёртка новая
    ok(meta(a)?.held?.clumsy?.id === cond(a, "clumsy")?.id, `held.clumsy.id — новый документ (held=${meta(a)?.held?.clumsy?.id}, doc=${cond(a, "clumsy")?.id})`);
    const w2 = await manual(() => a.decreaseCondition("clumsy"), def);
    ok(w2 && val(a, "clumsy") === 2, `снижение clumsy на новой стадии отменено (warned=${w2}, value=${val(a, "clumsy")})`);
  });

  sc("foreign-higher", async () => {
    // Сценарий 11: чужое большее значение (испуг 3 от Запугивания) спуском стадии не понижается
    const def = norm(RAW({ name: `${PFX}недуг-чужой`, holds: [{ slug: "frightened" }], stages: [st([{ slug: "frightened", value: 1 }]), st([{ slug: "frightened", value: 2 }]), st([{ slug: "frightened", value: 2 }])] })), a = await mk("чужой-испуг");
    await a.increaseCondition("frightened", { value: 3 }); await wait(300);
    await start(a, def, 1);
    const foreignId = cond(a, "frightened")?.id;
    ok(!!meta(a)?.held?.frightened?.id && meta(a).held.frightened.id !== foreignId, `held — свой документ недуга, не чужой (held id=${meta(a)?.held?.frightened?.id}, чужой=${foreignId})`);
    await shift(a, def, 1); await shift(a, def, 2);   // стадия 2, затем обратно на 1
    ok(val(a, "frightened") === 3, `испуг 3 не понижен (value=${val(a, "frightened")})`);
  });

  sc("zone-plus", async () => {
    // Сценарий 12: зона создала свою копию состояния — носитель держит не её документ
    const def = norm(RAW({ name: `${PFX}недуг-зона`, holds: [{ slug: "sickened" }] })), a = await mk("зона");
    const { applyCondition } = await imp("apply.mjs");
    await applyCondition(a, { slug: "sickened", value: 1, policy: "max" }, { key: `zone:${PFX}r1`, source: "zone" });
    const { removeByKey } = await imp("apply.mjs"), zoneDoc = cond(a, "sickened");
    await start(a, def, 1);
    const ownId = meta(a)?.held?.sickened?.id;
    ok(!!zoneDoc && !!ownId && ownId !== zoneDoc.id, `held.sickened.id — свой документ, не зоновой копии (held=${ownId}, zone=${zoneDoc?.id})`);
    warns.length = 0;
    await removeByKey(a, `zone:${PFX}r1`); await wait(500);   // выход из зоны
    ok(!a.items.has(zoneDoc.id) && a.items.has(ownId) && holdWarns(def) === 0, `копия зоны снята без блока, документ недуга остался (warns=${warns.join(" | ")})`);
    await carrier(a).delete(); await wait(1200);
    ok(val(a, "sickened") === 0, `излечение снимает свой документ (value=${val(a, "sickened")})`);
  });

  try {
    if (!game.user.isGM || !game.users.activeGM?.isSelf) throw new Error("нужна вкладка активного ГМа (недуги исполняет только он)");
    run = await imp("affliction-run.mjs");
    aff = await imp("affliction.mjs");
    hold = await imp("condition-hold.mjs");
    await lim("auto");
    for (const s of S) {
      if ((opts.only && !opts.only.includes(s.id)) || opts.skip.includes(s.id)) continue;
      cur = s.id; warns.length = 0;
      try { await s.run(); } catch (e) { rows.push({ id: `${s.id}: ошибка`, status: "FAIL", detail: String(e?.stack ?? e).slice(0, 300) }); }
    }
  } catch (e) { rows.push({ id: "ошибка", status: "FAIL", detail: String(e?.stack ?? e).slice(0, 300) }); }
  finally {
    N.warn = warnOrig; Hooks.off("createChatMessage", hook);
    try { await lim(modeLimits); } catch { /* ok */ }
    await wait(500);
    const aliasMsgs = game.messages.filter((m) => String(m.speaker?.alias ?? "").startsWith(PFX)).map((m) => m.id);
    const ids = [...new Set([...created.msgs, ...aliasMsgs])].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
  }
  console.table(rows);
  window.__afAHResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afAHResult;
}
