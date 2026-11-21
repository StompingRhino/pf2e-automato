# План пачки 3 (ROADMAP §5): проверки и атаки автора против защиты цели

Только план, код не тронут. Снимок: pf2e 8.6.1 (`tools/out/items.json`, `tools/out/triage.json` от 2026-10-27 — статусы чуть устарели, перекрыты проверкой по каталогам `rules/catalog*.json` на сегодня). Рядом лежит `plan-batch3.md` — это про конвейерный проход Sonnet по документам b03 (сделан, ~30%); здесь — рантайм и пробелы кода. Скрипты подсчёта — scratchpad `b3/` (scan.mjs, t6–t17).

## 1. Группа и числа
Регулярка по `descEn` без `dupTop`, уникальные по тексту: `@Check[<не спасбросок>|against|defense:…]`, текст «check … against the target's <защита> DC», `[[/act <манёвр>]]`, трейт `attack` у заклинания со степенями. ±10%, подвиды пересекаются.

Всего **869 уник. документов**: 341 верхнего уровня (action 59, feat 214, spell 36, прочее ~32) + 528 способностей NPC (по slug ≈ 312). Покрытие (каталоги): верх — 73 покрыто, 106 skip (passive/no-trace/damage-only), 54 долг, 108 открыто; NPC — 10 покрыто, 83 skip, **219 открыто** (это пачка 9: NPC-дедуп, здесь не берём).

