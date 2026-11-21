# План: пробелы автоматизации по героям RustySpirit

Статус: **только план, код не правился.** Источники: аудит (`audit-A.md`, `audit-B.md`, разделы «Пробелы»), `tools/out/audit-rustyspirit.json`, корпус `tools/out/items.json` (3474 заклинания, 41174 документа), pf2e 8.7.0 (`systems/pf2e/pf2e.mjs`, `lang/en.json`), код модуля на `master`.
Правила проекта (`CLAUDE.md`): ограничение = блок + предупреждение + обход Alt (§1.1); сначала что делает pf2e (§1.3); механизм на группу по признаку (§1.4); без переключателей для вычислимого (§1.5); строки через `lang/ru` + `lang/en`, названия с листа (§2); свои броски модуля не блокируются (§3.4); без двойного применения (§3.5); живой прогон на копиях, после прогона всё убрать (§4.1).
Чужая работа (не трогать, в план не входит): `scripts/apply.mjs`, `scripts/condition-hold.mjs`, `scripts/turn-conditions.mjs`, `tests/condition-hold*.test.mjs`, `tests/live/affliction-hold.js`, `plan-affliction-linger-hold.md`, `tools/audit-actors.mjs`.

Скрипты подсчёта лежат в scratchpad (`c1.cjs` … `c12.cjs`, `c4/c5/c11.mjs`); числа ниже воспроизводимы.

## 0. Сводка: что оказалось не так, как в аудите

| Пункт | Расхождение с аудитом |
|---|---|
| 9. Свиток | **pf2e уже проверяет список.** `SpellcastingEntry#canCast` (`pf2e.mjs:54037`): тот же тип колдовства (`tradition` ∈ `spell.traditions`) либо заклинание есть в записи; временная запись свитка создаётся только если хоть одна запись актёра может его сотворить (`pf2e.mjs:34466-34482`, `castEmbeddedSpell` 51430). Аудит «grep: ничего» ошибся. Кода не нужно, только живая проверка. |
| 10. MAP | **Ни pf2e, ни модуль не считают число атак.** Штраф выбирает игрок кнопкой (`attackNumber`/`mapIncreases` приходят от вызывающего: `pf2e.mjs:15120`, `15160`, `53783`). «Считается за две атаки» автоматизировать нечем — это ограничение (limitations.md). Автоматизируема только половина «две цели — при двух свободных руках». |
| 7. Скрытие | **Вынесено из automato**: плоскую проверку по видимости делает pf2e-vision (`pf2e-vision/plan-attacker-flat-dc.md`). Аналогов «while raging + состояние» в корпусе нет (только Elemental Instinct). |
| 3. Частота | Группа «Frequency-строка, `system.frequency` пуст, действие» — 51 док. (48 имён), из них NPC/адвентюр 46; плюс 12 способностей фамильяров с «once per day» в прозе. Оценка «до 509» — шум регулярки по прозе. |
| 1. Flourish | 292 документа с чертой `flourish` (224 имени): ядро pf2e 191 (`feats-srd` 182, `actionspf2e` 8, `classfeatures` 1), остальное бестиарии. |

## 1. Flourish: одно действие с чертой `flourish` за раунд

**pf2e сейчас.** Только подпись черты (`pf2e.mjs:8097`, `8838`; текст `PF2E.TraitDescriptionFlourish`, `en.json:5020`: «You can use only one action with the flourish trait per round»). Принуждения нет. В модуле `grep flourish scripts lang` — пусто.

**Группа.** Признак: `traits ∋ flourish`, тип `action`/`feat`. 292 док. / 224 имени (action/action 90, feat/action 189, reaction 3, free 5, passive 5). Заклинаний с чертой нет. Ядро pf2e — 191.

**Что считается использованием.** Карточка использования (`isUseCard`: `action`/`feat`/`spell`, контекст `undefined`/`self-effect`/`spell-cast`) — единая точка `preCreate` в `impulse-gate.mjs`. Удары с flourish (Двойной удар, Шквал ударов, Внезапный натиск) — это действия-фиты с карточкой, не `Check.roll`: учёт идёт по карточке, отдельно считать Удары не нужно. Пути `unchecked(actor,item,…)` (`reactions.mjs:212`, `lib.mjs:209 useOnce`) отметок не ставят — реакция с flourish через трекер модуля не посчитается (3 документа, принято). Пассивки (5) не карточка — не затрагиваются.

**Решение.** Одна строка в `LIMITS` (`scripts/builtin/impulse-gate.mjs`), после `overflow`:
`{ reason: "flourish", applies: c => c.traits.includes("flourish"), fails: c => !!c.round && c.flourishRound === c.round, mark: c => c.round && ["flourishRound", c.round], vars: c => ({ trait: <подпись PF2E.TraitFlourish через CONFIG.PF2E.actionTraits.flourish + i18n> }) }`.
- В `ctxOf` добавить `flourishRound: f.flourishRound`. Учёт «за раунд» — как `overflowRound` (`roundKey` = `<бой>:<раунд>`; вне боя ограничения нет, как у overflow). Откат карточки (`onDelete`/`staleMarks`) возвращает метку сам.
- Все акторы, не только персонажи (в отличие от `reaction`: у NPC несколько реакций, у flourish такой оговорки нет). **Спорно — см. §12.**
- Название черты в предупреждении — через `vars.trait` из pf2e (не придумывать, §2.1).

**Lang (`lang/*/builtin.json`, блок `limit`):** `limit.flourish` — «{name}: в этом раунде уже было действие с признаком «{trait}» — можно одно за раунд. Alt при клике — использовать всё равно.» (en зеркально).

**Подводные камни.** (а) Alt-использование тоже ставит метку (`marksFor` не смотрит на Alt) — так и должно быть: действие совершено. (б) Реакция вне хода: тот же `roundKey`, учтётся. (в) Возврат фокуса/слота не затрагивается (блок до траты — для заклинаний `wrapCast`; flourish-заклинаний нет). (г) `counterspell.mjs` зовёт `whyNot` — новая причина пройдёт в его текст автоматически, проверить, что ключ `limit.flourish` разворачивается без `name`-зависимости.

**Тесты.** Юнит `tests/impulse-gate.test.mjs`: `reasonOf` — flourish тот же раунд → `"flourish"`, другой раунд / `round:null` → `null`; не flourish → не трогаем; `marksFor` отдаёт `flourishRound`. Живой: новый `tests/live/limits-rustyspirit.js`, сценарий `flourish` на копии Леонарда: «Внезапный натиск» дважды в раунде → второй блок + `ui.notifications.warn`; с Alt проходит; следующий раунд проходит; удаление первой карточки возвращает метку.

