async () => {
  // Живой сценарий: Татуировщик даёт +1 к Ремеслу при Создании татуировки (builtin/craft-bonus.mjs). Копии «AF тест: …», всё удаляется. Результат — window.__afCBResult.
  //  1. татуировка — модификатор «Татуировщик» +1 в броске;  2. обычный предмет — модификатора нет;  3. мастер Ремесла — +2.
  const PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const created = new Set();
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.add(m.id); });
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const FEAT = "Compendium.pf2e.feats-srd.Item.z0HX5L7bOOrKi0dD";
  const pack = game.packs.get("pf2e.equipment-srd");
  const tattooIdx = (await pack.getDocuments({ type: "equipment" })).find((d) => d.system.traits.value.includes("tattoo"));   // по признаку, не по имени (Babele переводит)
  const plainIdx = pack.index.find((i) => i.name === "Rope") ?? pack.index.find((i) => i.type === "equipment");
  const modsOf = async (actor, uuid) => {
    // окно проверки — по настройке клиента: открылось — читаем из него и закрываем; нет — из сообщения броска
    const t0 = Date.now();
    game.pf2e.actions.craft({ actors: [actor], uuid });
    let d = null, m = null;
    for (let i = 0; i < 50 && !d && !m; i++) {
      await wait(100);
      d = Object.values(ui.windows).find((w) => w.constructor.name === "CheckModifiersDialog");
      m = game.messages.contents.find((x) => x._stats.createdTime >= t0 && x.speaker?.actor === actor.id && x.flags?.pf2e?.context?.type === "skill-check");
    }
    const list = d ? d.check?.modifiers ?? [] : m?.flags?.pf2e?.modifiers ?? [];
    await d?.close();
    return list.filter((x) => x.enabled !== false).map((x) => `${x.slug}:${x.modifier}`);
  };
  try {
    const a = await Actor.create({ name: PFX + "Татуировщик", type: "character", folder, ownership: { default: 0 } });
    await a.createEmbeddedDocuments("Item", [(await fromUuid(FEAT)).toObject()]);
    await a.update({ "system.skills.crafting.rank": 2 });
    const t = await modsOf(a, tattooIdx.uuid);
    row(`татуировка (${tattooIdx.name}): +1`, t.includes("tattoo-artist:1"), JSON.stringify(t));
    const p = await modsOf(a, plainIdx.uuid);
    row(`обычный предмет (${plainIdx.name}): без бонуса`, !p.some((x) => x.startsWith("tattoo-artist")), JSON.stringify(p));
    await a.update({ "system.skills.crafting.rank": 3 });
    const m = await modsOf(a, tattooIdx.uuid);
    row("мастер Ремесла: +2", m.includes("tattoo-artist:2"), JSON.stringify(m));
    // 4. путь листа: рецепт в книге формул, вкладка «Ремесло», кнопка «Создать» (лист зовёт craft напрямую, мимо game.pf2e.actions)
    await a.update({ "system.crafting.formulas": [{ uuid: tattooIdx.uuid }] });
    const sheet = a.sheet; await sheet.render(true); await wait(1500);
    sheet.activateTab?.("crafting"); await wait(800);
    const root = sheet.element?.[0] ?? sheet.element;
    const btn = root?.querySelector(`li[data-item-uuid="${tattooIdx.uuid}"] [data-action=craft-item]`);
    let sm = null;
    if (btn) {
      const t0 = Date.now(); btn.click();
      let d = null;
      for (let i = 0; i < 50 && !d && !sm; i++) {
        await wait(100);
        d = Object.values(ui.windows).find((w) => w.constructor.name === "CheckModifiersDialog");
        sm = game.messages.contents.find((x) => x._stats.createdTime >= t0 && x.speaker?.actor === a.id && x.flags?.pf2e?.context?.type === "skill-check");
      }
      sm = (d ? d.check?.modifiers ?? [] : sm?.flags?.pf2e?.modifiers ?? []).filter((x) => x.enabled !== false).map((x) => `${x.slug}:${x.modifier}`);
      await d?.close();
    }
    await sheet.close();
    row("лист: кнопка «Создать» — бонус +2", !!btn && sm?.includes("tattoo-artist:2"), btn ? JSON.stringify(sm) : "кнопки нет на листе");
  } catch (e) { row("исключение", false, String(e?.stack ?? e).slice(0, 400)); }
  finally {
    Hooks.off("createChatMessage", hook);
    const ids = [...created].filter((id) => game.messages.has(id));
    if (ids.length) await ChatMessage.deleteDocuments(ids).catch(() => {});
    for (const x of game.actors.filter((x) => x.name.startsWith(PFX))) await x.delete().catch(() => {});
  }
  console.table(rows);
  window.__afCBResult = rows.map((r) => `${r.status} ${r.id}${r.detail ? `: ${r.detail}` : ""}`);
  return window.__afCBResult;
}
