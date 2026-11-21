# План: долг `event-trigger` (89 записей, «к плану»)

Выгрузка и разметка — в scratchpad `.../scratchpad/et/` (`dump.mjs` — выгрузка по `debtByMechanism`, `cls.mjs` — разметка по имени, `cls.json` — uuid -> категория). Разметка ручная, по описанию (`descEn`), не по модели: границы «закрывается / не закрывается» — оценка, подтверждается модельным проходом (§3).

## 0. Главное

- `event-trigger` — не одна группа, а ключевое слово-«свалка»: алиасы `\btriggers?\b`, `triggered` ловят и «triggered save on X» (в `triggered-save` алиас `triggered save` отсутствует), и «trigger» из блока реакции. Реальных видов события ~12, ни один не набирает ~30.
- **Нового примитива под порог нет.** Закрывается существующим `onEvent` ~49 из 89 (55%); новых видов события — 21 запись в 4 видах (по 3–8), порог 30 не достигает ни один; 19 — не событие/нарратив.
- Рекомендация: (1) разбить ключ в `rules/mechanisms.json` (сейчас `primitive: null`, `owner: b04-reactions`) на `event-trigger` (остаток) и ключ с `primitive: "onEvent (…)"` для 49 закрываемых — тогда `debt-pool` берёт их в проход; (2) новых событий не строить, кроме дешёвого `item-use` (§2) по желанию; (3) 19+8 нарратива перевести в `skip`/narrative по правилу «сюжетное не автоматизируем».
- Состояние записей: все 89 `manual`, правила у 11 (частичные), в каталогах правил лежат 2 (Familiar of Parasitic Might — `catalog.json`, Nightmare — `catalog.model.json`; обе всё ещё `manual`).

## 1. Разбивка по виду события

| Вид события | Док. (все уникальны, 89 имён) | Закрывает `onEvent`? | Записи |
|---|---|---|---|
| Владельца ударили/нанесли урон (`damage-taken` self, effect-created) | 6 | да | Rancid Spore Pods, Disgusting Pustules, Bloodspray Curse, Achaekek's Clutch, Mercenary Reversal, Link Fates* |
| По владельцу атакуют/касаются (`attack-roll` side target) | 8 | да (как `onAttacked`) | Come and Get Me, Crescent Scepter, Orbiting Runestone, Forgefather's Seal, Electrify Armor, Spirits' Interference*, Wilding Word*, Defended by Spirits* |
| Удар/урон владельца по цели (`attack-roll`/`damage-roll` self, `when`: исход, черты цели) | 13 | да (passive hit trigger, Exception 3 промпта) | Palytoxin, Meditate on This!, Disorienting Venom, Ricochet Legend, Claim the Field, Channel Divine Spark, Peerless under Heaven, Guerrilla Assault*, Prayer Attack*, Vine of Roses, Hunter's Dawn*, Winning Streak*, Bloody Guillotine |
| Падение до 0 ПЗ/смерть (`damage-taken:hp0`: self — коммит 520e6fe; чужое — side origin, `plan-youre-next.md`) | 5 | да | Executioner's Volley*, Frightful Attrition, Thick Skin*, Meld into Eidolon, One with the Spirits |
| Сотворение (`spell-cast` self/target/near, `spell-sustain` у фамильяра) | 9 | да | Corruption Cassock, Divinity Leech, Mask of the Cursed Eye, Animus Mine, Spellwrack*, Rend Magic, Foretell Harm, Familiar of Parasitic Might, Seize Identity* |
| Ход/эффект (`turn-start/end`, `effect-created/deleted`, near) | 7 | да | Bloody Tendrils*, Covering Stance, Echoing Weapon*, Euphoric Renewal, Nightmare, Forbidden Thought*, Companion's Shadow* |
| Использование действия/предмета (Прыжок/Leap, Shield Wallop, move, съесть, Блок щитом) | 5 | нет — `item-use` | Devastating Shield Wallop, Kaiju's Footfalls, Ghosts in the Storm, Brandish the Gorgon's Gaze (есть `builtin/shield-block.mjs`), Hag's Fruit |
| Результат контрзаклинания (counteract успешен) | 3 | нет; частично — исходы `counterspell.mjs` | Dawnlight (Major/Greater), Detonate Magic |
| Взгляд/присутствие/касание (брандиш предмета, зеркало, «увидел») | 8 | нет, и не вычислимо | 5 вариантов вампира, Mirror of Sorshen, Know I Approach, Graveknight Empty Save for Dust |
| Объект/зона (открыть дверь, взять предмет, пройти сквозь) | 5 | нет; зоны `zone.triggers` — часть | Bandit's Doom, Temporal Ward, Bridge of Vines, Devil's Horseshoe, Temporary Glyph |
| Не событие: пассивка, нарратив, режим, повтор, стойка | 19 | — | Play Fatesnatcher, Curse of the Werecreature, Saurian Spike x3 (пассивный бонус), Whispering Remnant, Energetic Meltdown, Suspended Retribution, Duelist's Form, Fated Duel, Klingegeist, String of Fate, The Carnival, Clockwork Devotion, Whispering Spirit Tome, Serpentstone Breath (повтор `repeat`), Sea Glass Guardians, Battlefront Sabotage, Hallucinogenic Ink |
| До броска чужой проверки (hold, реакция) | 1 | `hold` есть у attack-roll/skill-check, side target | The Deck of Destiny |

