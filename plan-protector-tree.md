# План: Древо-защитник (protector-tree), Тимбер-страж (timber-sentinel) и Сон без падения ничком

Редакция 2 (по замечаниям Критика). Источники: `tools/out/items.json` (protector-tree K9gI08enGtmih5X1: ранг 1, 2 действия, 30 фт, 1 минута, +10 ПЗ за ранг), `pf2e.mjs` 8.7.0 (grep по `interpos`/`protector-tree`: 0, pf2e это не делает), код модуля по ссылкам. Кода нет.

## Решения Руководителя (приняты)
Масштаб кроны scale 2; два дерева рядом — принимает ОДНО, с большим остатком ПЗ; актёр `hazard`, ПЗ в токене, имя токена = `item.name`; 6 ассетов Nexus с весами как есть; `NexusDownloadManager.ensureLocal` сам ищет файл на диске и качает только при отсутствии, даже с `forceDownload` — своего кэша файлов не делаем.

## Часть 1. Дерево

### 1.1 Размещение — через `scripts/summon.mjs`, вариант `object`
Каркас готов: кнопка (`summon.mjs:397 bind`), `pickPoint`/`placementPreview` (299/277), `callGM("summonCreate")` → `create()` (120): `placeAt`, `distanceFt`, срок `until`, флаг `flags[MOD].summoned`, `cleanup()` (232).

**Данные — без новых файлов и загрузчиков.** Расширить валидатор `onUse.summon` (`rules.mjs:587-591`; сейчас обязателен ровно один из `traits`/`uuid`) полем `object: { hp:{base,perRank,fromRank}, ac, guard:{on:"strike",adjacent,side:"allies"}, art:{kind:"assets",entries:[{id,rare?}]}, range, duration, single }`; `object` взаимоисключимо с `traits`/`uuid`, нормализация в `out.summon` (591). Читает его уже существующий `summonEntry` (`rules.mjs:2096`, `rule.onUse.summon`). Записи в `rules/catalog.json` для:
- `protector-tree` (uuid spells-srd K9gI08enGtmih5X1): `hp {10,10,1}`, `ac 10`, guard, art (6 ассетов; 5 равных, редкий `Feywilds/.../Tree_Multicolor2_A1_6x6` с `rare:0.05`), `single:false`;
- `timber-sentinel` (feats-srd aHlcMMNQ85VLK7QT, импульс кинетика): ранг = ceil(level/2) (в `object.rankFrom:"halfLevel"`), `range:30`, `duration:{value:1,unit:"minutes"}` (у черты duration/range нет — `durationOf` 117 и `itemRange` вернут null, поэтому берутся из `object`), `single:true` — «одно дерево на автора»: новое размещение удаляет прежнее дерево этой записи у того же автора (по `summoned.by` + `summoned.src`), как «any previous one ends». ПЗ = 10×ранг (тот же ПЗ-закон: base 10, perRank 10, fromRank 1).
Формат `catalog.json` — одна запись в строку: править `Edit`'ом по строке, не пересохранять через `JSON.stringify`.

Изменения `summon.mjs` (минимум):
- `ctxOf` (74-79): ранг = `castRank`, у импульса — по `object.rankFrom`; `durationOf`/дальность — из `spec.object` при отсутствии у предмета (`create` 138-140; `onClick` 386).
- `create()` ветка `object`: пропустить `candidatesFor/pickAllowed/importActor/limitProblem("nested")`; мировой актёр `hazard` один на ключ (по образцу `importActor` 103, `summonSource:"object:<slug>"`, папка `actorFolder`); `td = getTokenDocument({disposition: как у автора, actorLink:false})`; ПЗ через `delta.system.attributes.hp {value,max}`; `sort` низкий (крона не накрывает токены); флаг `summoned = {kind:"object", src:<uuid записи>, by, until, guard:{...spec.guard, alliance: author.alliance}}`. Если у автора `alliance` null — размещать можно, перехвата не будет (п. 1.3), предупредить при размещении.
- `settle()` (153): объекту не создавать эффект `summoned/minion` (156-164), `nexusSwap` заменить на `artSwap` (1.2); якоря нет.
- `LIMIT`: `minionsOf` (66) считает только `kind!=="object"`.
- `maybeBanish` (224): для объекта токен НЕ удаляется и «banished» не шлётся. Павшее дерево = `hp ≤ 0` без отдельной метки; в тех же хуках `updateActor/updateToken` (423-424) токен скрывается при ≤0 и показывается при >0 (откат урона по дереву его вернёт). Окончательное удаление — по сроку/`cleanup`/новому размещению `single`. Шёпот `summon.felled` («{name} повалено») при переходе в ≤0.
- Кнопка: «Разместить: {item.name}», `chooseDialog` пропустить, `qty=1`, призрак — иконка w=h=1. Одна кнопка, §3.2.
- Жизненный цикл: срок/0 ПЗ — токен убирается (мнение Руководителя); «остаётся обычным деревом в почве» — решение ГМа, строка-напоминание в шёпоте автору.
- Подводные камни: проверить живьём, что цели области (`saves.mjs:138`) и выбор целей не захватывают токен `hazard`; не в бою; `ownership default 0` (ПЗ меняет только ГМ).