## 2. Ярость и импульсы (`breaksRage`)

**pf2e сейчас.** `PF2E.TraitDescriptionImpulse` (`en.json:5078`): «The impulse trait means the action has the concentrate trait **unless another ability changes this**». Запрета концентрации в ярости и требования «ярость» для черты `rage` pf2e не накладывает: `PF2E.TraitDescriptionRage` (`en.json:5217`) — «You must be raging to use abilities with the rage trait» — только текст. Модуль: `rage.mjs breaksRage` смотрит только литеральный `concentrate`, и только **шёпотом** (`onMessage`), после действия.

**Полный текст исключений и модификаторов (поиск по корпусу `c13.cjs`: «gain the rage trait», «while raging … concentrate»).**
- Elemental Instinct (`classfeatures.0jSS6pgNXsC8k4o7`): импульсы **той же стихии**, что выбрана для инстинкта (в т. ч. из Kineticist Dedication), можно использовать в ярости, даже с concentrate.
- Seek (текст Ярости); действие с чертой `rage`.
- **Moment of Clarity** (`vRXPsMbyuvoPvbAQ`): до конца хода concentrate разрешён. Вне боя `turnKey` = `null` → метка «на ход» не работает: вне боя метку держать по времени (`game.time.worldTime` + 6 с).
- **Raging Intimidation** (`raging-intimidation`): в ярости Demoralize и Scare to Death **получают черту `rage`** → не нарушают. Распознавать по slug действия (`demoralize`, `scare-to-death`) + наличие у актёра фита `raging-intimidation`.
- **Bloodrager Dedication** (`bloodrager-dedication`): заклинания репертуара в ярости получают `rage` → не нарушают; признак — запись колдовства «репертуар» (spontaneous) у актёра с фитом `bloodrager-dedication`.
- **Soul Blessing** (`golden-souled-yang-na`, снаряжение): при эффекте Rage получает `rage` — slug `soul-blessing` в ярости не нарушает.
- `animal-rage` («dismissing the transformation gains the rage trait») — касается самого Animal Rage, у которого и так есть `rage`; в блок не входит.
- Share Rage (эффект получателя `RoGEt7lrCdfaueB9`, не `effect-rage`): получатель может concentrate; `raging` его не видит — блока нет (верно). Moon Frenzy — эффект на цели, не `effect-rage` — не затронут.
- «Ярости других форм» (Celestial Rage, Tainted Rage, NPC) идут через тот же slug `effect-rage`.

**Блок или шёпот.** Ограничение способности — по §1.1 **блок + предупреждение + Alt**. Шёпот остаётся там, где блок невозможен: проверки навыка/Внимания без карточки предмета (Вспомнить знания и пр.).

**Решение.**
1. **Общий код — в `scripts/builtin/limit-text.mjs`** (чистый модуль без foundry; его уже импортирует `impulse-gate.mjs`, `rage.mjs` импортирует тоже) — кольцевого импорта `rage.mjs` ↔ `impulse-gate.mjs` нет. Туда переезжают: `RAGE_SLUG`, `isRage`, `STARTERS`, расширенный `breaksRage`, `raging(actor)` (чистая над `actor.itemTypes.effect`). `rage.mjs` реэкспортирует `breaksRage`, `isRage` (имена остаются для тестов).
2. Расширенный `breaksRage({ traits, slug, instinctEls, clarity, rageSlugs, repertoire })`: **`USE_TYPES` в `rage.mjs:16` не содержит `"use"`** — вызов с типом `"use"` ничего не блокировал бы; в общей функции тип контекста **не проверяется** (для use-карточек уже отфильтровано `isUseCard`), а `USE_TYPES`-фильтр остаётся только в `rage.mjs onMessage` (путь без карточки). Правила: concentrate = `traits ∋ concentrate` или `traits ∋ impulse`; не нарушает — черта `rage`; slug ∈ `{seek, rage, quick-tempered}`; `clarity`; slug ∈ `rageSlugs` (Raging Intimidation / Soul Blessing); заклинание репертуара при Bloodrager Dedication; **импульс** — по стихии: у импульса есть элемент-черта (`air|earth|fire|metal|water|wood`) и у актёра есть опция `elemental-instinct:<el>` с тем же `<el>` → не нарушает; **импульс без элемент-черты** (11 док. / 8 имён: `elemental-blast`, `base-kinesis` и др.) — стихия неизвестна → **не блокируем** (ложный блок хуже пропуска). Опции — `actor.getRollOptions()` (ChoiceSet `rollOption:"elemental-instinct"` → `elemental-instinct:air`).
3. `impulse-gate.mjs`: строка `LIMITS` `{ reason: "rage", applies: c => c.raging && !c.paRage, fails: c => breaksRage({ traits: c.traits, slug: c.slug, instinctEls: c.instinctEls, clarity: c.clarity, rageSlugs: c.rageSlugs, repertoire: c.repertoire }) }`; контекст: `raging`, `paRage: paHas("rage")` (как в `rage.mjs onMessage`: при уступке pf2e-automations модуль ярость не обрабатывает — строка молчит), `instinctEls`, `clarity`. Порядок: перед `overflow`. Метка у `moment-of-clarity`: `["clarityUntil", c.turn ?? worldTime+6с]`.
4. `rage.mjs onMessage`: шёпот «концентрация» — только если `!isUseCard(message)`; для use-карточек блок. Не дублируем.
5. Заклинания: у данных заклинаний `concentrate` в `traits` есть (у `figment`: `concentrate, manipulate`), достаточно `traits`; ссылку на `pf2e.mjs:10144` не использовать (миграция данных).

**Группа (§1.4).** Импульсы: **128 док. / 118 имён**, `concentrate` в данных у 2 (`weight-of-stone`, `tremor`); 11 без стихии. Плюс все действия/заклинания с concentrate в ярости. Исключения — одна функция (список выше), а не по предмету.

**Lang:** `limit.rage` — «{name}: в ярости нельзя использовать действия с признаком «{concentrate}» без признака «{rage}» (импульс — тоже, кроме стихии вашего инстинкта). Alt при клике — использовать всё равно.» Названия черт — из pf2e через i18n (`vars`). `builtin.rage.concentrate` оставить для пути без карточки.

**Подводные камни.** (а) Свой Rage модуля (`enter()`) идёт через `addEffect`, не карточку — блока нет. (б) Леонард: земля + инстинкт земли — земляные проходят, воздушные блокируются. (в) Вне боя ярость тоже блокирует. (г) Не двойной эффект: шёпот только для не-карточек.

