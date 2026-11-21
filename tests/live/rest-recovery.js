async () => {
  // Живой сценарий: отдых на ночь снижает состояния на 2 (builtin/rest-recovery.mjs). Копии «AF тест: …», всё удаляется. Результат — window.__afRRResult.
  //  1. Сонное чадо: истощение 3 -> 1, обречённость 1 -> снята, шёпот «Отдых»;  2. Быстрое восстановление: истощение 2 -> снято, обречённость 2 -> 1 (как у pf2e);
  //  3. без способности: истощение 2 -> 1 (поведение pf2e не тронуто).
  const PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const created = new Set();
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.add(m.id); });
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const DREAM = "Compendium.pf2e.feats-srd.Item.kqnFdIhToKTnOpMl", FAST = "Compendium.pf2e.feats-srd.Item.N8Xz5fuW6o7GW124";
  const val = (a, s) => a.getCondition(s)?.value ?? 0;
  const pc = async (name, feat, conds) => {
    const a = await Actor.create({ name: PFX + name, type: "character", folder, ownership: { default: 0 } });
    if (feat) await a.createEmbeddedDocuments("Item", [(await fromUuid(feat)).toObject()]);
    for (const [s, v] of Object.entries(conds)) await a.increaseCondition(s, { value: v });
    return a;
  };
  try {
    const dream = await pc("Сонное чадо", DREAM, { drained: 3, doomed: 1 });
    const fast = await pc("Быстрое восстановление", FAST, { drained: 2, doomed: 2 });
    const none = await pc("без способности", null, { drained: 2 });
    row("исходно", val(dream, "drained") === 3 && val(dream, "doomed") === 1 && val(fast, "drained") === 2 && val(fast, "doomed") === 2 && val(none, "drained") === 2,
      `чадо ${val(dream, "drained")}/${val(dream, "doomed")}, быстрое ${val(fast, "drained")}/${val(fast, "doomed")}, без ${val(none, "drained")}`);
    const t0 = Date.now();
    await game.pf2e.actions.restForTheNight({ actors: [dream, fast, none], skipDialog: true });
    await wait(2500);
    row("Сонное чадо: истощение 3 -> 1, обречённость снята", val(dream, "drained") === 1 && val(dream, "doomed") === 0, `${val(dream, "drained")}/${val(dream, "doomed")}`);
    row("Быстрое восстановление: истощение снято, обречённость 2 -> 1", val(fast, "drained") === 0 && val(fast, "doomed") === 1, `${val(fast, "drained")}/${val(fast, "doomed")}`);
    row("без способности: истощение 2 -> 1 (pf2e)", val(none, "drained") === 1, `${val(none, "drained")}`);
    const notes = game.messages.contents.filter((m) => m._stats.createdTime >= t0 && m.flags?.["pf2e-automato"]?.builtin === "rest");
    row("шёпот «Отдых»: по одному у двоих со способностью", notes.length === 2 && notes.every((m) => m.whisper.length > 0), notes.map((m) => m.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).join(" || "));
  } catch (e) { row("исключение", false, String(e?.stack ?? e).slice(0, 400)); }
  finally {
    Hooks.off("createChatMessage", hook);
    const ids = [...created].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    for (const a of game.actors.filter((a) => a.name.startsWith(PFX))) await a.delete().catch(() => {});
  }
  console.table(rows);
  window.__afRRResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afRRResult;
}
