// «Вычесть N из урона»: связь жизни, реакции damaged, Древо-защитник (guard.mjs).
// Изъян d.alter(1, -n): вычитает только из ПЕРВОГО экземпляра, а applyIWR поднимает каждый экземпляр до 0 — при «режущий + огонь» остаток огня шёл бы в цель.

/**
 * Чистая: раскладка вычитания n по экземплярам слева направо. items: [{total, persistent}] -> [cut_i].
 * Продолжительные и пустые экземпляры не уменьшаются и не поглощают; n сверх суммы отбрасывается.
 */
export function spreadCut(items, n) {
  let rest = Math.max(0, Math.floor(Number(n) || 0));
  return items.map((it) => {
    if (it.persistent || !(it.total > 0)) return 0;
    const cut = Math.min(rest, it.total);
    rest -= cut;
    return cut;
  });
}

// Приём DamageRoll#alter (pf2e.mjs): экземпляр клонируется, head оборачивается в Grouping и вычитается NumericTerm.
function cutInstance(inst, cut) {
  const Inst = inst.constructor, T = CONFIG.Dice.termTypes, copy = Inst.fromData(inst.toJSON());
  const head = copy.head.toJSON(), options = head.options ?? {};
  delete head.options;
  const expr = T.ArithmeticExpression.fromData({
    operator: "-",
    operands: [{ class: "Grouping", term: head, options }, { class: "NumericTerm", number: cut }],
    evaluated: true
  });
  return Inst.fromTerms([expr], foundry.utils.deepClone(inst.options));
}

/**
 * Урон меньше на n: число -> d - n; DamageRoll -> новый бросок с теми же экземплярами (тип, категория, материалы, критическая пометка сохраняются).
 * Неоценённый бросок без экземпляров — запасной путь alter(1, -n).
 */
export function subtractDamage(d, n) {
  if (!(n > 0)) return d;
  if (typeof d === "number") return d - n;
  const insts = d?.instances;
  if (!d?._evaluated || !insts?.length) return d.alter(1, -n);
  const cuts = spreadCut(insts.map((i) => ({ total: i.total, persistent: i.persistent })), n);
  if (!cuts.some((c) => c > 0)) return d;
  const rebuilt = insts.map((inst, i) => {
    const copy = cuts[i] > 0 ? cutInstance(inst, cuts[i]) : inst.constructor.fromData(inst.toJSON());
    if (inst._evaluated) copy._evaluated = true;
    return copy;
  });
  const pool = d.terms[0].constructor;
  return d.constructor.fromTerms([pool.fromRolls(rebuilt)], foundry.utils.deepClone(d.options));
}