`*` — закрывается частично или нужна проверка: событие есть, но часть эффекта (эффект на двух целях, Intercept, «следующее действие цели», «первое за раунд/в сражении», сторона «компаньон») — отдельное решение. Ожидаемый выход модельного прохода с таким долгом — около половины (`markup-derive-unreliable`): ~20–25 правил из 49.

Закрыто уже сейчас: 48 + Deck of Destiny. «Сейчас» значит: вид события есть в `EVENT_ON` (`rules.mjs:685`), `side` (`self/target/origin/near/familiar`), `when` с `damage-taken:hp0`/`outcome:*`/`item:slug:*`/`origin:enemy`, `cost:"reaction"`, `use:true`, `afterUse`, `challenge`, `check`. pf2e сам это не делает: у pf2e нет хука «действие использовано», «потребил» или «прыжок» — только `pf2e.startTurn/endTurn/damageRoll/reroll/restForTheNight` и броски `action:leap|high-jump|long-jump` (`pf2e.mjs:113220, 113279`, только у проверок Атлетики).

## 2. Новые виды события — проект (необязательно, ниже порога)

Ни один вид не набирает 30; по §7 ROADMAP мельче — долг до новых сущностей. Единственный дешёвый и общий: `item-use` (5 записей, но класс шире: все карточки действий/черт/расходников — больше сущностей вне долга `event-trigger`).

**`item-use`** — событие «карточка использования предмета/действия опубликована»:
- Хук: уже подписанный `createChatMessage` (`events.mjs:863`, `onMessage`). Сообщение карточки: `flags.pf2e.origin {type, uuid}` без `context` — так же ловится `spell-cast`. Расширить ветку `spell-cast` на `origin.type` в `action|feat|consumable|equipment`.
- Поля: `{"on":"item-use","side":"self","when":["item:slug:leap"|"item:trait:move", …],"afterUse"?,"cost"?}`; в `EVENT_ON`, `EVENT_AFTER_USE`, `EVENT_TARGETED` (без цели — нет).
- §1.1: реакция — `cost:"reaction"`; обход Alt — как у остальных записей; дальность — `range` у near. §1.5: условия через `when` (черты предмета, `origin:enemy`), без переключателей.
- Прыжок: для Leap/High Jump/Long Jump сообщение карточки действия; точка приземления — `moveToken` (`events.mjs:869`), окончание движения владельца. Для Kaiju's Footfalls («первый раз за ход») — `per:"turn"` уже есть у near; для self проверить.
- lang: `workshop`/ошибки `ev.on` ru+en (ключи там, где уже перечислены события); `sheet.badge.event` существует.
- Тесты: юнит в `tests/` (валидатор `rules.mjs` и сопоставление сообщения — по образцу `tests/death-event.test.mjs`), живой прогон на копиях «Тестовые копии (автоматизация)» — Shield Wallop, Leap.
- Размер: ~100–150 строк кода, 1 тестовый файл.

Не строить: `counteract-result` (3 записи; разбор исхода уже есть в `counterspell.mjs` — вернуться, когда появятся ещё контрзаклинания), `sight` (брандиш предмета/зеркало/«увидел» — нет объекта в игре, narrative), `object-zone` (объекты — открыть дверь, взять предмет — не вычислимо; зоны — ветка b06).

