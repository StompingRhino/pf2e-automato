async () => {
  // Живой сценарий «Сон не роняет ничком» (apply.mjs: флаг standing шага condition; plan-protector-tree.md, Часть 2).
  // Копии «AF тест: …», своя сцена; всё удаляется. Результат — window.__afSSResult.
  //  1. обе записи Сна в каталоге (по uuid и по slug) несут standing у unconscious ранга <=3 (4+ — без standing, prone явный);
  //  2. ранг 3, срок: Unconscious есть, Prone нет;  3. ранг 4 (без standing): Unconscious и Prone оба;
  //  4. уже лежал: Prone остаётся (ручной не трогаем), Unconscious есть;  5. снятие по сроку: обёртка удалена — Unconscious уходит чисто, без остатка;
  //  6. прямой путь без срока (standing): Unconscious без Prone.
  // Если шаг 1 падает на отсутствии standing в загруженном правиле — валидатор rules.mjs (Кусок А) ещё режет поле.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const GOBLIN = "Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4";
  const SLEEP = "Compendium.pf2e.spells-srd.Item.o4lRVTwSxnOOn5vl";
  const prevScene = game.scenes.viewed;
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const api = game.modules.get(MOD).api;
  const has = (a, slug) => a.itemTypes.condition.some((c) => c.slug === slug);
  const mk = async (n) => Actor.create({ ...(await fromUuid(GOBLIN)).toObject(), name: PFX + n, folder, ownership: { default: 0 } });
  const dur = (value, unit) => ({ value, unit, expiry: null, of: "origin" });
  let scene;
  try {
    scene = await Scene.create({ name: PFX + "сцена", width: 1000, height: 1000, grid: { size: 100, distance: 5 }, padding: 0 });
    await scene.view(); await wait(1000);

    // 1. каталог
    const pa = await (await fetch(`/modules/${MOD}/rules/catalog.json`)).json();
    for (const [sec, key] of [["bySource", SLEEP], ["bySlug", "sleep"]]) {
      const by = pa[sec]?.[key]?.onUse?.challenge?.byDegree ?? {};
      const un = ["failure", "criticalFailure"].flatMap((d) => by[d] ?? []).filter((s) => s.condition?.slug === "unconscious");
      const low = un.filter((s) => s.rank?.max === 3), high = un.filter((s) => s.rank?.min >= 4);
      row(`каталог ${key === "sleep" ? "slug" : "uuid"}: standing у ранга <=3, не у 4+`, low.length === 2 && low.every((s) => s.condition.standing) && high.length === 2 && high.every((s) => !s.condition.standing));
    }
    const ruleLive = game.modules.get(MOD).api.resolveRule?.({ uuid: SLEEP, slug: "sleep" });   // если API нет — только файл
    if (ruleLive) row("после валидатора standing не отброшен", JSON.stringify(ruleLive).includes('"standing":true'));

    // 2. ранг 3, срок
    const a = await mk("Сон 3");
    await api.applyCondition(a, { slug: "unconscious", policy: "max", standing: true, duration: dur(1, "minutes") }, { key: "af:s3" });
    await wait(1500);
    row("ранг 3: Unconscious есть, Prone нет", has(a, "unconscious") && !has(a, "prone"), `unc=${has(a, "unconscious")} prone=${has(a, "prone")}`);

    // 5. снятие по сроку: удаляем обёртку
    for (const e of a.itemTypes.effect) await e.delete();
    await wait(1200);
    row("снятие по сроку: ни Unconscious, ни Prone не осталось", !has(a, "unconscious") && !has(a, "prone"), `unc=${has(a, "unconscious")} prone=${has(a, "prone")}`);

    // 3. ранг 4: без standing — оба
    const b = await mk("Сон 4");
    await api.applyCondition(b, { slug: "unconscious", policy: "max", duration: dur(1, "rounds") }, { key: "af:s4" });
    await wait(1500);
    row("ранг 4 (без standing): Unconscious и Prone", has(b, "unconscious") && has(b, "prone"));

    // 4. уже лежал
    const c = await mk("Лежал");
    await c.createEmbeddedDocuments("Item", [game.pf2e.ConditionManager.getCondition("prone").toObject()]);
    await api.applyCondition(c, { slug: "unconscious", policy: "max", standing: true, duration: dur(1, "minutes") }, { key: "af:s5" });
    await wait(1500);
    row("уже лежал: Prone остался, Unconscious есть", has(c, "unconscious") && has(c, "prone"));

    // 6. прямой путь
    const d = await mk("Прямой");
    await api.applyCondition(d, { slug: "unconscious", policy: "max", standing: true }, { key: "af:s6" });
    await wait(1200);
    row("прямой путь: Unconscious без Prone", has(d, "unconscious") && !has(d, "prone"));
  } catch (e) { row("ошибка", false, String(e?.stack ?? e).slice(0, 300)); }
  finally {
    if (prevScene && prevScene.id !== scene?.id) await prevScene.view().catch(() => {});
    await wait(800);
    await scene?.delete().catch(() => {});
    for (const x of game.actors.filter((x) => x.name.startsWith(PFX))) await x.delete().catch(() => {});
  }
  console.table(rows);
  window.__afSSResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afSSResult;
}