### 1.2 Картинка Nexus (kind `"assets"`) — `scripts/nexus-tokens.mjs`
- `openCatalog(kind="tokens")` (72): kind во всех вызовах, `tier:"free"`; `svc.sync("assets")` один раз за сессию (флаг на модуле).
- Поиск записи — по имени файла (`Tree_Green_A1_6x6`) текстом `list("assets",{text})`, затем `catKey(item) === id` (143); НЕ по последнему слову id.
- Чистые: `pickWeighted(entries, rnd)` (`rare` — шанс, остальные поровну: 5 по 19%), `assetScaleOf(id)` (по `_NxN`: 6x6 → **2**; другие размеры N/3 с минимумом 1, 3x3 → 1).
- `findAsset(entries, {env, rnd})` → `{src, scale}`|`{reason}`; скачивание `ensureLocal("assets", item, getFullURL("assets", item), {forceDownload:true})` без собственного кэша файлов (мемо `downloads` 101 остаётся лишь как защита от параллельного двойного вызова за один тик; ключ с kind). Любой сбой → `{reason}`, исключений наружу нет.
- Гейт: настройка `nexusTokens`; выключено/нет Nexus/офлайн → иконка `icons/svg/tree.svg`. Только free; `patreon_auth_data` не читаем и не храним.
- `artSwap(token, art)` в `summon.mjs`: `update({"texture.src", "texture.scaleX/Y"})`, ошибки — `console.warn`.

### 1.3 Перехват урона Удара — новый `scripts/builtin/guard.mjs`
Опора: `apply-hook.mjs:22 wrap`, образец — `damage-link.mjs:96 intercept`. В `opts`: `item` (= `message.item`), `rollOptions`, `token`, `outcome`, `damage`.

**Что перехватывается.** `opts.item.type ∈ {weapon, melee}` (бомбы в pf2e — weapon), без `item:type:spell`; effect/condition/affliction (продолжительный урон, ловушки) нет. Только попадание: `opts.outcome ∈ {success, criticalSuccess}`; `outcome == null` (урон без броска атаки) считать попаданием. Лечение/`final`/`skipIWR`/опция `af:guard` — не трогать. Ограничение: брызги бомбы по соседям (splash) тоже идут как weapon-урон — не отличаем, фиксируем в `docs/wiki/limitations.md`.

**Кого прикрывает.** Только союзников заклинателя, но не его самого (в pf2e `isAllyOf` исключает `this`, `pf2e.mjs:32836`; в модуле `alliesIn(..., withSelf=false)`, `apply.mjs:378`): `target.actor.alliance === guard.alliance` и `target.actor.uuid !== by`. `guard.alliance == null` → перехвата нет. Цель = само дерево — нет.

**Алгоритм.** Клиент: быстрый выход, если на сцене цели нет токенов с `summoned.guard`. Иначе `await callGM("guardTake", targetTokenUuid, total, rollOptionsInfo)`; право вызова — владелец токена цели или ГМ (проверка в обработчике). ГМ под очередью **одного ключа `"guard"`** (дерево — общий ресурс, не привязано к цели): отбор деревьев (та же сцена, живое hp>0, `distanceFt(rect(tree), rect(target)) ≤ adjacent`, союзность выше), **выбор одного** — большой остаток ПЗ, при равенстве меньший id; считает `absorbed = min(total, hp)`; **наносит дереву штатно: `tree.actor.applyDamage({damage: absorbed, token, final:true, rollOptions:new Set(["af:guard"])})`** — у дерева появляется собственное сообщение «damage-taken» и штатный откат pf2e (кнопку отката видит ГМ — ограничение в `limitations.md`). Возвращает `{absorbed, treeName, left}`. Клиент вычитает `absorbed` из урона ПО ЭКЗЕМПЛЯРАМ (1.4) и шлёт шёпот (`card()`). Нет ГМа — `callGM` сам предупреждает (`util.mjs:69`), перехвата нет.
**Откат.** Метки `af:guard:<id>:<n>`, хук `updateChatMessage`, флаг `fallen`, строка `restored` — убраны. Если дерево приняло ВСЁ, у цели `appliedDamage:null`/`canUndoDamage:false` (`pf2e.mjs:33339-33372`) и откат у неё не нужен; ПЗ дерева возвращаются откатом на сообщении дерева. Если часть ушла в цель — откат цели возвращает цели, откат дерева — дереву (две кнопки, ограничение).