**Тесты.** Юнит (без общих файлов): `breaksRage` — `tests/builtin.pa-handlers.test.mjs` (за К1): та же стихия → null, чужая → блок, импульс без стихии → null, `rage`-черта → null, Raging Intimidation / Soul Blessing → null, clarity → null (в т. ч. при `turnKey` null), spell с concentrate → блок. `reasonOf` для строки `rage` (в т. ч. `paRage` → не применяется) — `tests/impulse-gate.test.mjs`. Живой: `tests/live/limits-rustyspirit.js`, сценарий `rage-impulse`: копия Леонарда в ярости — земляной импульс проходит, воздушный блокируется, Alt проходит.

### 2б. Черта `rage` — только в ярости (новая строка К1, §1.1)

**pf2e сейчас.** Только текст `TraitDescriptionRage`; принуждения нет. **Группа:** черта `rage`: **79 док. / 64 имени**, из них действий/реакций/свободных (не пассивка) 69; требование «raging» в Requirements написано лишь у 2 — остальные полагаются на черту (`c13.cjs`).
**Решение.** Строка `LIMITS` `{ reason: "rageTrait", applies: c => c.traits.includes("rage") && c.actorType === "character" && !c.paRage, fails: c => !c.raging }`. Только персонажи: у NPC ярость бывает без эффекта `effect-rage` → ложный блок. Реакции с `rage` (12 фитов) идут через ту же строку — блок до траты реакции (отметка `reaction` не ставится). Lang `limit.rageTrait` — «{name}: способность с признаком «{rage}» — только в ярости. Alt при клике — использовать всё равно.» (`{rage}` из `PF2E.TraitRage`). Тесты: `reasonOf` (rage-черта без ярости → `"rageTrait"`, в ярости → null, NPC → null) — `tests/impulse-gate.test.mjs`; живой — Леонард без ярости: «Враг не уйдёт» / «Внезапный натиск» → блок. Не двойной эффект: pf2e ничего не блокирует.


## 3. Частота только в тексте

**pf2e сейчас.** Счётчик ведёт pf2e только по `system.frequency`: списание в `createUseActionMessage` (`pf2e.mjs:54446`), восстановление при отдыхе (`32944`, только `character`). Подставить `frequency` в память умеют `ItemAlteration` `frequency-max` / `frequency-per` (`pf2e.mjs:41310-41376`, `itemType: action|feat`, `system.frequency ??= {max:1, per:"day"}`), но (1) это Rule Element — для текстовой частоты его пришлось бы писать в чужие предметы актёров (запрещено: данные мира не пишем), (2) списание пишет в **источник** `system.frequency.value` у предмета, где объекта нет — обновление частичного вложенного объекта у `null` не проверено и, судя по схеме (`FrequencyField`), ломкое. **Отвергнуто: счётчик — флаг модуля**, не подмена `frequency`. (Живой проверкой не подтверждено — вывод по коду.)

**Группа.** Скриптом (`c11.mjs`): action/feat, не пассивка, `frequency:null`, строка `Frequency …` разбирается `frequencyOf`: **51 док. (48 имён)**: ядро 5 (`scrappy-defiance`, `relentless-assault`, `inflict-punishment`, `forged-in-fire`, `hellish-impression`), NPC/адвентюр 46 (+дубли — 72 док.). Единицы: days 16, rounds 28, hours 4, minutes 3. Плюс способности фамильяров (`pack familiar-abilities`, `actionType: passive` в данных, на актёре — `action`): **12 из 117** (`versatile-form`, `innate-surge`, `restorative-familiar`, `recall-familiar`, `medic`, `invisibility`, `extra-vial`, `spellcasting`, `kindling`, `synchronize-spirit`, `augury`, `pot-of-tea`) — частота в прозе («Once per day, your familiar can …»). Итого ≈ 63 документа > порога 30 → общий механизм оправдан. Не берём «once per day» в прозе остальных 483 документов (шум).

**Решение: оверлей + строка `LIMITS`.**
1. `tools/use-limits.mjs` (образец — клауза `req`): рядом с `req` вычислять `freq` = `frequencyOf(<строка Frequency>)` для action/feat с пустым `frequency` и пустой частотой в данных; для `familiar-abilities` — `frequencyOf` по тексту без разметки (`@UUID{…}` → подпись). Для фамильяров фильтр `actionType !== "passive"` снять (по паку). Запись выпускается только если разобрано (ложный блок хуже пропуска; «once per day for each …», «until recharged», «once per season» → `frequencyOf` их не берёт — проверено).
2. Формат файла `rules/use-limits.json`: добавить ключ верхнего уровня `freq: { bySource: {uuid: {value, unit, uses?}}, bySlug: {"slug@тип": [{sig, freq}]} }` (отдельный от `bySource/bySlug` `req`, чтобы не ломать `limitEntry`). Подпись `reqSig` и логика группировки по slug — те же (повторить для `freq`).
3. `scripts/rules.mjs`: рядом с `limitEntry` (≈2102) — экспорт `freqEntry(item)`; вызывает те же `lookupSourceOf`/`slugTypeKey`/`reqSig`. Менять только этот участок.
4. `impulse-gate.mjs`: `ctxOf`: `get freqText() { return item.system?.frequency ? null : freqEntry(item) }`, `freqSlot: f[`fq_${item.id}`]`. Строка `LIMITS` после `frequency`:
   `{ reason: "freqText", applies: c => !!c.freqText && c.tracks && (c.inCombat || c.freqText.unit !== "rounds"), fails: c => usesLeft(c.freqSlot, c.freqText, c.now) === 0, mark: c => ["fq_<id>", withUse(c.freqSlot, c.freqText, c.now, randomID())] }`
   - Чистые `usesLeft/withUse` — из `scripts/cast.mjs` (экспорты есть, цикла импортов нет: `cast.mjs` не импортирует `impulse-gate`). `tracksUses(item, per)` (`cast.mjs:22`) сравнивает `item.actor.type === "character"` — у фамильяра (`type: "familiar"`) вернёт `false` для «раз в день», а их отдых мастера сбрасывает. Поэтому в строке `freqText` тип для проверки — **тип мастера** (`actor.master?.type ?? actor.type`): вызывать `tracksUses({ actor: { type: masterType }, system: item.system }, per)` либо вынести чистое `tracksFor(actorType, per)` (правка `cast.mjs` — одна строка, экспорт). «Раз в день» у NPC не блокируется (решение принято).
   - Часы: `c.now` в коде нет (поле нужно завести); в `cast.mjs:216` есть неэкспортированная `clock(actor)` → `{time: game.time.worldTime, combat, round}`. Экспортировать её (`export const clock`, одно слово в `cast.mjs`; это единственная правка `cast.mjs`, К1 владеет ею) и звать `clock(actor)` в `ctxOf` (поле `now`).
   - Флаг на **актёре** `flags.pf2e-automato.fq_<itemId>` (механизм меток `LIMITS` пишет только на актёра). Предыдущее значение едет с карточкой в `limitClear`: в `clearFor` (`/^rc_/` → `/^(rc|fq)_/`), чтобы удаление карточки возвращало прежнюю запись, а не стирало весь счётчик (важно при «двух разах в день»).
   - Сброс «в день»: в `install()` `Hooks.on("pf2e.restForTheNight", actor => …)` — снять `fq_*` у актёра и у его фамильяров (`familiarsOf(actor)` из `scripts/familiar.mjs`); ключи «раз в N дней/неделя» — по времени мира (`windowOpen` в `cast.mjs`) не снимать.
   - Мягко/жёстко: **блок + Alt** (§1.1), в отличие от `activate.per` (там «всё равно?» — мягкое окно).
