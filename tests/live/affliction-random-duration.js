async () => {
  // Живой сценарий случайной длительности стадии недуга (scripts/affliction.mjs enterInterval, affliction-run.mjs enter). Вкладка активного ГМа.
  // Недуг накладывается напрямую шагами модуля (afflictionStep / stageDelta), без брошенных спасбросков. Мировое время не двигаем:
  // проверяем брошенный срок (meta.affliction.iv, nextAt), шёпот ГМу с итогом броска и откат. Копии «AF тест: …» создаются и удаляются сценарием.
  // Параметры: window.__afRD = { only: ["enter", ...], skip: [...] }. Результат — window.__afRDResult (массив «PASS|FAIL id: детали»).
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const opts = { only: null, skip: [], ...(window.__afRD ?? {}) };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const imp = (f) => import(`/modules/${MOD}/scripts/${f}`);
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const LETHARGY = "Compendium.pf2e.equipment-srd.Item.zo0ophqfKunJFxZN";
  const rows = [];
  const created = { msgs: new Set() };
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.msgs.add(m.id); });
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  let cur = "";
  const ok = (cond, text) => rows.push({ id: `${cur}: ${text}`, status: cond ? "PASS" : "FAIL", detail: "" });
  const det = (cond, text, detail) => rows.push({ id: `${cur}: ${text}`, status: cond ? "PASS" : "FAIL", detail: cond ? "" : String(detail) });

  // ---------- окружение ----------
  const mk = async (name) => Actor.create({ ...(await fromUuid(GOBLIN)).toObject(), name: PFX + name, folder, ownership: { default: 0 } });
  const carrier = (a) => a.items.find((i) => i.flags?.[MOD]?.meta?.affliction) ?? null;
  const meta = (a) => carrier(a)?.flags?.[MOD]?.meta?.affliction ?? null;
  const st = (o = {}) => ({ duration: { value: 1, unit: "days" }, conditions: [{ slug: "sickened", value: 1 }], ...o });
  const RND = { value: "1d4", unit: "hours" };
  // Стадии: 1 — фиксированный срок; 2 — случайный 1d4 часов; 3 — конечная.
  const RAW = (o = {}) => ({
    name: `${PFX}недуг`, kind: "poison", save: { statistic: "fortitude", dc: 20 },
    stages: [st(), st({ duration: RND, conditions: [{ slug: "sickened", value: 2 }] }), st({ duration: null })],
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
  let keyN = 0, run, aff;
  const ctx = (extra = {}) => ({ meta: { key: `afrd:${Date.now()}:${keyN++}`, source: "affliction" }, scope: "apply", use: { dc: 20 }, tokenKey: "afrd", degree: 1, selfActor: null, originToken: null, originItem: null, traits: [], ...extra });
  const start = async (a, def, stage = 1) => { const r = await run.afflictionStep(a, { affliction: { stage, def } }, ctx()); await wait(500); return r; };
  const shift = async (a, def, degree) => { const r = await run.afflictionStep(a, { stageDelta: { slug: aff.slugOfDef(def) } }, ctx({ degree })); await wait(600); return r; };
  const gm = () => game.users.filter((u) => u.isGM).map((u) => u.id);
  /** Шёпоты ГМу с броском срока стадии (текст lang `affliction.durRolled`: «…: {формула} = {итог} …»), после t0. */
  const rolls = (t0, formula = RND.value) => game.messages.contents.filter((m) => m._stats.createdTime >= t0 && /biohazard/.test(m.content) && new RegExp(`${formula} = \\d+`).test(m.content.replace(/<[^>]*>/g, "")));
  const inRange = (n) => Number.isInteger(n) && n >= 3600 && n <= 4 * 3600 && n % 3600 === 0;

  const S = [];
  const sc = (id, run_) => S.push({ id, run: run_ });

  sc("validator", async () => {
    // Схема: кубик у срока стадии нормализуется; maxDuration/onset кубиком и мусор — ошибка
    const v = (o) => game.modules.get(MOD).api.validateRule({ v: 1, onUse: { targets: "selected", challenge: { statistic: "fortitude", dc: { value: 20 }, basic: false, rollerRole: "target", byDegree: { failure: [{ to: "target", affliction: { stage: 1, def: o } }] } } } });
    ok(v(RAW()).ok, "{value:'1d4', unit:'hours'} у стадии принят");
    ok(findDef(v(RAW({ stages: [st(), st({ duration: { value: "1d4 + 1", unit: "minutes" } })] })).rule)?.stages[1].duration?.value === "1d4+1", "«1d4 + 1» нормализуется в «1d4+1»");
    ok(!v(RAW({ maxDuration: RND })).ok, "maxDuration кубиком отвергается");
    ok(!v(RAW({ stages: [st(), st({ duration: { value: "abc", unit: "hours" } })] })).ok, "мусорная строка отвергается");
  });

  sc("enter", async () => {
    // Сдвиг на случайную стадию: бросок при входе, iv/nextAt от выпавшего, шёпот ГМу; на фиксированную стадию бросок не идёт
    const def = norm(RAW()), a = await mk("вход");
    const t0 = Date.now();
    await start(a, def, 1);
    ok(meta(a)?.iv === undefined && rolls(t0).length === 0, "стадия 1 (фиксированный срок): iv нет, броска нет");
    const w0 = game.time.worldTime;
    await shift(a, def, 1);   // провал: +1 -> стадия 2
    const m = meta(a);
    ok(carrier(a)?.system?.badge?.value === 2, `стадия 2 (badge=${carrier(a)?.system?.badge?.value})`);
    det(inRange(m?.iv), "iv — целое число часов от 1 до 4", `iv=${m?.iv}`);
    det(m?.nextAt >= w0 + (m?.iv ?? 0) && m?.nextAt <= game.time.worldTime + (m?.iv ?? 0), "nextAt = сейчас + iv", `nextAt=${m?.nextAt}, now=${game.time.worldTime}, iv=${m?.iv}`);
    const r = rolls(t0);
    det(r.length === 1, "один шёпот с броском срока стадии", `шёпотов ${r.length}`);
    det(r.every((x) => x.whisper?.length && x.whisper.every((id) => game.users.get(id)?.isGM)) && gm().every((id) => r[0]?.whisper?.includes(id)), "шёпот — только ГМам", JSON.stringify(r[0]?.whisper));
    const total = Number(/1d4 = (\d+)/.exec(r[0]?.content.replace(/<[^>]*>/g, ""))?.[1]);
    det(total * 3600 === m?.iv, "итог в шёпоте равен iv/3600", `итог ${total}, iv ${m?.iv}`);
    await shift(a, def, 2);   // успех: -1 -> стадия 1
    ok(carrier(a)?.system?.badge?.value === 1 && rolls(t0).length === 1, "возврат на стадию 1: нового броска нет");
    await shift(a, def, 1);   // снова стадия 2
    ok(rolls(t0).length === 2, "повторный вход на стадию 2 — новый бросок и шёпот");
  });

  sc("start-random", async () => {
    // Наложение сразу на случайную стадию (onset нет): срок бросается при создании носителя
    const def = norm(RAW()), a = await mk("старт");
    const t0 = Date.now(), w0 = game.time.worldTime;
    await start(a, def, 2);
    const m = meta(a);
    det(inRange(m?.iv), "iv — целое число часов от 1 до 4", `iv=${m?.iv}`);
    det(m?.nextAt >= w0 + (m?.iv ?? 0) && m?.nextAt <= game.time.worldTime + (m?.iv ?? 0), "nextAt = сейчас + iv", `nextAt=${m?.nextAt}, iv=${m?.iv}`);
    ok(rolls(t0).length === 1, "один шёпот с броском");
  });

  sc("undo", async () => {
    // Откат сдвига возвращает nextAt прежней стадии
    const def = norm(RAW()), a = await mk("откат");
    await start(a, def, 1);
    const before = meta(a).nextAt;
    const r = await shift(a, def, 1);
    ok(meta(a).nextAt !== before, "после сдвига nextAt другой");
    const hold = await imp("condition-hold.mjs");
    await hold.unchecked(() => run.afflictionUndo(carrier(a), r.prev, r.made));
    await wait(800);
    ok(carrier(a)?.system?.badge?.value === 1 && meta(a)?.nextAt === before, `стадия и nextAt вернулись (badge=${carrier(a)?.system?.badge?.value}, nextAt=${meta(a)?.nextAt}, было ${before})`);
  });

  sc("lethargy", async () => {
    // Реальная запись каталога: Летаргический яд, стадия 4 — 1d4 часов (было текстом «for 1d4 hours»)
    const cat = await (await fetch(`/modules/${MOD}/rules/catalog.json`)).json();
    const rule = cat.bySource?.[LETHARGY];
    const def = findDef(rule);
    det(!!def, "запись Летаргического яда в каталоге", "нет записи");
    if (!def) return;
    ok(def.stages[3]?.duration?.value === "1d4" && def.stages[3].duration.unit === "hours", `стадия 4 — случайный срок (${JSON.stringify(def.stages[3]?.duration)})`);
    const a = await mk("летаргия"), t0 = Date.now();
    await start(a, norm({ ...def, name: `${PFX}Летаргический яд` }), 4);
    det(inRange(meta(a)?.iv), "стадия 4: iv — 1–4 часа", `iv=${meta(a)?.iv}`);
    ok(rolls(t0).length === 1, "шёпот с броском 1d4 есть");
  });

  try {
    if (!game.user.isGM || !game.users.activeGM?.isSelf) throw new Error("нужна вкладка активного ГМа (недуги исполняет только он)");
    run = await imp("affliction-run.mjs");
    aff = await imp("affliction.mjs");
    for (const s of S) {
      if ((opts.only && !opts.only.includes(s.id)) || opts.skip.includes(s.id)) continue;
      cur = s.id;
      try { await s.run(); } catch (e) { rows.push({ id: `${s.id}: ошибка`, status: "FAIL", detail: String(e?.stack ?? e).slice(0, 300) }); }
    }
  } catch (e) { rows.push({ id: "ошибка", status: "FAIL", detail: String(e?.stack ?? e).slice(0, 300) }); }
  finally {
    Hooks.off("createChatMessage", hook);
    await wait(500);
    const aliasMsgs = game.messages.filter((m) => String(m.speaker?.alias ?? "").startsWith(PFX)).map((m) => m.id);
    const ids = [...new Set([...created.msgs, ...aliasMsgs])].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
  }
  console.table(rows);
  window.__afRDResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afRDResult;
}