**Порядок подписчиков.** Дерево «первым»: подписчик регистрируется до `shieldBlock.wrapApplyDamage` (`index.mjs:137`; там живёт `damageLink.intercept`), `damaged.onApply` остаётся первым. **Блок щитом:** когда дерево покрывает весь урон, не предлагать подсказку «Блок» и не списывать реакцию (`shield-block.mjs:136`): `guard` при `absorbed==total` отмечает урон так, чтобы `blockHappened` (`shield-block.mjs:220`) ложился на `damage:0` — тест на этот случай.

**Без двойного нанесения (§3.5).** Все пути (кнопка pf2e, Toolbelt, `basic-damage`, Блок щитом) идут через `applyDamage` → единственный перехват; метки `markDamageApplied`/`shieldBlock.done` не затронуты; повторный вход `PASS` (`apply-hook.mjs:20`) подписчиков не повторяет. `modeOf("macro")==="off"` — как у связи жизни.
**Сопротивления/слабости.** Дерево — объект без IWR: снимается номинальный бросок как есть; цель получает остаток через свой IWR (экземпляры сохраняются, 1.4).

### 1.4 Общий помощник «вычесть N из урона по экземплярам» (группа §4.4 — три места)
Изъян: `d.alter(1,-n)` вычитает добавку только из ПЕРВОГО экземпляра (`pf2e.mjs:1389-1404`), а `applyIWR` поднимает каждый экземпляр до 0 (32178): при «режущий + огонь от руны», когда дерево/связь съела всё, огонь всё равно идёт на цель (двойной урон); если первый экземпляр продолжительный (`total` 0, 1468) — вычитание пропадает. Затронуты **три места**: `damage-link.mjs:115` (`d.alter(1,-sum)`), `damaged.mjs:185 cutDamage` (применяется `damaged.mjs:437`), новый `guard.mjs`.
Решение: один чистый помощник `subtractDamage(d, n)` (новый `scripts/builtin/damage-math.mjs`): число → `d - n`; `DamageRoll` → пересобрать с фиксированными суммами по экземплярам (непродолжительные экземпляры уменьшаются по очереди слева направо, каждый не ниже 0, продолжительные и «только бонус» не уменьшаются и не поглощают; остаток n сверх обычного урона отбрасывается), сохраняя типы, категории, материалы, критическую пометку (`options`/`degreeOfSuccess`), чтобы `applyIWR` видел те же экземпляры. Возвращает новый объект в формате, который принимает `applyDamage`. Реализация пересборки (через `DamageRoll.fromData`/`instance.total` + `Roll` терм) — проверить живьём в первую очередь: это самое хрупкое место. Три потребителя переводятся на помощник; `cutDamage` остаётся тонкой обёрткой.
Тесты юнит (`tests/damage-math.test.mjs`, на псевдо-экземплярах без Foundry — помощник принимает массив `{type,total,persistent}` и возвращает массив; обёртка над `DamageRoll` вне чистой части): многотиповой урон (режущий 5 + огонь 3, вычесть 5 → режущий 0, огонь 3; вычесть 7 → 0 и 1; вычесть 8 → 0 и 0); продолжительный первый экземпляр (persistent 0-сумма + обычный: вычитается из обычного); n ≥ total; n = 0; число. Регрессии в `tests/damage-link*`/`damaged` на тот же сценарий; живой пункт: «режущий+огонь от руны» через кнопку pf2e с деревом.