5. **Исключения.** Предмет с настоящим `system.frequency` — строка `frequency` (не дублируем: `freqText` не применяется, §3.5). Реакции/свободные действия — тоже карточка. Пассивки фамильяров: «использование» = карточка в чат (`toMessage`); чтение описания тоже создаёт карточку — **ложный блок возможен** (смягчение: Alt; решение см. §12). Живым прогоном проверить, что у Еси/Каштана вообще создаётся use-карточка без `usable` (pf2e `usable: !!frequency||selfEffect`, `pf2e.mjs:16711`).

**Lang (`builtin.json`, `limit`):** `limit.freqText` — «{name}: использований не осталось — {per} (учёт по тексту способности, модуль считает сам). Alt при клике — использовать всё равно.» + `limit.freqPer.*` (в день / в час / раз в N минут / за раунд; форма множественного числа — как у `rcWait`). Подпись «раз в день» — из `PF2E.FrequencyPer*` если есть (`CONFIG.PF2E.frequencies`), иначе свои.

**Подводные камни.** (а) Оверлей собирается из `items.json` (английский текст): русские описания pf2ru его не ломают (ключи по uuid/slug). (б) Уход от `justSpent`-логики не нужен: `system.frequency` нет — pf2e не списывает. (в) Откат карточки обязателен (§3.5). (г) NPC с `rounds`: `inCombat` обязателен (как `frequency` per round). (д) Оверлей меняется только скриптом; руками не править.

**Тесты.** Юнит: `tests/use-limits.test.mjs` — разбор `freq` (once per day / twice per hour / once per 10 minutes → `{value,unit,uses}`; «once per season», «until recharged» → null), `buildLimits` отдаёт `freq` только при пустом `frequency`; `tests/impulse-gate.test.mjs` — `reasonOf` с `freqText` (второй раз в день → `"freqText"`, окно rounds вне боя → null, NPC days → null), `marksFor`/`clearFor` с `fq_`. Живой (`limits-rustyspirit.js`): Еся — «Гадание» дважды (вторая блок; Alt; отдых `restForTheNight` сбрасывает, фамильяра — тоже); Каштан — «Исцеляющий фамильяр»; NPC-действие «per round» (Frequency once per round) в бою.

## 4. Поддерживаемые заклинания без `sustain:true`

**pf2e сейчас.** Эффект заклинания висит по `duration` своего эффекта-предмета, Поддержание не привязано (`sustain.mjs` строит якорь «Поддержание: …» только по шагу `sustain:true`; вторая модель — системные эффекты с `duration.sustained` — не покрыта, `sustain.mjs:4`).

**Группа (скриптом `c6.cjs`).** Заклинания, `duration` начинается с «sustained» (460 док., 291 имя) → слияние слоёв `pa → model → onhit → rusthenge → counterspell → catalog` → есть правило с шагом `effect`/`condition` и **нет ни одного `sustain:true`**: **46 док., 40 имён** (у аудита «20 из 36» — занижено). С `sustain:true` уже: 21.

Деление:
- **A — ставим `sustain:true` (32):** `figment`, `leaden-steps`, `beastmaster-trance`, `clawsong`, `dancing-shield`, `mirror-malefactors`, `protectors-sphere`, `unravel-knowledge`, `ghostly-shift`, `interstellar-void`, `lightning-lasso`, `gloom-mantle`, `veil-of-dreams`, `competitive-edge`, `domoras-defense`, `mycological-malady`, `confront-selves`, `stumbling-curse`, `word-of-truth`, `calm`, `grasping-vine`, `blood-ward`, `elemental-betrayal`, `roses-thorns`, `hymn-of-healing`, `rainbows-end`, `fiendish-rift`, `laughing-fit`, `ancestral-form`, `tempest-form`, `hideous-laughter`, `calm-emotions`. (Эффект с пределом срока или состояние **со сроком**.)
- **B — проверять по тексту, часто `sustain` не нужен (8):** `mind-games`, `cyclone-rondo`, `unexpected-windfall`, `fallen-soldiers-lament`, `frost-pillar`, `ancestral-winds`, `invoke-spirits` (в записях есть состояния **без `duration`** — валидатор отклонит `sustain` (`apply.sustainDur`, `rules.mjs:190`), либо мгновенное состояние prone/stunned, не живущее под Поддержанием), `buzzing-bites` (держит метки иначе, аудит). По каждому — прочитать текст, решение «sustain на шаге с длительным состоянием / оставить» и пояснение в отчёте.

**Решение (данные, без кода).** Слои: `model`/`pa` — генерируемые, правим копией в `rules/catalog.json` (запись целиком, образец A27/A28 в `docs/plan-animist.md`; слой `catalog` перекрывает остальные). Три записи (`figment`, `calm`, `calm-emotions`) уже в `catalog.json` — правка на месте. **Формат `catalog.json` — одна запись в строку; не перезаписывать файл `JSON.stringify`** (формат сломается): вставлять/менять строки точечным `Edit`. На шаге `sustain: true` — одно из `condition|effect` (`rules.mjs:126`), у состояния обязателен срок. Записи слоя `pa` (`protectors-sphere`, `ancestral-form`, `tempest-form`, `hideous-laughter`, `laughing-fit`) при активном pf2e-automations уступаются ему (`yieldToAutomations`) — копия в `catalog.json` этого не меняет, отметить в отчёте.
Воспроизводимость: `tools/sustain-gaps.mjs` (новый, отчёт без правок, по образцу `check-catalogs.mjs`): печатает список по критерию выше; `--check` — падает, если появилась запись из A без `sustain`. Список B — константа-исключение в скрипте.

