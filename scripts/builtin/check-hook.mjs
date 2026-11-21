// Единственная обёртка game.pf2e.Check.roll на модуль (libWrapper не даёт регистрировать одну цель дважды; хука «до броска» у pf2e нет).
// Подписчик: async (check, context) => false | void. false — броска нет (запрет уже показан подписчиком, как pf2e с дальним оружием возвращает null);
// иначе подписчик может дополнить проверку (check.push модификатора). Порядок — порядок подписки; первый false прерывает.
import { MOD, L } from "../util.mjs";

const subs = [];   // [{ fn, label }]
let installed = false, warned = false;   // сбой регистрации: предупредить ГМа один раз (install зовут все подписчики)

export function subscribe(fn, label = null) {
  if (!subs.some((s) => s.fn === fn)) subs.push({ fn, label });
}

async function wrap(orig, check, context = {}, ...rest) {
  for (const { fn } of [...subs]) {
    try { if (await fn(check, context) === false) return null; }
    catch (e) { console.warn(`${MOD} | check-hook`, e); }   // сбой подписчика не срывает бросок
  }
  return orig(check, context, ...rest);
}

/** Идемпотентно; вызывать после ready (game.pf2e.Check есть). */
export function install() {
  if (installed || !globalThis.game?.pf2e?.Check?.roll) return;
  if (game.modules.get("lib-wrapper")?.active && globalThis.libWrapper) {
    try { libWrapper.register(MOD, "game.pf2e.Check.roll", wrap, "MIXED"); installed = true; }
    catch (e) {   // например, другой модуль держит OVERRIDE; installed не ставим — повтор возможен
      console.error(`${MOD} | check-hook: libWrapper.register`, e);
      // после всех подписок того же ready (Ремесло, досягаемость, манёвры) — одно предупреждение со всеми подписями
      if (game.user?.isGM && !warned && (warned = true)) setTimeout(() => ui.notifications.warn(L("builtin.wrapFailed", { what: subs.map((s) => s.label).filter(Boolean).join(", ") || "Check.roll", error: e?.message ?? e })), 0);
    }
    return;
  }
  installed = true;
  const C = game.pf2e.Check, orig = C.roll.bind(C);
  C.roll = (...a) => wrap(orig, ...a);
}
