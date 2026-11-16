// Общий выбор ячейки заклинания: Проводящий блок (builtin/channeling-block) и контрзаклинание (counterspell, counter.expend).
// Чистые функции над данными колдовства актёра; трата — pf2e SpellcastingEntryPF2e.consume (подготовленное: expended слота, спонтанное и «гибкое»: счётчик).

const defaultLabel = (e, s, r) => `${e.name}: ${s.name} (${r})`;

/**
 * Чистая: варианты траты. entry: {id, name, mode: "prepared" | "counted", prepared, tradition, slots: {ранг: {value, max, prepared: [{id, expended}]}}, spells: [{id, slug, name, base, signature, traits}]}.
 * prepared — слот подготовки с подходящим заклинанием не потрачен; counted (спонтанные, гибкие) — есть слот ранга; сигнатурное заклинание — в слоте любого ранга от базового.
 * want(spell) — подходящие заклинания; rankOk(rank) — подходящие ранги; anyRank — «любая ячейка» (counted без привязки к рангу заклинания репертуара).
 * -> [{id: "entry:spell:rank:slot", entry, spell, rank, slot, label}]  (формат id лежит в data-af-cb старых карточек — не менять)
 */
export function blockOptions(entries, label = defaultLabel, { want = () => true, rankOk = () => true, anyRank = false } = {}) {
  const out = [], add = (e, s, rank, slot) => out.push({ id: `${e.id}:${s.id}:${rank}:${slot ?? ""}`, entry: e.id, spell: s.id, rank, slot, label: label(e, s, rank) });
  for (const e of entries) {
    const spells = e.spells.filter((s) => !s.cantrip && !s.focus && (!e.flexible || s.signature) && want(s));   // заговор/фокус consume не тратит; «гибкая» сотворяет только дневную коллекцию (signature)
    for (const [rank, slots] of Object.entries(e.slots ?? {})) {
      if (!slots?.max || !rankOk(+rank)) continue;
      if (e.mode === "prepared") slots.prepared?.forEach((p, i) => { const s = p?.id && !p.expended && spells.find((x) => x.id === p.id); if (s) add(e, s, +rank, i); });
      else if (slots.value > 0) for (const s of spells) if (anyRank || (s.signature ? +rank >= s.base : +rank === s.base)) add(e, s, +rank, null);
    }
  }
  return out;
}

/** Чистая: по одному варианту на ключ (по умолчанию «запись + заклинание + ранг»: одинаковые подготовленные слоты не множим). */
export const uniqueOptions = (opts, key = (o) => `${o.entry}:${o.spell}:${o.rank}`) => opts.filter((o, i) => opts.findIndex((x) => key(x) === key(o)) === i);

/**
 * Данные колдовства актёра -> входные данные blockOptions. Только подготовленные и спонтанные записи: врождённое, очки фокуса, ритуалы и предметы
 * (посохи/свитки, prepared.value "items": слотов нет) ячейку не тратят. Заговоры и заклинания фокуса — в списке с флагами cantrip/focus (для условий триггера),
 * но blockOptions их отсеивает: pf2e consume для них возвращает true без траты, «ячейка» вышла бы бесплатной.
 */
export const entriesOf = (actor) => (actor?.itemTypes?.spellcastingEntry ?? []).filter((e) => e.spells && (e.isPrepared || e.isSpontaneous) && !e.isInnate && !e.isFocusPool && !e.isRitual).map((e) => ({
  id: e.id, name: e.name, mode: e.isPrepared && !e.isFlexible ? "prepared" : "counted", flexible: !!e.isFlexible, prepared: !!e.isPrepared, tradition: e.tradition ?? null,
  slots: Object.fromEntries([...Array(10)].map((_, i) => [i + 1, e.system.slots?.[`slot${i + 1}`]])),
  spells: [...e.spells].map((s) => ({ cantrip: !!s.isCantrip, focus: !!s.isFocusSpell, id: s.id, slug: s.slug, name: s.name, base: s.system.location?.heightenedLevel ?? s.rank, signature: !!s.system.location?.signature, traits: [...(s.traits ?? [])] }))
}));