**Подводные камни.** (а) Сотворение вне боя: якорь без раунда — см. долг A32 (`plan-animist.md`, режим «10 минут → 8 часов»): `figment`/`calm` кратки, не затрагиваются; `hymn-of-healing`/`protectors-sphere` проверить. (б) Двойной эффект: у записей с уже существующим эффектом-«Spell Effect» pf2e (системный) — `sustain` привязывает копию модуля, дубль не создаётся (`meta.key`), проверить живым. (в) Заклинания, где эффект кончается раньше Поддержания, — `sustain` корректен (раньше срока снимет сам эффект).

**Тесты.** Юнит: новый `tests/catalog.rustyspirit-gaps.test.mjs` — для каждого slug из A собранный каталог (`buildCatalog`) отдаёт запись, где есть шаг `sustain:true`, и `validateRule` без ошибок; для B — запись не изменена. Живой: `tests/live/level1-sustain.js` (образец) — 3 представителя: `figment` (эффект на себя), `hymn-of-healing` (союзники), `ancestral-form` (форма): сотворение → якорь «Поддержание» → «Прекратить» снимает свой эффект, чужой не трогает; пропуск Поддержания в конце хода тоже.

## 5. Форма тёмного леса (Кепи, A26)

**pf2e сейчас.** Заклинание `BhJtCTLbngvZm8EA` без Rule Elements: даёт только описание; формы — отдельные заклинания (Pest Form `gfPjmG6Fe6D3MFjl`, Animal Form `wp09USMB3GIW1qbp`, Elemental Form `1K6AYGisvo9gqdhs`) с эффектами. Записи у модуля нет (`docs/plan-animist.md:47`, «нужен выбор формы», `coverage.md:175` `root-mode-choice`).

**Текст.** Базово — формы из Pest Form; с 2-го круга ещё Animal Form; с 5-го — ещё Elemental Form. «Gain all the effects of the form you chose from a version of the spell heightened to darkened forest form's rank.» При каждом Поддержании можно сменить форму.

**Эффекты форм в каталоге (проверено):** Pest Form → `Compendium.pf2e.spell-effects.Item.ydsLEGjY89Akc4oZ` (`model`); Animal Form → `Compendium.pf2e-automato.effects.Item.h68Fr3fht1319txv` (`pa`, эффект пака модуля); Elemental Form → `Compendium.pf2e.spell-effects.Item.Qp0dlhJaCzXIx73r` (`pa`). Конкретную форму внутри эффекта выбирает `ChoiceSet` самого эффекта (штатное окно pf2e) — двухступенчатый выбор «семейство → форма» приемлем.

**Решение, этап 1 (при сотворении; данные в `rules/catalog.json`, ключ `spells-srd…BhJtCTLbngvZm8EA`).**
```
onUse.targets:"self", apply:[
 {to:"self", removeEffect:{slug:<slug эффекта формы>, of:"origin"}},   // нужен ТОЛЬКО если живая проверка покажет дубль формы при повторном сотворении; по каждому из трёх эффектов (slug прочитать в паке) — три шага; нет эффекта — шаг пропускается (rules-format)
 {to:"self", choose:{from:"options", options:[{value:"pest"},{value:"animal", when:[{gte:["item:rank",2]}]},{value:"elemental", when:[{gte:["item:rank",5]}]}], prompt:…}},
 {to:"self", when:["choice:pest"],      effect:{uuid:<Pest>}, sustain:true},
 {to:"self", when:["choice:animal"],    rank:{min:2}, effect:{uuid:<Animal>}, sustain:true},
 {to:"self", when:["choice:elemental"], rank:{min:5}, effect:{uuid:<Elemental>}, sustain:true}]
```
Исполнителю проверить в коде: (а) доступна ли опция `item:rank` в `when` варианта `choose` (`rules-format.md`: «опции автора и предмета (`item:*`)»; если нет — убрать `when` у вариантов, оставить `rank` на шагах, пустое применение — предупреждение ГМу); (б) эффект формы получает уровень = круг сотворения («уровень эффекта = круг сотворения заклинания») — иначе числа Pest/Animal Form не вырастут; (в) один выбор единственного варианта выбирается без окна (на 1-м круге у Кепи «pest» единственный). Единственный коммит-риск — `sustain:true` у нескольких взаимоисключающих шагов: допустимо, шаг с невыбранным `when` не исполняется.

**Этап 2 (смена формы при Поддержании) — СДЕЛАН** (`onUse.reshape`, `plan-sustain-reshape.md`; живой сценарий `tests/live/dff-reshape.js` написан, прогон за Руководителем). Ниже — исходная постановка. Нужен «выбор варианта при Поддержании»: `onUse.pulse` (`plan-sustain-pulse.md`) повторяет только `challenge` и шаги `to:"target"`. Группа таких заклинаний — малая (по тексту «each time you Sustain … choose/change»: `darkened-forest-form`, `gift-of-the-anemos` (A31), `crown-of-prophets` (A20), `impaling-briars`, `storm-of-vengeance` и подобные — порядка 5–10; скрипт `c12.cjs`, регулярка шумит). Вариант реализации: поле `onUse.reshape` — при Поддержании (слушатель `sustain.sustained`) ГМу/владельцу уходит шёпот с кнопкой «Сменить форму»: она снимает свой эффект формы (`removeEffect of:"origin"`) и заново исполняет шаги записи с `choose`; файлы — `scripts/sustain.mjs`, `scripts/rules.mjs` (валидатор), `scripts/use.mjs`, lang. **Не начинать без решения пользователя (§12): этап 1 даёт форму при сотворении, смена при Поддержании остаётся ручной (снять эффект, применить заново); строка в `limitations.md`.**

**Lang:** `rules.json`: подписи вариантов `choose.opt.pest|animal|elemental` — из pf2e (`PF2E.…`/названия заклинаний Pest/Animal/Elemental Form с листа, §2.1), в `lang/*/rules.json` (используется Мастерской).

**Подводные камни.** `replace`/повторная установка эффекта формы при сотворении поверх живой формы — `removeEffect of:"origin"` первым шагом (не дублируем форму). Эффект Animal Form — из пака модуля `pf2e-automato.effects` (требует пересборки пака только если правится сам эффект — не правим).

**Тесты.** Юнит: `catalog.rustyspirit-gaps.test.mjs` — `validateRule` записи DFF без ошибок, три шага `sustain`. Живой: копия Кепи (`tests/live/rustyspirit.js` — как образец): сотворение на 1-м круге — единственный вариант без окна, эффект на себе, «Прекратить Поддержание» снимает эффект; на 2-м круге — окно выбора из двух; конец — чисто.

## 6. «Враг не уйдёт» (No Escape) и группа «враг уходит из досягаемости»

