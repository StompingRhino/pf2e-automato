// Токены из FA Nexus (необязательно, у ГМа): ступень 1 — уже скачанные файлы в папке Nexus, ступень 2 — бесплатный каталог Nexus (findToken — ядро; призыв и формы — его потребители).
// Публичного API у Nexus нет — внутренние модули импортируются динамически, под проверенную версию (compat.EXTERNAL.verified["fa-nexus"]).
import { MOD, debug, queue } from "./util.mjs";
import { EXTERNAL } from "./compat.mjs";

const IMG = /\.(webp|png|jpe?g|avif|gif)$/i;
// слова-варианты Nexus (цвет рамки, номер, служебные) — при сравнении имени отбрасываются
const VARIANT = new Set(["token", "tokens", "top", "base", "red", "blue", "green", "yellow", "purple", "orange", "pink", "black", "white", "grey", "gray", "brown", "cyan", "teal", "gold", "silver"]);

const words = (s) => String(s ?? "").normalize("NFKD").replace(/\.[a-z0-9]{3,4}$/i, "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
const seqAt = (hay, needle, from) => { for (let i = from; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return i; return -1; };

/** Чистая: очки файла/записи каталога для одного имени: 4 — имя целиком (варианты не в счёт), 3 — с начала, 2 — как слова внутри, 1 — подстрока, 0 — нет. */
export function scoreName(file, name) {
  if (/[Ѐ-ӿ]/.test(String(name ?? ""))) return 0;   // русское имя: после отбрасывания кириллицы остаются обрывки («Cкелет» с латинской C → «c» = «C1» у гоблина)
  const n = words(name).filter((w) => w.length >= 3), f = words(file);
  if (!n.length || !f.length) return 0;
  const core = f.filter((w) => !VARIANT.has(w));
  if (core.length === n.length && n.every((w, i) => core[i] === w)) return 4;
  const at = seqAt(f, n, 0);
  if (at === 0) return 3;
  if (at > 0) return 2;
  return f.join("").includes(n.join("")) ? 1 : 0;
}

/** Чистая: лучший файл из списка по списку имён (первое имя важнее; при равенстве — короче имя файла). null — если ничего не совпало. */
export function bestMatch(files, names, key = (x) => x) {
  let best = null;
  for (const f of files) {
    const base = String(key(f)).split("/").pop();
    for (let i = 0; i < names.length; i++) {
      const s = scoreName(base, names[i]);
      if (s < 2) continue;   // подстрока внутри слова — не совпадение («imp» в «simple»)
      const cand = { f, s, i, len: base.length };
      if (!best || s > best.s || (s === best.s && (i < best.i || (i === best.i && cand.len < best.len)))) best = cand;
      break;
    }
  }
  return best?.f ?? null;
}

/** Имена существа для поиска: английское оригинальное (babele), имя прототипа токена, slug (дефисы -> пробелы), без повторов. */
export function creatureNames(actor) {
  const raw = [actor?.flags?.babele?.originalName, actor?.prototypeToken?.name, String(actor?.slug ?? actor?.system?.slug ?? "").replace(/-/g, " "), actor?._source?.name];
  return [...new Set(raw.map((s) => String(s ?? "").trim()).filter((s) => words(s).length))];
}

const nexusState = () => {
  const m = game.modules.get("fa-nexus");
  if (!m?.active) return "no-nexus";
  return String(m.version).split(".").slice(0, 2).join(".") === EXTERNAL.verified["fa-nexus"] ? "ok" : "unverified";
};
const dirOf = () => { try { return game.settings.get("fa-nexus", EXTERNAL.nexus.dirSetting) || EXTERNAL.nexus.dirDefault; } catch { return EXTERNAL.nexus.dirDefault; } };
const settingOn = (key) => { try { return !!game.settings.get(MOD, key); } catch { return false; } };

async function browseAll(dir, depth = 3) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const out = [];
  const walk = async (d, left) => {
    const res = await FP.browse("data", d);
    out.push(...(res.files ?? []).filter((p) => IMG.test(p)));
    if (left > 0) for (const sub of res.dirs ?? []) await walk(sub, left - 1);
  };
  await walk(dir, depth);
  return out;
}

let files = null;   // скачанные файлы Nexus за сессию
const localFiles = async () => (files ??= await browseAll(dirOf()).catch(() => []));

// ponytail: только free — премиум требует OAuth-state Nexus (приватный), модуль его не читает; добавить, если у Nexus появится публичный API
let synced = false;   // каталог ассетов пуст до svc.sync("assets"): один раз за сессию
async function openCatalog(kind = "tokens") {
  const base = `modules/fa-nexus/scripts/content`;
  const { NexusContentService } = await import(foundry.utils.getRoute(`${base}/nexus-content-service.js`));
  const { NexusDownloadManager } = await import(foundry.utils.getRoute(`${base}/nexus-download-manager.js`));
  const svc = new NexusContentService();
  if (kind === "assets" && !synced) { await svc.sync("assets"); synced = true; }
  return {
    list: async (text) => (await svc.list(kind, { text, tier: "free" })).items ?? [],
    any: async () => ((await svc.list(kind, { tier: "free", limit: 1 })).items ?? []).length > 0,
    download: async (item) => (await new NexusDownloadManager().ensureLocal(kind, item, await svc.getFullURL(kind, item), { forceDownload: true })) || null,
    thumb: (item) => svc.getThumbnailURL(kind, item),
    close: () => { try { svc.destroy(); } catch { /* noop */ } },
  };
}

const defaultEnv = () => ({ enabled: (key) => !key || settingOn(key), state: nexusState, local: localFiles, openCatalog, forget: () => { files = null; } });

// stop-слова: «Dragon_Skeleton» — не «Dragon»; файл с таким словом годится, только если оно есть в одном из имён
const STOP = new Set(["skeleton", "skeletal", "spirit", "zombie", "ghost"]);
const stopOk = (file, names) => !words(String(file).split("/").pop()).some((w) => STOP.has(w) && !names.some((n) => words(n).includes(w)));

/** Чистая: масштаб токена из имени файла Nexus (`..._Scale130_...` -> 1.3, не больше 3); нет — 1. */
export const scaleOf = (file) => { const m = /_Scale(\d{2,3})(?=[_.])/i.exec(String(file ?? "")); return m ? Math.min(3, Number(m[1]) / 100) : 1; };

/** Чистая: лучший файл из списка, подходящий по любому из имён; стоп-слова отсеяны, файлам из `/Creatures/` — предпочтение. */
export function pickFile(list, names, key = (x) => x) {
  const ok = list.filter((x) => stopOk(key(x), names));
  return bestMatch(ok.filter((x) => /(^|\/)Creatures\//i.test(key(x))), names, key) ?? bestMatch(ok, names, key);
}

const downloads = new Map();   // путь записи каталога -> Promise локального пути (один файл не качается дважды)

/**
 * Файл токена по списку имён (по убыванию предпочтения): сначала скачанные, затем бесплатный каталог Nexus.
 * -> { src, scale } | { reason } где reason: disabled | no-nexus | unverified | catalog-empty | offline | not-found.
 * opts: download (по умолчанию true; false — только локальные, тогда нет файла = not-found), setting (ключ мировой настройки-выключателя, по умолчанию "formTokens"; null — без проверки),
 * env — подмена окружения для тестов. Сбой подбора никогда не бросает исключение. Зовёт активный ГМ.
 */
export async function findToken(names, { download = true, setting = "formTokens", env = defaultEnv() } = {}) {
  try {
    if (!game.user?.isGM || !env.enabled(setting)) return { reason: "disabled" };
    const state = env.state();
    if (state !== "ok") return { reason: state };
    names = [...new Set((names ?? []).filter((n) => words(n).length))];
    if (!names.length) return { reason: "not-found" };
    const done = (src) => ({ src, scale: scaleOf(src) });
    const hit = pickFile(await env.local(), names);
    if (hit) return done(hit);
    if (!download) return { reason: "not-found" };
    const cat = await env.openCatalog();
    try {
      let item = null;
      for (const n of names) {
        const text = words(n).sort((a, b) => b.length - a.length)[0];
        if (!text || /[Ѐ-ӿ]/.test(n)) continue;
        item = pickFile(await cat.list(text), names, catKey);
        if (item) break;
      }
      if (!item) return { reason: (await cat.any()) ? "not-found" : "catalog-empty" };
      const id = catKey(item);
      const got = await queue(`form-token:download:${id}`, () => {
        if (!downloads.has(id)) downloads.set(id, cat.download(item).catch((e) => { downloads.delete(id); throw e; }));
        return downloads.get(id);
      });
      if (!got) return { reason: "offline" };
      env.forget();   // скачан новый файл — список заново при следующем подборе
      return done(got);
    } finally { cat.close(); }
  } catch (e) { debug("findToken", e); return { reason: "offline" }; }
}

/** Ключ записи каталога FA: у Nexus 0.6 полей filename/file_path нет — путь без расширения лежит в id («Creatures/Beast/Mammals/Ape_A1_…_01»). */
export const catKey = (x) => String(x?.filename ?? x?.file_path ?? x?.id ?? "");

/** Превью бесплатного каталога для окна выбора формы (без скачивания): имена -> [{ name, file, thumb }] только найденные; любой сбой — []. Зовёт активный ГМ. */
export async function catalogThumbs(names, { setting = "formTokens", env = defaultEnv() } = {}) {
  try {
    if (!game.user?.isGM || !env.enabled(setting) || env.state() !== "ok") return [];
    const cat = await env.openCatalog(), out = [];
    try {
      for (const name of names) {
        const text = words(name).sort((a, b) => b.length - a.length)[0];
        const item = text ? pickFile(await cat.list(text), [name], catKey) : null;
        if (item) out.push({ name, file: catKey(item).split("/").pop(), thumb: cat.thumb(item) });
      }
    } finally { cat.close(); }
    return out;
  } catch (e) { debug("catalogThumbs", e); return []; }
}

/** Портреты для окна выбора: [{ names }] -> [путь|null] — только уже скачанные файлы Nexus (без сети); тот же подбор, что у токена на сцене. */
export async function nexusArt(entries) {
  try {
    if (!game.user?.isGM || nexusState() !== "ok") return entries.map(() => null);
    const have = await localFiles();
    return entries.map((e) => (e.names?.length ? bestMatch(have, e.names) : null));
  } catch (e) { debug("nexusArt", e); return entries.map(() => null); }
}

/** Путь к файлу токена из Nexus для существа или null (любой сбой — null). Зовёт активный ГМ. Призыв: скачивание — настройка nexusTokens. */
export async function nexusToken(actor) {
  const r = await findToken(creatureNames(actor), { download: settingOn("nexusTokens"), setting: null });
  return r.src ?? null;
}

export function init() {
  game.settings.register(MOD, "nexusTokens", { name: "PF2E_AUTOMATO.nexus.name", hint: "PF2E_AUTOMATO.nexus.hint", scope: "world", config: true, type: Boolean, default: false });
}
