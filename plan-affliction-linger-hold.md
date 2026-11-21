# affliction: примитивы `linger` и `hold` — пересчёт, проект, куски (план v2 после Критика, кода нет)

Опора: `plan-affliction.md` §4 (рантайм), `plan-affliction-text.md` §0/§4, `plan-affliction-stage-text.md`; рантайм — `scripts/affliction.mjs` (чистая часть), `scripts/affliction-run.mjs` (носитель, `applyStage`, часы, хуки). Скрипты пересчёта — в scratchpad `.../scratchpad/ah/` (`b.mjs` — словарь через `debtByMechanism`, `d.mjs`/`f.mjs` — скан текста, `ling-scan.json`, `hold-scan.json`).

## 0. Вердикт

- **`hold` проходит порог** (≥ ~30 документов, ROADMAP §7). По пересчёту Критика: **H1 (состояния) 45 док. / 22 имени**, **H2 (нижняя граница стадии) 13 / 7**; вместе 58 док. Мой скан давал 38/22 и 16/10: имена H1 совпали (22), число документов у меня меньше — моя регулярка уже (не ловила часть формулировок «can't recover from…»); в H2 я включал Wendigo/Weredigo («пока не здоров по ОЗ» — другое условие, не лечение недуга) и считал Cold Rot/Expeditious отдельно. **Принимаю цифры Критика**; точный состав перед работой пересчитать скриптом H-A. H1 один проходит; H2 один (13) порога не проходит, но делается тем же куском (§3.4) — надбавка, не примитив.
- **`linger` порог не проходит.** Настоящий остаточный срок — **22 док. / 18 имён**; остальные 20 из «42» — «навсегда» (13 сюжет, 7 «окаменел/ослеп навсегда» — правка конвертера без рантайма). Текст по корпусу — не больше 35 док. / 29 имён (верхняя граница). **Предлагаю долгом**; проект §4 готов, если пользователь решит иначе (решение 6 `plan-affliction-text.md` §0 велело `linger` первым — принято до пересчёта и до порога 2026-10-26).

## 1. Пересчёт

Метод: словарь — `debtByMechanism(readModelAccepted(), items)` (совпало с `coverage.md`: linger 42, hold 32); текст — 837 документов-недугов `items.json` (`Stage 1`+`Stage 2` и Saving Throw/Onset/Maximum Duration/трейт), регулярки по `descEn` без ссылок, чтение выборки. Единица — документ (копия NPC = документ).

### 1.1 Расхождения чисел
- **linger 39 (ROADMAP) / 42 (словарь)**: 42 записи долга `affliction: linger` (33 имени); откуда 39 — не выяснял. По смыслу 42 = 22 + 20 (§1.3).
- **hold 24 / 32 (словарь) / 64 (скан) / ≈95 (план недугов)**: словарь (`mechanisms.json` `rule`) ищет `(can.t|cannot) be (reduced|removed|healed|cured)` только в JSON правила partial-записей: не видит «can't recover from», «can't end», «cannot be reduced»; считает запрет **лечения** (9 док./6 имён — это `healing-modifier`) и шум (Blightburn Blast, Dance of the Tiger, Blood Chestnuts). Состав 32: состояния 10, нижняя граница стадии 10, запрет лечения 9, шум 3. «64» — скан по корпусу, много документов вне недугов (Resurrect, Raise Dead: «can't be…») — шум. «≈95» считало «нельзя снять» вместе с запретом лечения и сюжетным; не воспроизводится.

### 1.2 hold — подвиды (недуги)
| Подвид | Что держит | Док. / имён | Статус записей |
|---|---|---|---|
| H1 состояние нельзя снять/снизить, пока недуг не излечён/идёт | «sickened/drained/frightened/fatigued/clumsy… from X can't be removed/reduced/recover» (Daylight Vapor, Fearweed, King's Sleep, Taster's Folly, Alcohol, Azarpal «не ниже 1», Carrion Fever, Isqulugia, Filth/Putrid/Zombie Plague, Apoxia ×2, Mortasheen, Abyssal Plague, Crystal/Crystalline Corruption, Incite/Internal Insurrection, Bone Moth, Divine Plagues) | **45 / 22** (Критик) | partial, **ok 3** (Bone Moth, Divine Plagues, Internal Insurrection — запрет, похоже, потерян молча), debt (другие стены) |
| H2 нижняя граница стадии | «can't be reduced below stage 1 … until treated with Cleanse Affliction»: Blackfrost ×4–5, Bog Rot ×5, Sand Rot, Cold Rot, Expeditious Evolution | **13 / 7** (Критик) | partial / debt |
| H3 запрет лечения урона | Mummy Rot-семейство, Rancid Bloat, Blinding Rot, Oil Rot | 9 / 6 | **не hold** — к `healing-modifier` |
| вне | Bloodeye Coffee (fatigued не от недуга — заметка), Najra, Blood Chestnuts, Dance of the Tiger, Wendigo/Weredigo («пока ОЗ не полные») | — | заметка / долг |

Режимов два: **keep** — не снижать ниже значения стадии и не снимать («can't be reduced», «can't recover from», «can't end or be reduced»); **present** — не снимать, снижать можно до 1 (Azarpal «cannot be reduced below 1»).

### 1.3 linger — подвиды (долг `affliction-linger`, 42 записи / 33 имени)
| Подвид | Текст | Док. / имён | Что нужно |
|---|---|---|---|
| L1 переживает недуг | «drained/enfeebled/clumsy persists after the poison's duration ends» (Death Drider, Yellow/Grey Mold, Foodborn, Ash Web, Nethershade «24 hours», Enhanced Hunting Spider «24 hours», Itchy Rash «1 hour») | 9 / 8 | состояние живёт после конца недуга |
| L2 убывает раз в час | «Drained value is reduced by 1 every hour» (Iron Golem ×3, Guillotine, Iron Warden, Gold Defender; Ash Web также) | 6 / 4 | почасовой тик, остаток после конца недуга |
| L3 собственный срок состояния | «Paralyzed for 1 hour», «Confused for 1 minute», «–4 to Will vs Coerce for 1 hour» при сроке стадии в раунд (Butchering, Nightmare Salt, Grave Blight ×2, Osyluth, Phantom Blight, Cold Rot) | 7 / 6 | срок состояния ≠ срок стадии, переживает смену стадии |
| L4 навсегда, автоматизируемо | «permanently petrified/blinded» на последней стадии (Gorgon's Breath, Blinding Sickness, Crystal Corruption ×4, Crystalline) | 7 / 4 | правка конвертера: последняя стадия конечная без `maxDuration` (как «смерть», решение 3); рантайм не нужен; запрет снять — `hold` H1 |
| L5 навсегда, сюжет | превращение, подчинение, амнезия, «конечность непригодна», «+1 СЛ» (Amnesia ×2, Gongorinan ×2, Rotting Gift, Digest Mind, Regenerative Blood, Curse of the Frozen Heart, Red Drip, Slime, Bower Fruit, Weredigo, Midnight Milk) | 13 / 11 | заметка; не автоматизируем |
| **Итого** | | **42 / 33** | L1–L3 настоящий: **22 / 18**; с L4: 29 / 22 |

## 2. Что делает pf2e (`pf2e.mjs`, версия **8.7.0**; в плане v2 — 8.6.1, номера строк сдвинулись)

- Тип `affliction`: `AfflictionPF2e` (`:49246`) конструктор **безусловно бросает** «Affliction items are not available in production builds» (`:49251`). `handleStageChange` (`:49336`) не трогает набор `Bl` (`:49245`: frightened/sickened/drained/doomed/stunned/unconscious) — без нас ничего не работает. Остаточного срока и «держать» у pf2e нет.
- **Для hold есть готовое на удаление обёрнутых состояний:** GrantItem `onDeleteActions: {grantee: "restrict"}` — `processGrantDeletions` (`:45498`) отменяет удаление с предупреждением «RemovalPrevented»; `isLocked` (`:49442`) прячет снятие на листе. Модуль уже использует: `createTimed` (`apply.mjs:93`); `reduceCondition`/`removeCondition`/`frightenedPlan` пропускают `isLocked`. Это **не дублируем**: для состояний в обёртке (clumsy, enfeebled, stupefied, slowed, paralyzed, fatigued…) удаление pf2e уже запрещает.
- Чего pf2e не даёт: (а) шесть `Bl` и `ENDS_EARLY` (`util.mjs:13`) модуль поднимает **без обёртки** (`applyStage`, путь `UNLINKED`) — их можно снять и снизить; (б) `restrict` не мешает **уменьшить значение** (HUD правый клик `:112374` → `updateConditionValue` → `item.update`); (в) ночной отдых pf2e снижает drained/doomed (`:25911`).

## 3. Проект `hold` (рекомендуется)

### 3.1 Запись (форма и валидатор)
`def.holds: [{slug, mode?, from?}]` на уровне недуга, ≤ 6, slug — состояние (`SLUG`), уникальны; `mode` ∈ `"keep"` (по умолчанию) | `"present"`; `from` — целое ≥ 1, с какой стадии запрет действует (Bone Moth's Kiss — `from: 3`). `def.stageLock: true` (H2, §3.4). **`vAffliction` (`rules.mjs:340`) собирает `def` явным списком — молча отбросит незнакомый ключ: добавить `holds`/`stageLock` в сборку и разрешённые; ошибки `afflict.holds`.** Состояние из `holds` должно встречаться хотя бы у одной стадии с номером ≥ `from` — иначе предупреждение в `semanticErrors` (`tools/validate.mjs`).
Примеры: `[{"slug":"sickened"},{"slug":"unconscious"}]` (Filth Fever), `[{"slug":"sickened","mode":"present"}]` (Azarpal), `[{"slug":"drained","from":3}]` (Bone Moth's Kiss).

### 3.2 Толкование (решение Руководителя)
**floor = значение состояния в ТЕКУЩЕЙ стадии** (`c.value` стадии; для `present` — 1), не максимум за всё время и не текущее значение актёра. Стадия без этого состояния (или номер < `from`) — запрета нет, запись `held[slug]` удаляется. Смена стадии меняет значение по тексту стадии: `applyStage` выставляет удерживаемое состояние **точно** до значения стадии (в том числе вниз) внутри `unchecked`. Запрет — только на ручное/постороннее снятие и снижение **ниже floor**; повышение свободно.

### 3.3 Рантайм (новый `scripts/condition-hold.mjs`; имя `hold.mjs` занято — удержание атаки Sanctuary)
- **Что держим — конкретный предмет:** `meta.affliction.held = {slug: {floor, id}}`, `id` — id документа состояния на актёре. Для `UNLINKED` (bare-путь, `applyStage` уже так делает) — документ, поднятый/созданный стадией; для состояний в обёртке — условие, выданное обёрткой этой стадии (находится после `createEmbeddedDocuments` по `grantedBy`; `id` переписывается при смене стадии вместе с обёрткой). Запись **заменой** (`forcedReplace` из `util.mjs` на `flagPath("meta","affliction","held")` или явное поле), не слиянием: update сливает объекты, и удалённый slug иначе остался бы floor-ом (откат/смена стадии).
- **Bare-путь — только для `UNLINKED`.** Состояния в обёртке не переводим на bare: pf2e (`restrict`) уже не даёт их удалить; для них нужна только проверка **снижения значения**.
- **Хуки** (клиент инициатора, синхронно; образец `melee-reach.mjs`/`impulse-gate.mjs`: предупреждение, Alt, `unchecked`):
  - `preDeleteItem(item)` — только для `UNLINKED`-состояний: у актёра есть носитель с `held[slug].id === item.id`;
  - `preUpdateItem(item, changes)` — для любого held (обёрнутые тоже): `system.value.value` < `floor`;
  - ~~не блокировать, если после операции у актёра остаётся **другой** экземпляр этого slug со значением ≥ floor~~ — отменено после Критика 2026-11-20: копия другого источника кончается раньше недуга, обход — Alt; floor относится только к удержанному документу (`floorOf(actor, slug, id)`);
  - **Alt и тост — только при клике пользователя** (`userId === game.user.id`, не флаг модуля). Операции без клика (сокет ГМа `callGM`, другой модуль, конец хода, ночной отдых): отменять молча или **одним тостом за ход**, без Alt.
  - `unchecked(actor, fn)` / опция `[MOD].held` — для своих операций.
- **Два недуга на одном slug:** у каждого своя запись `held`. Если носитель удаляется, а состояние создал он, но держит и другой носитель (`held[slug].id` совпал) — в `deleteItem` хуке до `removeByKey(affl:<slug>:)` переписать `meta.key` состояния на ключ живого носителя и не удалять (иначе каскад снимет чужое удержание). **Сирот не оставлять:** запись `held` с id, которого уже нет (обёртка истекла/удалена), игнорируется и вычищается при чтении; следующая стадия поставит её заново.
- **Модуль не предлагает невозможного, а ограничивает:** `frightenedPlan`/`retchPlan` (`turn-conditions.mjs`) и `reduceCondition` (`apply.mjs`) — `to = max(to, floor)`, не запирают; при `keep` шёпот «Избавиться» от тошноты (`turn-conditions.mjs:62`) не выкладывается (при `present` — выкладывается, снижение упирается в 1).
- **Откат:** `held` пишется заменой; `afflictionUndo`, `afflictionUnmake`, `undoOps` (`apply.mjs:873-874, 919`) и авто-откат при перебросе (`events.mjs:748`) оборачиваются в `unchecked`. Тест: после отката floor снят, состояние уменьшается без предупреждения.
- **Ночной отдых pf2e** (`:25911`, снижает drained) — ограничение в README; карточку отдыха не правим. Клик ГМа по бейджу носителя (лечение) блок не затрагивает.
- Режим `mode.limits=off` отключает блок (CLAUDE.md §1.1).

### 3.4 Надбавка H2 (`stageLock`)
`startMeta` (`affliction.mjs:46`): `locked: !!def.stageLock`. `advance(stage, delta, def, locked)`: при `locked` и `n ≤ 0` — `{stage: 1, cleared: false, locked: true}`; `applyDelta` передаёт `m.locked`. **Без новой кнопки:** на карточке успешного спасброска на стадии 1 строка «Лечение не проведено — стадия не опускается ниже 1; после лечения снимите носитель кликом по бейджу» (путь снятия — хук `updateItem` бейджа/ручное удаление, `affliction-run.mjs:259`). Автоопределение Cleanse Affliction/remove curse — вне плана.

### 3.5 Строки (lang ru/en, термины pf2ru; названия состояний — pf2e `PF2E.ConditionType*`)
- `builtin.hold.blocked`: ««{cond}» нельзя {how}, пока не излечён недуг «{affliction}». Alt при клике — решение ГМа.»; `how` — «снять»/«уменьшить» (`builtin.hold.how.*`).
- **Имя в строках — имя исходного предмета** (`fromUuidSync(m.origin)?.name`), иначе имя носителя; **не `def.name`** (английский снимок).
- `affliction.holds` («держит»), `affliction.stageLocked`, поле Мастерской «Держит состояния» (`from`, `mode`).
- **Общий долг (отдельной строкой):** карточки недугов (`say`, `card` title в `affliction-run.mjs`) тоже берут `def.name` вместо имени предмета (CLAUDE.md §2.1) — править сразу для всех карточек недугов, отдельной задачей, не только hold.

### 3.6 Миграция
Записи каталога собирает `tools/affliction-batch.mjs`; миграция = парсер в `tools/affliction.mjs` (регулярки: «`<cond list> condition(s) (from|caused by) … can't (end|be removed|be reduced|recover…) (while|until|as long as) …`» → `holds` (`from` — по стадии, где состояние впервые названо; Bone Moth — 3), «can't be reduced below stage 1 … treated» → `stageLock`). Строка `GROUPS` «нельзя снять» убирает запрет из заметки только там, где разобран весь запрет; остальное — прежняя заметка. Затем `node tools/affliction-batch.mjs` без `--write`, сравнить с базой; выборка Критика по группе (решение 4 `plan-affliction-text.md`); затем `--write --groups`. Три `ok`-записи (Bone Moth и др.) — сначала проверить, не потерян ли запрет; если да — вернуть в partial. Bloodeye Coffee — заметка. `rules/mechanisms.json`: `hold` → `primitive`, `rule` сузить; запрет лечения (H3) → `healing-modifier`. Каталоги `rules/` руками не править.

### 3.7 Тесты
- node `tests/affliction.hold.test.mjs` (схема, парсер) и `tests/condition-hold.test.mjs` (рантайм, чистая часть). Схема: `vAffliction` — holds (форма, дубль, лишний ключ, `mode`, `from`). Парсер: 12 реальных текстов (Filth Fever, Putrid Plague, Azarpal, Fearweed, King's Sleep, Carrion Fever, Isqulugia, Abyssal Plague, Bone Moth, Bog Rot, Blackfrost; отрицательные: Mummy Rot «can't be healed», Najra, Bloodeye Coffee). Рантайм: floor = значение текущей стадии (стадия без состояния — нет запрета; `from`); `held[slug]={floor,id}` заменой; не блокировать при другом экземпляре ≥ floor; два недуга на одном slug и каскад (переписан ключ, состояние не удалено); осиротевший id; `to = max(to, floor)` в `frightenedPlan`/`retchPlan`/`reduceCondition`; нет шёпота при `keep`; `advance(…, locked)`; `startMeta.locked`; решатель блока (клик/Alt, не клик — без Alt, `unchecked`, `undo`); откат снимает floor.
- живой `tests/live/affliction-hold.js` (копии «Тестовые копии (автоматизация)», после прогона убрать; сцену «Тест» не трогать): Filth Fever-подобный def — стадия 2 → sickened 1, снять из HUD → предупреждение; Alt → снимается; снижение ниже floor блокируется (обёрнутое clumsy — только снижение, удаление держит pf2e); смена стадии выставляет значение вниз; конец хода не снижает frightened ниже floor; King's Sleep: отдых не защищён (ограничение); лечение (удаление носителя) → состояние снимается; откат; Azarpal 3→1 можно, 1→0 нельзя; два недуга на одном slug; H2: успех на стадии 1 — строка на карточке, стадия остаётся.

## 4. Проект `linger` (если пользователь решит делать; по порогу — долг)

Два независимых поля, оба используют `createTimed`/часы; новых носителей не нужно.
- **L3 `stage.conditions[].for: {value, unit}`** — срок состояния ≠ срок стадии. `applyStage` для такого состояния зовёт `applyCondition(…, duration)` с ключом `lng:<slug>:<cond>:<n>` (не `affl:<slug>:` — не удаляется ни со сменой стадии, ни с носителем: хук `deleteItem` чистит только `affl:<slug>:`). Идемпотентно по ключу; откат — `made`.
- **L1/L2 `def.after: [{slug, for?: {value,unit}, decay?: "hour"}]`** — остаются после **естественного конца** (`tickItem` ветка `end`), не после снятия лечением/ГМом. Вместо `item.delete()` носитель переходит в фазу `meta.affliction.residual = {until, nextAt}`: стадии снимаются (кроме `after`), `endsAt` = конец остатка; `decay` — почасовой тик в `tick` (значение −1, на 0 удалить носитель). Переиспользует `track`/`sweep`/`updateWorldTime` и откат носителя.
- Валидатор: `for` — `vAfflDur`; `after` ≤ 4, slug из стадий; не вместе с `holds` того же slug.
- Конвертер: L1 «persists after the poison's duration ends [for N]», L2 «value reduced by 1 every hour», L3 «<Cond> N for <срок>» при сроке стадии короче; L4 — последняя стадия «permanently <cond>» без `maxDuration` (в конвертер сейчас, не linger); L5 — заметка.
- Тесты: node (`dueOf` фазы, decay 3→0, `for` и смена стадии, ключ `lng:`); живые: Iron Golem Poison (−1/час), Nethershade (24 ч), Butchering Venom.
- Строки: `affliction.residual`, `affliction.decayed`; поле Мастерской. Долг: вернуться, когда `after`/`for` встретятся в ≥ 30 документах.

## 5. Куски (непересекающиеся файлы)

`hold`:
| Кусок | Файлы | Размер |
|---|---|---|
| **H-A схема и парсер** | `scripts/rules.mjs` (`vAffliction`, ошибки), `tools/affliction.mjs` (парсер holds/stageLock, `GROUPS`), `tools/validate.mjs`, `tests/affliction.hold.test.mjs` | ~130 стр. + 100 тест |
| **H-B ядро запрета** | `scripts/condition-hold.mjs` (новый: чистая `heldFloor`, решатель блока, хуки `preDeleteItem`/`preUpdateItem`, `unchecked`, переписывание ключа при каскаде), `scripts/main.mjs` (init), `tests/condition-hold.test.mjs` | ~140 стр. + 110 тест |
| **H-C интеграция в недуг** | `scripts/affliction.mjs` (`startMeta.locked`, `advance`, `stagesText`), `scripts/affliction-run.mjs` (`applyStage`: bare только `UNLINKED`, точное значение стадии, запись `held` заменой, `unchecked` в undo/unmake; `applyDelta`; хук `deleteItem` каскад; строка на карточке H2), `tests/affliction.hold-run.test.mjs` | ~90 стр. + 60 тест |
| **H-D соседние потребители** | `scripts/turn-conditions.mjs` (`max(to, floor)`, нет шёпота при `keep`), `scripts/apply.mjs` (`reduceCondition`; `unchecked` вокруг `undoOps` `:873-874, 919`), `scripts/events.mjs` (авто-откат `:748` в `unchecked`), тесты этих мест | ~50 стр. + 50 тест |
| **H-E строки, Мастерская, README** | `lang/ru/*.json`, `lang/en/*.json`, `scripts/workshop/affliction-edit.mjs`, `README.md` (отдых pf2e, whole-slug, Alt только при клике) | ~60 стр. |
| **H-F миграция** | `tools/affliction-batch.mjs`, `rules/mechanisms.json`, затем `rules/drafts-accepted/*` и `rules/catalog.model.json` через `--write --groups` после Критика | ~40 стр. + прогон + выборка |
| **H-G живой прогон** | `tests/live/affliction-hold.js` | ~140 стр. |

Порядок: **A ∥ B** (договорённость о форме `held[slug]={floor,id}` и `def.holds`), затем **C и D** (C после A+B; D после B, файлы разные), **E** после A, **F** после A, C, затем **G** последним. H2 (`stageLock`) — подпункт A (парсер) и C (`advance`, строка); можно отложить без влияния на остальное. Размер hold: ~510 стр. кода, ~320 стр. теста (больше v1: ядро разделено, добавлены потребители D и каскад).

`linger` (если делать): L-A схема/парсер, L-B рантайм, L-C строки/Мастерская, L-D миграция, L-E живые. Пересекается с H-A, H-C по `rules.mjs`, `affliction-run.mjs`, `affliction.mjs` — **после** hold. ~230 строк кода.

## 6. Открытые вопросы пользователю
1. `linger` не проходит порог (22 док.; 29 с «окаменел навсегда»). Долгом (рекомендую) или делать вопреки порогу (решение 6 `plan-affliction-text.md` §0)?
2. `stageLock` (13 док., без кнопки, снятие кликом по бейджу) — брать или оставить заметкой?
3. Три `ok`-записи с текстом запрета (Bone Moth's Kiss, Divine Plagues, Internal Insurrection): запрет мог потеряться молча — вернуть в partial до `hold`?
4. Запрет лечения урона недуга (H3, 9/6) — к `healing-modifier`, подтвердить.
5. Общий долг: имя на карточках недугов — `def.name` вместо имени предмета; отдельная задача.

## 7. Решения Руководителя после перепроверки (обязательны для реализации)
1. «Клик пользователя» не различаем: как в `scripts/builtin/melee-reach.mjs` — Alt зажат в момент операции → пропуск, иначе отмена с предупреждением; свои операции модуля — через `unchecked()`. Автоматические снижения (`frightenedPlan`, `retchPlan`, `reduceCondition`) защищены `to = max(to, floor)`, а не хуком.
2. Валидатор `holds`: только слаги, которые hold реально держит (`UNLINKED` ∪ обёрнутые `restrict`); слаги `ENDS_EARLY` без `UNLINKED` (prone, confused, fascinated, restrained, grabbed, immobilized, wounded, dying) — ошибка валидатора.
3. Откат: `held` восстанавливается из снимка именно заменой (`forcedReplace`), не частью слитого `meta.affliction` (`affliction-run.mjs:153`, `:170`); тест — slug, появившийся на новой стадии, после undo исчезает из `held`.
4. Тест H-B: смена стадии у обёрнутого состояния — старый `id` не держит, новый держит; после замены в `held` нет старых slug.
5. `stageLock`: критерий «решение ГМа не откатывается снимком» снят (снятие = удаление носителя).