**pf2e сейчас.** Только карточка реакции; триггера «враг выходит из досягаемости» нет. В модуле — Реактивный удар ловит тот же момент хуком `moveToken` (`reactive-strike.mjs onMove`: «клетки, которые существо покинуло», `leftSquares`, `gapFeet`; вызывается из `builtin/index.mjs:166`).

**Группа (скриптом `c7.cjs`, триггер «move/moves away / leaves … reach»):** реакции `action`/`feat` — 31 док. / 18 имён. Из них:
- **«Следуй» (Stride за целью, 17 док.):** `no-escape` ×11 (Леонард + бестиарии), `keep-pace`, `reactive-pursuit` ×3, `relentless-stalker`, `assassins-pursuit`, `deadly-pursuit`.
- **Проверка/захват вместо Stride:** `interrupt-charge` (Атлетика против большей из Атлетики/Стойкости; нужна свободная рука), `graveknight-clutching-armor` ×2 (Захват −2), `cloying-pull`, `reflexive-grab`, `tail-trip`, `tripping-whip`, `scrabble`.
- Не берём: `wing-rebuff`, `tail-sweep`, `profane-chant`, `dance-partner`, `flyby-swing` — триггер другой («входит в досягаемость», «в вашей досягаемости, нанёс урон»).
Берём **6 слагов из задачи + `assassins-pursuit`, `deadly-pursuit`** = 8 имён / ~21 док.; остальные — расширением таблицы без кода.

**Решение: расширить диспетчер реакций-Ударов, а не новый.** Файл `scripts/builtin/reactive-strike.mjs`:
1. `reactionOf(item)` → таблица `slug → вид`: добавить виды `follow` (no-escape, keep-pace, reactive-pursuit, relentless-stalker, assassins-pursuit, deadly-pursuit), `check` (interrupt-charge), `grab` (graveknight-clutching-armor). `STRIKE_SLUGS`-логика сохраняется.
2. `onMove` — сейчас берёт одного держателя с `reactionOf==="strike"`; вынести общий обход: для каждого токена-держателя перебрать его реакции из таблицы, `leftSquares` в пределах досягаемости (как для Удара). Для `follow`/`check`/`grab` — условие **ушёл из досягаемости**: стартовая клетка в досягаемости, **конечная нет** (`gapFeet(destination) > reach`); Реактивный удар срабатывает и на движение внутри досягаемости — условия разные, не смешивать. Шаг (≤5 фт) для «враг уходит» тоже считается (Реактивный удар Шаг не провоцирует, а No Escape — «attempts to move away» — да).
3. Требования вида: `follow` — враг (`opposed`), живой держатель, не `noReactions`, **подсказка только если `whyNot(actor, item) == null`** (публичная `whyNot` из `impulse-gate.mjs` возвращает любую причину: реакция потрачена, ярость (`rageTrait`), `req`, перезарядка — не только `"reaction"`); для предметов с чертой `rage` (`no-escape` у Леонарда) подсказка идёт, **только если держатель в ярости** (`raging(holder.actor)`, общая функция из `limit-text.mjs`) — строка `rageTrait` (§2б) всё равно заблокирует карточку, подсказка без ярости ввела бы в заблуждение; `relentless-stalker`, `keep-pace` и **`assassins-pursuit`** (текст: «hunted prey is within their reach») — цель = добыча (`hunt-prey.mjs`: флаг добычи; нет добычи — не подсказывать), «смежный» — `reach ≤ 5`; `interrupt-charge` — свободная рука (`handsFree`, клауза `hand` из `use-limits`).
4. Подсказка — тот же `hint`/`whisper` с кнопкой по виду: **«Использовать реакцию»** (`follow`/`check`/`grab`): кнопка публикует карточку предмета штатным путём (`item.toMessage()`), **без `unchecked`** — карточка пройдёт `LIMITS`-строку `reaction` и сама отметит реакцию потраченной (иначе вторая реакция в раунде проскочит, §3.4 здесь наоборот: проверка нужна). Для `check` — дополнительно «Атлетика против СЛ» только по решению (v1 — карточка + описание); для `grab` — существующий `maneuver.mjs` (Захват −2), v1 — карточка.
5. **Само перемещение Stride за целью — игрок** (токен тащит игрок/ГМ; автоматический путь «следуй вплотную по клеткам цели» — отдельная задача, §12).
6. Антидубль: `seenMoves` по `${movement.id}:${holder.id}` (как есть); один ход — одна подсказка на держателя; та же закрывающая логика `settleButtons`/`used` (`bindStrike`) — общая функция привязки кнопки для новых видов.

**Lang:** новые ключи — в `lang/*/reactions.json` (раздел `reactions.leave.*`: `hint`, `button`, `cannot`), **не в `builtin.json`** (его занимает §1–3,8,10). Название реакции — с листа (`item.name`). Текст «уходит из досягаемости» — свой; `builtin.reactive.*` не менять.

**Подводные камни.** (а) Хук `moveToken` — только у активного ГМа (`index.mjs:166`), как у Реактивного удара; без ГМа подсказок нет. (б) Принудительное перемещение (`displace`, телепорт, откат) — отсеивается уже в `onMove` (`teleport` в waypoints, `MOVE_METHODS`). (в) Один актёр держит и Реактивный удар, и No Escape → два шёпота; реакция одна — второе использование заблокирует `reaction`-строка; шёпоты можно слить в один (кнопка на реакцию). (г) NPC: реакций несколько — `LIMITS.reaction` у NPC молчит (только `character`), подсказка идёт; повторная подсказка тому же NPC в раунде допустима. (д) Не двойное исполнение: Реактивный удар и «Следуй» — разные реакции, пересечения нет. (е) `no-escape` у Леонарда имеет трейт `rage` — в ярости разрешено (не concentrate).

**Тесты.** Юнит: вынести чистые функции в `reactive-strike.mjs` (`leaveTrigger(origin, dest, reach)` — ушёл/не ушёл, шаг, смежность) и проверить в новом `tests/builtin.leave-reach.test.mjs`; таблица `reactionOf` — все 8 слагов → нужный вид, чужие → `null`. Живой: `tests/live/leave-reach.js` по образцу `tests/live/reactions-catalog.js`/сцена `reaction-hint` (suite): копия Леонарда + вражеский токен рядом: токен отходит на 15 фт → шёпот «следуй», кнопка → карточка; вторая попытка в раунде — блок реакции; враг движется внутри досягаемости — подсказки «следуй» нет (Реактивный удар есть).

## 7. Инстинкт стихии: concealed против дальних в ярости — **вне этого плана**