### 1.5 Группа А (§1.4 CLAUDE.md): «объект/существо принимает урон Удара вместо соседа»
Скрипт по `items.json`: 78 попаданий регулярки → ≈28 реальных, четыре вида:
| Вид | Состав | План |
|---|---|---|
| А. Пассивный созданный объект забирает урон Удара у соседа | protector-tree (spell), **timber-sentinel (feat, импульс «as a Protector Tree spell of rank half level, одно дерево, прежнее заканчивается»)** | оба данными `onUse.summon.object` + общий движок `guard.mjs` |
| А'. Страж на силе | spiritual-guardian (jQdm301h6e8hIY4U): 120 фт, поддерживаемое, перемещается/атакует/«защищает» при Сотворении и Поддержании, 50 ПЗ, теряются только при защите | ДОЛГ: не ложится на пассивный `guard` (ход по Поддержанию, выбор «атака или защита», защита конкретного существа, ПЗ только от защиты) — нужен отдельный механизм поверх `sustain.mjs` |
| Б. Реакция «урон вместо союзника на себя» | protectors-sacrifice, willing-death, intercept-attack + производные, interposition, human-shield, speakers-privilege, vitality-transfer, vehicle-block (≈11) | НЕТ: `damaged.mjs` (`onDamaged.redirect`), записей каталога нет; `applyHp` с `skipIWR` не соответствует «ИСС защитника» Intercept Attack |
| В. Блок щитом за соседа | shield-warden (×4), lastwall-warden, mounted-shield, cenotaph-stance, shield-block (NPC) (≈8) | НЕТ: `shield-block.mjs` |
| Г. Перенаправление атаки на заслоняющего | mothers-mindfulness, pupils-guard, defend-mount, protectors-interdiction, divine-guardian, stygian-guardian, sheltered-command, for-you-mistress, gods-intervention (≈9) | НЕТ: меняется цель до броска |
Ложные срабатывания (≈50: shattershields, prismatic-shield, torch-goblin…) отброшены. Помощник 1.4 исправляет изъян у всей группы «вычитание из урона» (связь жизни, реакции `damaged`, дерево).

### 1.6 Строки (lang ru/en)
`summon.placeObject`, `summon.felled`, `builtin.guard.card` («{tree} принимает {n} урона вместо {name}; осталось {left} ПЗ»), поле `object` в `lang/*/rules.json` (подпись валидатора), `card.guard` в `common.json`. Строки `noGM`, `restored` не нужны. Названия — `item.name`/`token.name`.

### 1.7 Тесты
Юнит: `tests/nexus-assets.test.mjs` (`pickWeighted` границы/сумма/пусто, `assetScaleOf`, `findAsset` фейк-env: нет Nexus/офлайн/нет записи → `{reason}`), `tests/summon.test.mjs` (+`hpFor(rank)` 1→10, 3→30; `rankFrom:"halfLevel"`; `single` — прежнее удаляется; `minionsOf` без объектов), `tests/guard.test.mjs` (`isStrike`, `outcome` null/miss, `pickTree`: смежность, союзность, без заклинателя, `alliance` null, два дерева → одно с большим остатком, дерево=цель, 0 ПЗ; `absorb`; порядок подписчиков; Блок щитом при полном поглощении), валидатор `object` (в `tests/catalog*`), `tests/damage-math.test.mjs` (1.4).
Живой `tests/live/protector-tree.js` по образцу `tests/live/leave-reach.js`: копии «AF тест: …», своя сцена, всё удалить, «Тест» не трогать. Пункты: размещение (ранг 1 → 10 ПЗ/КБ 10; ранг 2 → 20); Тимбер-страж: ранг по половине уровня, второе размещение убирает первое; Удар 6 → дерево 4/10; 14 → дерево 0 (скрыто), цель −4; режущий+огонь (рунa) без двойного урона; заклинание/промах/несосед/враг/сам заклинатель — не перехватываются; два дерева → одно; Блок щитом при полном поглощении без подсказки; кнопка pf2e без двойного нанесения; откат на сообщении дерева возвращает ПЗ и показывает токен; срок 61 с → убрано; Nexus выкл → иконка; цели области не захватывают hazard. Только свои сообщения удалять (§4.2); живые прогоны по одному.