## 3. Что переводится сейчас (без нового кода)

1. Список uuid 49 записей: `scratchpad/et/cls.json`, поле `cat` ∈ {hit-self, attacked, strike-out, death, spell, turn-effect} + Deck of Destiny (нет категории — добавить). Файлы-источники: `b01-save-conditions.json` (57 из 89), `b02-self-ally-effects.json` (21), `b03-attack-check.json` (5), `b04-reactions.json` (4), `b06`, `b07` по одной.
2. Перевод — модельный проход (Sonnet, не Haiku — `markup-derive-unreliable`): `node tools/debt-pool.mjs --uuids <файл> --prefix mdebt4`. Промпт `tools/prompts/draft-rule.md` уже знает `onEvent` (passive hit trigger, self-death, `near`, `spell-cast`). Скриптом не получится: правило зависит от текста (кто бросает, СЛ, исход).
3. Условие запуска: `--uuids` берёт выбранные записи, не глядя на статус. Если нужен обычный пул — завести в `mechanisms.json` ключ с `primitive` (правка словаря — в зоне Руководителя).
4. 19 «не событие» + 8 `sight` + 5 `object-zone` — не в пул: пометить `skip`/narrative с причиной. Серия `Saurian Spike` — пассивный бонус, отдельным ключом `mods-conditional`.

## 4. Куски (непересекающиеся файлы)

| Кусок | Файлы | Размер | Зависимость |
|---|---|---|---|
| K1. Разбить ключ `event-trigger` в словаре, добавить ключи для закрываемых | `rules/mechanisms.json`, `tools/mechanisms.mjs` (алиасы, при необходимости), `tests/mechanisms*` | малый, ~30 строк | нет |
| K2. Модельный проход по 49 (Sonnet), разбор Критиком, `validate --final` | `tools/out/*` пул/ответы, `rules/drafts-accepted/*`, `rules/catalog*.json` | средний, 2 пула по ~25 | после K1 (или через `--uuids` сразу) |
| K3. Разметка 19+8+5 как narrative/skip | `rules/drafts-accepted/b01…b03.json` (причины) | малый | независим, но те же файлы, что K2: делать после K2 |
| K4. `item-use` (по желанию) | `scripts/rules.mjs`, `scripts/events.mjs`, `lang/ru.json`, `lang/en.json`, `tests/item-use.test.mjs` | средний, ~150 строк + живой прогон | независим от K1–K3 |
| K5. Закрытие остатка `*` (аспекты: `damage-taken` side target/victim-effect, `spell-sustain` не только у фамильяра, сторона «компаньон») | `scripts/rules.mjs`, `scripts/events.mjs` | средний; реальный объём — после K2 | пересекается с K4 по файлам — после него |

## 5. Открытые вопросы

- Разбивать ли `event-trigger` в словаре (K1) или оставить «свалку» с владельцем b04 и вести проход только через `--uuids`.
- Нужен ли `item-use` ради 5 записей: общий класс шире, но порог §7 не набран. Мое предложение — отложить.
- Отнесение «Сюжетное»: вампирьи уязвимости (5 записей), Mirror of Sorshen, Know I Approach — подтвердить как narrative.
- Разметка ручная и по одному описанию: перед K2 стоит проверить 10–15 записей `*` на самих `rules/drafts-accepted/*` (поле `rule` есть только у 11).

## Итог (2026-11-16)
Модельный проход Sonnet по 49 «закрываемым» (`mdebt4-01/02`) дал 2 правила on-use (Winning Streak, Mercenary Reversal), событийных — 0. Разбор Критика по выборке 12: полностью выражается 1 (Disorienting Venom), частично 7, нет 4 — оценка «~49 закрываемых» была оптимистичной. Причины: у события один «другой» участник (нет «всех смежных существ»), `spell-cast` с `side:"near"` разрешён только с `counter`, триггер на цели (правило живёт у владельца), нет эффекта-ворот длительности, временных ПЗ и накопления состояний. Ответы приняты `validate --final` (записи остаются долгом с уточнёнными ключами). Служебный ключ `event-onevent` и привязка ключа по uuid убраны; в промпте снято противоречие строки «linked effect LATER» с Exception 5. Новые формы ради этой группы не делаются (ни одна потеря не набирает порога 30). K3 (разметка narrative) и K4 (`item-use`) — не делаются.
