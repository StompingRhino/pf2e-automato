async () => {
  // Живой сценарий Древа-защитника (builtin/guard.mjs, damage-math.mjs; plan-protector-tree.md, кусок Б). Дерево — токен hazard с флагом summoned.guard,
  // поставленный напрямую (размещение через summon.mjs — кусок А, проверяется отдельно). Копии «AF тест: …», своя сцена, всё удаляется. Результат — window.__afPTResult.
  //  1. Удар 6 -> дерево 4/10, цель целая;  2. Удар 14 -> дерево 0 (токен скрыт), цель −4;  3. режущий 5 + огонь 3, дерево 10 -> цель без урона (нет двойного урона), дерево 2;
  //  3б. режущий 5 + огонь 3, дерево 6 -> дерево 0, цель огонь 2 (пересборка DamageRoll по экземплярам — самое хрупкое место);
  //  4. не перехватываются: заклинание, промах, несосед, враг, сам заклинатель;  5. два дерева -> принимает то, у которого больше ПЗ;  6. откат на сообщении дерева возвращает ПЗ и токен.
  const MOD = "pf2e-automato", PFX = "AF тест: ";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  const row = (id, ok, detail = "") => rows.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const created = new Set();
  const hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) created.add(m.id); });
  const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Тестовые копии (автоматизация)")?.id ?? null;
  const prevScene = game.scenes.viewed;
  let scene;
  const tok = async (a, x, y, extra = {}) => (await scene.createEmbeddedDocuments("Token", [{ ...(await a.getTokenDocument({ x, y })).toObject(), ...extra }]))[0];
  const pc = async (name, alliance = "party") => {
    const a = await Actor.create({ name: PFX + name, type: "character", folder, ownership: { default: 0 }, system: { details: { alliance } } });
    const anc = (await game.packs.get("pf2e.ancestries").getIndex({ fields: ["system.slug"] })).find((i) => i.system?.slug === "human");
    if (anc) await a.createEmbeddedDocuments("Item", [(await game.packs.get("pf2e.ancestries").getDocument(anc._id)).toObject()]);
    await a.update({ "system.attributes.hp.value": a.hitPoints.max });
    return a;
  };
  const hazard = async (name, hp) => Actor.create({ name: PFX + name, type: "hazard", folder, ownership: { default: 0 }, system: { attributes: { hp: { value: hp, max: 10 } } } });
  const treeTok = async (by, x, y, hp, alliance = "party") => {
    const a = await hazard("дерево", hp);
    return tok(a, x, y, { flags: { [MOD]: { summoned: { kind: "object", src: "test", by: by.uuid, until: null, guard: { on: "strike", adjacent: 5, side: "allies", alliance } } } } });
  };
  const hpOf = (t) => t.actor.system.attributes.hp.value;
  const Roll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");
  const roll = async (f) => { const r = new Roll(f); await r.evaluate(); return r; };
  let strike = null, spellItem = null;
  const hit = (t, damage, extra = {}) => t.actor.applyDamage({ damage, token: t, item: strike, outcome: "success", rollOptions: new Set(), ...extra });
  try {
    scene = await Scene.create({ name: PFX + "сцена", width: 2000, height: 2000, grid: { size: 100, distance: 5 }, padding: 0 });
    await scene.view(); await wait(1500);
    const druid = await pc("Друид"), fighter = await pc("Воин"), foe = await pc("Враг", "opposition");
    const weapon = (await fighter.createEmbeddedDocuments("Item", [{ type: "weapon", name: "AF меч", system: { damage: { dice: 1, die: "d8", damageType: "slashing" } } }]))[0];
    strike = weapon;
    spellItem = (await fighter.createEmbeddedDocuments("Item", [{ type: "spell", name: "AF заклинание", system: { level: { value: 1 } } }]))[0];
    const tF = await tok(fighter, 600, 500), tD = await tok(druid, 800, 500), tFoe = await tok(foe, 600, 700);
    let tree = await treeTok(druid, 500, 500, 10);

    // 1. Удар 6
    const f0 = fighter.hitPoints.value;
    await hit(tF, 6); await wait(800);
    row("удар 6: дерево 4/10", hpOf(tree) === 4, `дерево ${hpOf(tree)}`);
    row("удар 6: цель не пострадала", fighter.hitPoints.value === f0, `ПЗ ${fighter.hitPoints.value}/${f0}`);

    // 6. откат на сообщении дерева
    const msg = game.messages.contents.filter((m) => m.speaker?.token === tree.id && m.flags?.pf2e?.context?.type === "damage-taken").at(-1);
    row("у дерева есть сообщение damage-taken", !!msg);
    const applied = msg?.flags?.pf2e?.appliedDamage;
    row("у сообщения дерева есть данные отката (appliedDamage)", !!applied);
    if (applied) { await fromUuidSync(applied.uuid)?.undoDamage(applied); await wait(800); }
    row("откат на сообщении дерева возвращает ПЗ", hpOf(tree) === 10, `дерево ${hpOf(tree)}`);

    // 2. Удар 14
    await hit(tF, 14); await wait(800);
    row("удар 14: дерево 0, токен скрыт", hpOf(tree) === 0 && tree.hidden === true, `дерево ${hpOf(tree)} hidden=${tree.hidden}`);
    row("удар 14: цель −4", fighter.hitPoints.value === f0 - 4, `ПЗ ${fighter.hitPoints.value}/${f0}`);
    await tree.actor.update({ "system.attributes.hp.value": 10 }); await wait(500);
    await fighter.update({ "system.attributes.hp.value": f0 });

    // 3. режущий 5 + огонь 3, дерево 10 -> всё дереву
    await hit(tF, await roll("{(5)[slashing],(3)[fire]}")); await wait(800);
    row("режущий 5 + огонь 3: дерево 2, цель без урона", hpOf(tree) === 2 && fighter.hitPoints.value === f0, `дерево ${hpOf(tree)}, цель ${fighter.hitPoints.value}/${f0}`);
    // 3б. дерево 6 -> цель получает огонь 2
    await tree.actor.update({ "system.attributes.hp.value": 6 }); await wait(500);
    await hit(tF, await roll("{(5)[slashing],(3)[fire]}")); await wait(800);
    row("режущий 5 + огонь 3, дерево 6: дерево 0, цель −2", hpOf(tree) === 0 && fighter.hitPoints.value === f0 - 2, `дерево ${hpOf(tree)}, цель ${fighter.hitPoints.value}/${f0 - 2}`);
    await tree.actor.update({ "system.attributes.hp.value": 10 }); await wait(500);
    await fighter.update({ "system.attributes.hp.value": f0 });

    // 4. не перехватывается
    const still = async (id, fn, who = tF) => { const h = who.actor.hitPoints.value; await fn(); await wait(700); row(id, hpOf(tree) === 10 && who.actor.hitPoints.value === h - 3, `дерево ${hpOf(tree)}`); await who.actor.update({ "system.attributes.hp.value": h }); };
    await still("заклинание не перехватывается", () => hit(tF, 3, { item: spellItem }));
    await still("промах не перехватывается", () => hit(tF, 3, { outcome: "failure" }));
    await still("враг не прикрывается", () => hit(tFoe, 3), tFoe);
    await still("заклинатель не прикрывается", () => hit(tD, 3), tD);
    const tFar = await tok(await pc("Дальний"), 1500, 1500);
    await still("несосед не прикрывается", () => hit(tFar, 3), tFar);

    // 5. два дерева
    await tree.actor.update({ "system.attributes.hp.value": 4 });
    const tree2 = await treeTok(druid, 700, 500, 9); await wait(500);
    await hit(tF, 3); await wait(800);
    row("два дерева: принимает с большим остатком (9 -> 6)", hpOf(tree2) === 6 && hpOf(tree) === 4, `${hpOf(tree2)} / ${hpOf(tree)}`);
  } catch (e) {
    row("исключение", false, String(e?.stack ?? e).slice(0, 400));
  } finally {
    Hooks.off("createChatMessage", hook);
    for (const id of created) await game.messages.get(id)?.delete().catch(() => {});
    for (const a of game.actors.filter((x) => x.name.startsWith(PFX))) await a.delete().catch(() => {});
    if (scene) await scene.delete().catch(() => {});
    if (prevScene && prevScene.id !== scene?.id) await prevScene.view().catch(() => {});
    window.__afPTResult = rows;
  }
  return rows;
}