**Решение Руководителя (по Критику):** в automato не делаем. Плоскую проверку по видимости цели (одна проверка с учётом Keen Eyes / Blind-Fight и т. п.) делает **pf2e-vision**: см. `pf2e-vision/plan-attacker-flat-dc.md`. Запись `onEvent`/`hold` на Elemental Instinct, состояние `concealed` на актёре и любые правки каталога под этот пункт **не вносить** — иначе двойная плоская проверка (§3.5 CLAUDE.md).

Остаётся только текст: в `docs/wiki/limitations.md` (К3) — «Скрытие Elemental Instinct против дальних атак (в ярости) и плоские проверки по видимости ведёт pf2e-vision; в automato этого нет», и Superstition-«Frightened 1 при добровольном принятии магии» — решение игрока, не вычисляется. Число для истории: в корпусе только Elemental Instinct (+ `whirling-scarves`, `seeking-shots`, не про ярость) — группа 1; метод — `c8.cjs`.

## 8. Healing Familiar: «в вашем пространстве»

**pf2e сейчас.** Проверки нет. **Группа:** действие с «must be in your space» — **1 способность: `restorative-familiar`** (в клаузах `use-limits.json` нужной нет: `strike`/`holds`/`hand`). `lab-assistant` — пассивка (его условие касается Quick Alchemy мастера), из строки **убран**. Оверлей генерируется только из строки Requirements, а здесь условие в прозе → оверлей не подходит.

**Решение.** По образцу `torches` (единственный предмет без группы, `impulse-gate.mjs:38`): строка `LIMITS`
`{ reason: "inSpace", applies: c => c.slug === "restorative-familiar" && c.actorType === "familiar", fails: c => c.inSpace === false, vars }`.
- `ctxOf`: `get inSpace()` — токены на сцене автора: токен фамильяра (`familiarToken`) и токен мастера (`actor.master`, `sceneOf(actor)`). **`gapFeet` (`aura.mjs:5-9`) для этого не годится**: он возвращает не меньше `unit` (формула `(max+…+1)*unit`, у перекрывающихся — 5 фт). Нужна чистая функция пересечения прямоугольников в клетках `{x,y,w,h}`: `a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h` (в `limit-text.mjs`, юнит-тест). Нет токена/сцены/мастера — `null` (не блок: «ложный блок хуже пропуска»).
- `fails` по `=== false`, `null` не блокирует.

**Lang (`builtin.json`, `limit`):** `limit.inSpace` — «{name}: фамильяр должен находиться в вашем пространстве (на клетке мастера). Alt при клике — использовать всё равно.»

**Тесты.** Юнит: `reasonOf` с `inSpace:false` → `"inSpace"`, `null`/`true` → `null`, другой слаг → не трогаем; функция пересечения: те же клетки/соседние/частичное перекрытие крупных токенов. Живой: Каштан (копия) — токен фамильяра на соседней клетке → блок, на клетке мастера → проходит; без токена → проходит.

## 9. Свиток: заклинание должно быть в вашем списке

**pf2e сейчас делает это сам.** `SpellcastingEntry#canCast(spell, {origin})` (`pf2e.mjs:54037`): запись подходит, только если запись — подготовленная/спонтанная и либо `tradition ∈ spell.traditions`, либо заклинание есть в записи; временная запись свитка строится в `CharacterPF2e#prepareData` только при наличии такой записи (`34466-34482`); `castEmbeddedSpell` без записи ничего не делает (`51430`). Группа: 10 свитков (по аудиту). **Решение: кода не нужно.** Аудит искал по слову «list» и не нашёл `canCast`.

**Остаточное.** (а) Запись `runic-weapon` из каталога должна срабатывать на заклинание со свитка (аудиторская пометка «проверить живьём»); (б) модульные пути каста (`cast.mjs` — активации предметов) на свитки не распространены — ограничения нет. Что сделать: **только живая проверка** в `tests/live/limits-rustyspirit.js`, сценарий `scroll-list`: у копии персонажа с записью одного типа колдовства — свиток заклинания **другого** типа: `actor.spellcasting.get(\`${scroll.id}-casting\`)` отсутствует (pf2e блокирует); свиток своего типа — запись есть, `Cast` даёт карточку, правило `runic-weapon` ставит эффект. Если проверка неожиданно покажет дыру — строка `LIMITS` по `consumable`+`scroll` (приложение) — в этом плане не закладывается.

## 10. Slashing Gust (Рубящий шквал) и «считается за две атаки»

**pf2e сейчас.** Слот числа целей и MAP: pf2e не следит ни за тем, ни за другим (число целей — выбор игрока; MAP — аргумент `attackNumber` от вызывающего, `pf2e.mjs:15120`, `15160`, `53783`; модуль счётчика атак не ведёт — `grep` по `scripts` пуст).

**Группа.** «Две цели только при двух свободных руках»: **1 заклинание** (`slashing-gust`, + дубль бестиария; поиск `c10.cjs`). «Counts as two attacks / MAP»: регулярка даёт ~460 док. (333 имени, шум — это почти все «Double Slice / Swipe»-подобные; аудитовская цифра 20 — только заклинания и ядро) — **ограничение, не автоматизируется**.

**Решение.**
- **10A (код, малое):** строка `LIMITS` `{ reason: "twoHands", applies: c => c.slug === "slashing-gust", fails: c => c.targetCount > 1 && c.handsFree !== undefined && c.handsFree < 2 }`; `ctxOf.targetCount = game.user.targets.size` (цели на клиенте автора; для `wrapCast` и `preCreate` оба — клиент автора). У NPC `handsFree` нет → не блок. Lang `limit.twoHands`: «{name}: двух целей нужны две свободные руки — выберите одну цель или освободите руку. Alt при клике — использовать всё равно.»
- **10B (текст):** строка в `docs/wiki/limitations.md`: «Штраф множественных атак модуль не считает (pf2e тоже: игрок выбирает его кнопкой). Где в описании сказано «считается за две атаки» (Рубящий шквал по двум целям и др.), штраф увеличьте вручную.»

**Тесты.** Юнит: `reasonOf` — 2 цели и `handsFree:1` → `"twoHands"`; 1 цель, `handsFree:2`, `handsFree:undefined` → `null`. Живой: копия Искрика (кастер): две цели с занятой рукой (щит/предмет) — блок; одна — проходит; Alt проходит.

## 11. Удача полурослика без СЛ

**Решение.** Только текст: строка в `docs/wiki/limitations.md` (раздел «Что ведущий заметит в игре»): «Переброс после провала (Удача полурослика и ещё ~54 умения «You fail … reroll») подсказывается, только когда у проверки есть СЛ/исход; бросок без СЛ (`failed.mjs`: `degreeOk` нужен исход) подсказки не даёт — решайте за столом». Источник: `scripts/builtin/failed.mjs:25` (`degreeOk` — нет исхода → нет).
Подвох: файл `docs/wiki/limitations.md` сейчас правит другая задача (изменена строка 22, «Недуги, которые держат состояние»). Правим **точечным `Edit` одной новой строки в конец списка**, чужую строку не трогаем; если задача удержания к тому моменту закоммичена — просто новая строка.