| Подвид | Док. (верх / NPC) | Состояние | Кодируется существующими полями? |
|---|---|---|---|
| A. Базовые действия с проверкой против защиты: Feint, Demoralize, Disarm, Trip, Shove, Grapple, Reposition, Tumble Through, Create a Diversion, Bon Mot, Escape, Command an Animal, Dirty Trick (+Aid, Treat Wounds, Battle Medicine с фикс. СЛ) | 16 записей `bySlug` | покрыто (`rules/catalog.json:183-200`); есть условные шаги по `feat:`/`feature:` (Overextending Feint, Пройдоха) | да; но Shove/Reposition/Trip/Escape — заметки «вручную» (§3.2) |
| B. Требования действий (свободная рука, размер цели ≤ +1, досягаемость) | 6 действий (Grapple, Trip, Shove, Disarm, Reposition — рука+размер; Feint — ближняя досягаемость) | **не реализовано**; pf2e не проверяет | нужен гейт (§3.1), не поле |
| C. Черты/предметы, меняющие базовое действие (`/act` в тексте с правкой): | 111 / 193 | | |
|  C1 подмена навыка («Thievery вместо Athletics»: Sly Disarm, Twirl Through, Versatile Performance, Tap into Blood, Frighten Undead, Pistol Phenom…) | ~16 | модуль читает бросок pf2e, статистика не важна — **уже работает** (`/act disarm statistic=thievery`) | да, правило не нужно |
|  C2 доп. шаг по исходу, зависящий от черты (Goading Feint, Sly Disarm, Unrelenting Terror, Constant Feint Stance) | ~8 | не покрыто | `when:feat:` в записях A + (для Sly Disarm) опции броска в `when` (§3.3) |
|  C3 «манёвр + Удар» (Twirling Strike, Stay Here!, Slam Down, Shackles of Law, Distracting Spellstrike…) | ~20 | долг `strike-gate` (17 в словаре, «к проходу») | другая пачка |
|  C4 бонус/штраф к СЛ или проверке (Daredevil Boots, Birchstaff, Chimera's Claw) | ~14 | долг `mods-action`/`mods-target` | нет, долг (<30) |
|  C5 бесплатный/реактивный запуск (Battle Cry, Tip the Scales) | ~6 | `event-trigger` | другая пачка |
| D. Свой бросок автора против защиты с исходами (Grim Swagger, Disturbing Knowledge, Log Roll…) | 168 / 317 текстов | верх: 25 покрыто (`catalog.model/pa/json`), 29 skip, 108 manual/low; в долге 54 (check-auto-unless 7, strike-gate 5, impulse-attack 5, condition-link 5, mode-choice 4…) | да (`check`: `vs`, `byDegree`, `immunity`, `when`, `oneRoll`, `roll:"system"`) — остаток — модельный проход |
| E. Атака заклинанием/импульсом со степенями | 30 / 15 (+66/16 «только урон») | заклинаний-записей `spell-attack` в каталогах 21; из 30 без записи 16 skip (урон), открыто ~6 (Warshard Shot, Withering Grasp, Call of the Grave, Silver Spear, Charged Javelin) | да; импульс/deviant — `CHECK_STATS` в `tools/validate.mjs:26` (долг 6) |
| F. Hide, Sneak, Seek, Steal, Impersonate, Lie, Coerce, Make an Impression | refs 12/9/26/7/… | нет записей | Hide/Sneak/Seek — видимость (pf2e-vision), СЛ вторичны; остальное — сюжетное, не автоматизируем (память «narrative-not-automated») |

Вывод: **нового примитива не требуется** (порог ROADMAP §7 — группа от ~30 док.; ни один подвид с новым механизмом не набирает: C2 ~8, C4 14, impulse 6, check-auto-unless 7). Нужны три малых куска кода (B, опции броска в `when`, `impulse`) и правки данных.

## 2. Что делает pf2e (§1.3)
- `game.pf2e.actions` (`pf2e.mjs:116700`): ~50 макросов; `SingleCheckAction.use({actors,target,statistic,multipleAttackPenalty})`. Feint/Demoralize/Bon Mot/Trip… бросают **только** проверку против DC цели (`difficultyClass`: perception 9, will 4, fortitude 3, reflex 3) и добавляют **текстовые заметки** по степеням (`extraNotes`, `PF2E.Actions.<X>.Notes`). Ни состояний, ни иммунитета, ни эффектов pf2e не ставит. Для Demoralize есть опция `action:demoralize:unintelligible` (−4).
- Требования не проверяются: в lang есть только `ActionsWarning.NoActor/NoStatistic`, `Craft/Repair.Warning.*` — ни свободной руки, ни размера, ни досягаемости у Trip/Grapple/Shove/Disarm/Reposition/Feint (`grep` по `pf2e.mjs`). Роль руки есть как данные: `actor.handsFree` (`pf2e.mjs:35300`), опция `hands-free:N`, трейты оружия trip/shove/disarm/grapple («даже без свободной руки, использует досягаемость оружия» — `TraitDescription*`).
- Инлайн `@Check[athletics|defense:reflex]` pf2e сам считает против цели; `[[/act shove statistic=spell-attack]]` поддержан.

## 3. Что делает модуль и предложение
`scripts/actions.mjs onRollMessage` принимает бросок pf2e с `action:<slug>` (`ruleFor`) и применяет `onUse.check.byDegree` (шаги, иммунитет, `when`); карточный путь — `checks.rollCheck`. Телекинетический манёвр (M5) — `builtin/maneuver.mjs`, переиспользуется как есть.

### 3.1. Гейт требований манёвров (новое, подвид B; K2)
`scripts/builtin/maneuver-gate.mjs` по образцу `melee-reach.mjs` (обёртка `game.pf2e.Check.roll`, Alt — обход, `unchecked()`), **режим `modeOf("limits")`** (как `melee-reach.mjs:50`), не `macro`. Группа действий (§1.4): Grapple, Trip, Shove, Disarm, Reposition (рука + размер + досягаемость), Feint и Dirty Trick (рука/ближняя досягаемость; Dirty Trick — по его `descEn`), Demoralize и Bon Mot («within 30 feet»). Правила — из `descEn` Requirements, не по памяти.

**Что ловим.** Только «голое» базовое действие: опция `action:<slug>` и `context.item` либо нет, либо это само действие. Если `context.item` — другой предмет (Slam Down, Distracting Toss, Wing Bounce…), бросок пропускаем (у такого предмета свои условия). Клик по `[data-pf2-action]`/`[[/act]]` внутри описания другого предмета — отдельный перехват на фазе capture, ставит `unchecked` на этот бросок (иначе действие из описания проверялось бы как голое). Признак атаки заклинанием — `"spell-attack"` в `context.domains` (не `check:statistic`): пропуск (Telekinetic Maneuver, Desperate Surge).

**Свои броски модуля — `unchecked`** (сценарий уже решил, что действие законно): `builtin/strike-effects.mjs` `perform()` (Improved Grab/Knockdown/Push, стр. 34), `builtin/maneuver.mjs`, карточки каталога с `options:["action:…"]` (`catalog.model.json` ~652/768/875, `catalog.rusthenge.json` ~35, `catalog.json` ~44 «Ты следующий»; точный список — grep `"action:` по `rules/catalog*.json`). Образец — `impulse-gate.unchecked`.

**Условия — как в pf2e.**
- Рука: `actor.handsFree` (`pf2e.mjs:35300`); щит им не считается (`pf2e.mjs:~35474`: `shield` исключён из подсчёта `free-hand`). Решение по щиту — по тексту правил, с цитатой из источника (Requirements «at least one free hand» в `descEn` действий; `TraitDescriptionFreeHand`): сверить формулировку до кода (вопрос 3); по умолчанию щит блок не снимает, Alt обходит.
- Исключение «без руки»: оружие манёвра — среди готовых Ударов `actor.system.actions` с нужной чертой (trip/shove/disarm/grapple; `pf2e.mjs:~18288`), включая безоружные Удары из правил. У Reposition такой черты нет — `{trait}` в сообщении не подставлять; Grapple/Reposition также без руки, если автор уже держит цель (Grabbed/Restrained).
- Досягаемость: своя — `attributes.reach.base`; с оружием манёвра — `getReach({action:"attack", weapon})` (`TraitDescription*`: «uses the weapon's reach»). Feint — «within melee reach» (descEn). Demoralize/Bon Mot — 30 фт (`range.mjs`).
- Размер: цель не больше актёра более чем на один размер (Grapple/Trip/Shove/Disarm/Reposition).

**Снятия требований — таблица по `feat:`/эффектам.** Скан `descEn` (регулярки, ±): снятие руки/её требования — ≈19 док. (Slam Down, Shackles of Law, Stay Here!, Sawtooth Grapple/Reaper, Tongue Tether, Mischievous Tail, Sleek Reposition, Topple the Titans, Staff Acrobat Dedication, Legs of Stone, Cheaters Always Prosper, Disarming Block, Armored Rebuff, Blade of the Rabbit Prince, Catching, Iron Cube, Constricting Whip Tail, Kraken's Guard); смягчения размера — ≈21 док. (Titan Wrestler, Disarming Stance, Bullying Staff, Skybearer's Belt, Deadweight Mutagen ×3, Powerful Shove, Titan's Grasp, Larger Than Life, Seize, Opportunistic Grapple, Wake to Strife, Ensnaring Wrappings, Unfurling Brocade, The Bigger They Are, The Harder They Fall, Guardian's Calling, Sand Snatcher, Ricocheting Leap). Цифры расходятся с оценкой Критика (~32/~10): моя регулярка шире по размеру и уже по руке; точный список составить в начале K2. Часть — собственные действия (`context.item`, пропуск выше), остальное пассив → таблица `{feat|effect slug → снимаемое условие}` в гейте (~15–20 строк); незнакомое — не блокируем.

**Форма (§1.1):** действия нет, предупреждение «что не так и что сделать», Alt обходит. Строки `lang/ru|en/builtin.json`: `builtin.maneuverGate.noHand` «{name}: нужна свободная рука. Освободите руку (или возьмите оружие с чертой «{trait}»). Alt — обойти.» (вариант с `{trait}` — только Trip/Shove/Disarm/Grapple; для Reposition без него); `.size` «{target} больше вас более чем на размер. Выберите цель поменьше. Alt — обойти.»; `.reach` «{target} вне досягаемости ({d} фт, у вас {r} фт). Подойдите ближе. Alt — обойти.»; `.range30` для Demoralize/Bon Mot. Названия действий — `PF2E.Actions.<X>.Title` (перевод pf2ru применён). Гексы/без сетки — не блокируем.

### 3.2. Базовые записи (данные, `rules/catalog.json`; K3)
- У каждой базовой записи **две копии** — `bySource` (~88–93) и `bySlug` (~183–188): править обе; тест в `tests/catalog.base.test.mjs`, что `onUse.check` копий совпадает.
- **Shove не меняем.** «Up to 10 feet»/толчок — выбор игрока, модуль его не знает (§1.5): заметка остаётся, шаг `move` не вводим. Запись `shove` общая со `strike-effects` (push-10/improved-push-20) — её смысл не трогаем.
- **Trip, крит. успех, `damage` 1d6:** шаг `damage` наносит урон сам (`apply.mjs` ~677); ссылку `@Damage` в заметке pf2e гасят `quench`/`dealtBy` (`damage-button.mjs` ~184/199) — только когда снимок уже лёг. Обязательна живая проверка: ссылка погашена, урон один; иначе оставить заметку.
- Reposition, Escape, Create a Diversion («+4 к СЛ Внимания») — заметки.
- C2 (`when:["feat:<slug>"]`, приём Overextending Feint, `choose`/`choice:`): Goading Feint (+ «Effect: Goading Feint» pf2e), Constant Feint Stance (NPC, bySlug). Unrelenting Terror — нужна условная длительность иммунитета (1–2 док.) → заметка. Sly Disarm — после K1.

### 3.3. Опции броска в `when` (K1, `actions.mjs` + `apply.mjs`)
Опции броска **в снимок не копируем**. В `whenOptions` (`apply.mjs:378`) при `use.kind==="roll"` читать `message.flags.pf2e.context.options` сообщения броска (`check:statistic:thievery`, `action:disarm`), без `target:*` (их добавляет сам `whenOptions`). Закрывает Sly Disarm и ~5 подобных. Проверить, что свой бросок (`checks.rollCheck`) даёт то же.

### 3.4. Импульс / deviant (подвид E, долг 6)
`tools/validate.mjs:26` `CHECK_STATS` + промпт: допустить `impulse` (pf2e: `actor.getStatistic("impulse")`, `pf2e.mjs:24275`) и `deviant`; `vCheck` (`rules.mjs:520`) уже принимает любой slug, бросок — `roll:"system"`. Перед включением живая проверка: что `parseActionRoll` находит slug для атаки импульсом (origin type action/feat). Ключ `impulse-attack` в `rules/mechanisms.json` получает примитив.

### 3.5. Прочее
- Триаж ошибочно относит часть «атака заклинанием + отталкивание по степени» к `skip: no-trace` (Hydraulic Push, Hurtling Stone, Torrent Spellgun): отдать на проход с `move`; поправить признак в `tools/triage.mjs` (regex «knocked back / push»), пересчитать группу.
- Модельный проход по открытым ~108 верхнего уровня (Sonnet, правило ROADMAP §9), в т.ч. из чужих пачек (b04: Grudging Compliment, Disarming Smile — навык против Will с реакцией). Много `null` (damage-only/attitude-only) — норма.
- Hide/Sneak/Seek/Steal — вопрос 1; Make an Impression/Request/Coerce/Lie — сюжетное, не автоматизируем.

## 4. Тесты
Юнит: `tests/maneuver-gate.test.mjs` — чистые `needHand/needSize/needReach` (рука 0/1/2, щит, готовый Удар с трейтом, безоружный из правил, схваченная цель, размеры, NPC без `hands`, `context.item` ≠ действию → пропуск, `domains` с `spell-attack`, таблица снятий, Alt/`unchecked`, Reposition без `{trait}`); `tests/actions.test.mjs` — `whenOptions` для `kind:"roll"` берёт опции сообщения без `target:*`; `tests/catalog.base.test.mjs` — `bySource` = `bySlug`, Trip `damage`, Goading Feint `choose`; тест валидатора `impulse`; round-trip формы.
Живые (копии «Тестовые копии (автоматизация)» в RustySpirit, затем убрать; `tests/live/maneuver-gate.js`, `tests/live/batch3-checks.js`, по одному): Feint, Demoralize (иммунитет 10 мин), Disarm/Trip (крит. урон: ссылка погашена, урон один)/Shove, гейт (нет руки, Huge, вне досягаемости, Alt), `[[/act]]` в описании Slam Down не блокируется, Improved Knockdown/Grab NPC не блокируются, Telekinetic Maneuver, Sly Disarm, атака заклинанием, импульс-атака. Чужое состояние мира не менять.

## 5. Куски (файлы не пересекаются; порядок)
| # | Кусок | Файлы | Размер | Порядок |
|---|---|---|---|---|
| K1 | Опции броска в `when` (3.3) | `scripts/actions.mjs`, `scripts/apply.mjs` (только `whenOptions`), `tests/actions.test.mjs` | S | 1, параллельно |
| K2 | Гейт (3.1) | новые `scripts/builtin/maneuver-gate.mjs`, `tests/maneuver-gate.test.mjs`, `tests/live/maneuver-gate.js`; `scripts/builtin/index.mjs`; `unchecked` в `builtin/strike-effects.mjs`, `builtin/maneuver.mjs`; `lang/ru|en/builtin.json` | L (2 дн.) | 1, параллельно |
| K3 | Данные базовых записей (3.2) | `rules/catalog.json` (обе копии), `tests/catalog.base.test.mjs` | M | 1; Sly Disarm — после K1 |
| K4 | Импульс/deviant (3.4) | `tools/validate.mjs`, `tools/prompts/draft-rule.md`, `rules/mechanisms.json`, тест | S | 1, параллельно (общие `tools/*` — сливать по одному) |
| K5 | Триаж + модельный проход открытых (3.5) | `tools/triage.mjs`, `rules/drafts-accepted/b03-*.json`, `rules/catalog.model.json` | M | после K1–K4 |
| K6 | Живой сценарий, выборка 50, Критик | `tests/live/batch3-checks.js`, `test-results.md` | M | последним |
Каталоги `catalog.model.json`/`catalog.rusthenge.json`/`catalog.json` (запись «Ты следующий») K2 только читает: их бросок опознаётся по сообщению/опции и пропускается через `unchecked`, правок данных нет. Параллельно 4 (K1–K4), ≈ 5–6 чел.-дней.

## 6. Открытые вопросы
1. Hide/Sneak/Seek — в пачку или pf2e-vision?
2. Блок или предупреждение при размере/досягаемости (план: блок на квадратной сетке, иначе пропуск).
3. Щит и «свободная рука»: подтвердить цитатой из `descEn`/Player Core до кода.
4. Кнопки вариантов навыка для черт-подмен (~16 док., ниже порога)?
5. 219 NPC-способностей — пачке 9?
6. Условная длительность иммунитета (1–2 док.)?
7. Даёт ли `[[/act trip]]` из текста черты те же опции `action:trip`, что и макрос (живьём; от этого зависят гейт и `ruleFor`).