## Часть 2. Сон (`sleep`): без Prone при Unconscious ≤3 ранга
Факты: текст «doesn't fall Prone or release what it's holding»; 4 ранг — «fall prone» (в записи уже явный prone). pf2e: у Unconscious правило `GrantItem` Prone (`pf2e.mjs:47520-47550`, `allowDuplicate:false`, `grantee:"restrict"`).
Решение (без глобального хука `createItem`): флаг `standing:true` у шага `condition` (валидатор правил принять, подпись в `lang/*/rules.json`).
- Прямой путь без срока (`apply.mjs:160-166`): при `standing` отфильтровать из `data.system.rules` правило `GrantItem` с uuid Prone (`…j91X7x0XSomq8d60`) — Prone не выдаётся вообще.
- Путь со сроком (`createTimed`, Сон на самом деле идёт им): состояние создаёт pf2e из компендия через обёртку, правил не поправить. Тогда после `await createEmbeddedDocuments` в той же очереди `actor:` найти Prone с `grantedBy` = это Unconscious и снять: сначала `update(forcedDelete("flags.pf2e.grantedBy"))`, затем `delete` (обычное удаление при `restrict` pf2e отменяет, `pf2e.mjs:45500`). Уже лежавший Prone не трогать (`allowDuplicate:false` → новый не выдаётся, `grantedBy` не наш). Если выданный Prone приходит позже `await` — поллинг до 1 с или одноразовый `createItem` на этого актёра, снимаемый после срабатывания (не глобальный хук).
- Записи: у Сна ДВЕ записи в `rules/catalog.pa.json` — по uuid (стр. 59) и по slug (стр. 571). Проверить, какая побеждает в `resolveRule`; `standing` вписать в обе (шаги ранга ≤3: failure и criticalFailure).
Группа «Unconscious без падения»: sleep (≤3 ранга), sleeper-hold (feat), sedation (NPC pfs-season-4-bestiary); записей у двух последних нет — флаг для них готов, записи отдельной задачей. Другие «не падает» (whirling-throw, hurling-toss, arcane-explosion, killing-shake) — иной механизм. Пробуждение Восприятием — вручную.
Тесты: юнит — фильтр GrantItem Prone в данных; выбор Prone-на-снятие по `grantedBy`; живой `tests/live/sleep-standing.js`: ранг 3 провал → Unconscious без Prone; ранг 4 → оба; уже лежал → Prone остаётся; снятие по сроку чисто; обе записи каталога.

## Разбиение на куски (≤3, файлы не пересекаются)
- **Кусок А (объект, арт, Сон-данные валидатора)**: `scripts/summon.mjs`, `scripts/nexus-tokens.mjs`, `scripts/rules.mjs` (валидатор `onUse.summon.object` и поле `standing`), `rules/catalog.json` (protector-tree, timber-sentinel), `lang/*/rules.json`, lang `summon.*`, `tests/nexus-assets.test.mjs`, `tests/summon.test.mjs`, тесты валидатора. Контракт для Б: `token.flags[MOD].summoned = {kind:"object", src, by, until, guard:{on,adjacent,side,alliance}}`; экспорт `distanceFt`, `rectCell`.
- **Кусок Б (урон: помощник + перехват)**: новые `scripts/builtin/damage-math.mjs`, `scripts/builtin/guard.mjs`; правки `scripts/builtin/damage-link.mjs`, `scripts/builtin/damaged.mjs`, `scripts/builtin/shield-block.mjs` (блок при полном поглощении), `scripts/builtin/index.mjs`, `scripts/main.mjs` (`guardTake`), `lang/*/builtin.json`, `lang/*/common.json`, `docs/wiki/limitations.md`, `tests/damage-math.test.mjs`, `tests/guard.test.mjs`, регрессии `tests/damage-link*.test.mjs`/`tests/damaged*.test.mjs`, `tests/live/protector-tree.js` (живой — после А).
- **Кусок В (Сон)**: `scripts/apply.mjs`, `rules/catalog.pa.json`, `tests/live/sleep-standing.js`, юнит (`tests/catalog.pa.test.mjs` или новый). `rules.mjs` не править (валидатор `standing` — у А).
Порядок: А и В параллельно, Б параллельно по контракту; живые прогоны строго по одному после влития.

## Открытые вопросы
1. Пересборка `DamageRoll` с фиксированными суммами по экземплярам (1.4) — единственное технически хрупкое место; если `DamageRoll.fromData`/копия экземпляров ведёт себя иначе, запасной вариант — уменьшать `instance.term`-ы по очереди. Нужен живой прогон до всего остального. Рекомендация: Кусок Б начинает с него.
2. Откат: две кнопки (цель и дерево, если урон разделился) — принять как ограничение.
3. spiritual-guardian — долг (механизм поверх Поддержания), не в этом плане.