## 12. Решения Руководителя (приняты)

1. Flourish — у всех акторов, включая NPC.
2. Ярость — блок по §1.1 (+ новая строка «черта `rage` — только в ярости», §2б).
3. Фамильяр: использование = карточка в чат, обход Alt.
4. «Раз в день» у NPC не блокируем; «раунд / час / 10 минут» блокируем.
5. Форма тёмного леса — только этап 1 (смена при Поддержании — ручная, строка в `limitations.md`).
6. No Escape — подсказка + карточка реакции, без авто-Stride.
7. Elemental Instinct (concealed против дальних) — **вне automato**, делает pf2e-vision (`pf2e-vision/plan-attacker-flat-dc.md`).
8. Sustain, список B (8 заклинаний) — решение по тексту каждого, с обоснованием в отчёте исполнителя.
9. Slashing Gust — блок двух целей при занятой руке; MAP — текст в `limitations.md`.

Открытым остаётся только: точный список «Raging Intimidation / Bloodrager / Soul Blessing» в §2 исполнитель сверяет по тексту этих документов (слуги и признаки приведены по корпусу, не по живому прогону).

## 13. Разбиение на куски (≤ 3 одновременно, файлы не пересекаются)

Порядок вливания: **К3 → К2 → К1**; **К3 вливается после незакоммиченной задачи удержания недугов**, потому что `docs/wiki/limitations.md` в рабочем дереве уже изменён ею (строка 22) — К3 только добавляет новые строки точечным `Edit`. Коммиты делает Руководитель. Живые прогоны строго по одному. Каждый кусок: `node --check` затронутых `.mjs`, профильные `node --test`, затем `node --test` целиком; Критик по диффу перед коммитом; не коммитить без явного указания. **Общих тест-файлов между кусками нет; у каждого куска свой живой сценарий.**

### К1. Лимиты использования — пункты 1, 2, 2б, 3, 8, 10A (+ живая проверка 9)
Файлы (только его):
- код: `scripts/builtin/impulse-gate.mjs` (строки `flourish`, `rage`, `rageTrait`, `freqText`, `inSpace`, `twoHands`; `ctxOf`, `clearFor`, `install` — сброс отдыха), `scripts/builtin/limit-text.mjs` (общий чистый код ярости: `breaksRage`, `raging`, `isRage`, пересечение прямоугольников для `inSpace`), `scripts/builtin/rage.mjs` (реэкспорт, `onMessage` — шёпот только без use-карточки), `scripts/rules.mjs` (**только** экспорт `freqEntry` рядом с `limitEntry`, ≈ стр. 2102), `scripts/cast.mjs` (**только** `export` у `clock` и, при необходимости, чистая `tracksFor` — две строки), `tools/use-limits.mjs`, `rules/use-limits.json` (генерируется `node tools/use-limits.mjs`);
- lang: `lang/ru/builtin.json` + `lang/en/builtin.json` (блок `limit` — **единственный** владелец);
- тесты: `tests/impulse-gate.test.mjs`, `tests/use-limits.test.mjs`, `tests/limit-text.test.mjs`, **`tests/builtin.pa-handlers.test.mjs`** (тесты `breaksRage`); живой — новый `tests/live/limits-rustyspirit.js` (сценарии `flourish`, `rage-impulse`, `rage-trait`, `freq-text`, `in-space`, `two-hands`, `scroll-list` — пункт 9).
Внутренний порядок: (1) оверлей `freq` + `freqEntry` + тесты; (2) общий код ярости в `limit-text.mjs` + строки `rage`, `rageTrait`; (3) `flourish`, `inSpace`, `twoHands`; (4) `freqText` + сброс отдыха; (5) lang; (6) живой.
Не трогать: `scripts/apply.mjs`, `scripts/condition-hold.mjs`, `scripts/turn-conditions.mjs`.

### К2. Реакции «враг уходит» — пункт 6
Файлы: `scripts/builtin/reactive-strike.mjs`, `lang/ru/reactions.json` + `lang/en/reactions.json` (раздел `reactions.leave.*`), тесты — **`tests/builtin.test.mjs`** (таблица `reactionOf`, `leaveTrigger`; нового файла не заводить) и живой `tests/live/leave-reach.js` (новый). Читает (не правит) `impulse-gate.mjs` (`whyNot`), `limit-text.mjs` (`raging` — после слияния К1; до него подсказку для `rage`-предметов собирать на локальной копии одной строки `actor.itemTypes.effect.some(e => e.slug === "effect-rage")`, заменить на импорт при слиянии), `hunt-prey.mjs`. `builtin/index.mjs` менять не нужно.
Граница: К2 не правит `builtin.json` — тексты в `reactions.json`.

### К3. Данные каталога и тексты — пункты 4, 5 (этап 1), 10B, 11 (+ строки limitations про пункт 7 и Superstition)
Файлы: `rules/catalog.json` (точечные `Edit` по строкам: 32 записи пункта 4 + DFF; **Elemental Instinct не вносится**), `tools/sustain-gaps.mjs` (новый), `lang/ru/rules.json` + `lang/en/rules.json` (подписи вариантов DFF), `docs/wiki/limitations.md` (только добавление новых строк, после слияния задачи удержания), тесты — новый `tests/catalog.rustyspirit-gaps.test.mjs` (только К3), живой — новый `tests/live/sustain-batch.js` (3 заклинания пункта 4 + DFF).
Читает: `rules/catalog.pa.json`, `catalog.model.json` (не править), `docs/dev/rules-format.md`. Порядок: пункт 4 (A) → DFF → B-список по тексту → limitations.
Проверка К3: `node tools/check-catalogs.mjs`, `node --test tests/catalog*.test.mjs tests/sustain*.test.mjs`.

### Не в этой волне
Этап 2 формы тёмного леса (`reshape` при Поддержании) — сделан (см. §5); раньше значилось «не делаем (решение §12)», затем — `scripts/sustain.mjs`, `scripts/rules.mjs`, `scripts/use.mjs`, `lang/*/sustain.json`, после К1 (пересечение по `rules.mjs`).

### Как не столкнуться на `lang/*.json`
К1 владеет `builtin.json` (блок `limit`), К2 — `reactions.json`, К3 — `rules.json`; других общих lang-файлов в волне нет. Новые файлы lang не заводить (правка `module.json` + рестарт сервера). Нужен ключ в чужом файле — оставить его текстом в отчёте, владелец внесёт.
