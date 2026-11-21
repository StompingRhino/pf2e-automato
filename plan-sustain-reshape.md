# План: «Изменить выбор» при Поддержании (`onUse.reshape`) — этап 2 Формы тёмного леса

Статус: только план, код не правился. Ревизия 2 (после Критика). Пересечения: `scripts/rules.mjs`, `use.mjs`, `apply.mjs`, `sustain.mjs`, `main.mjs`, `lang/*/sustain.json`, `lang/*/rules.json`, `rules/catalog.json` (запись DFF), `docs/dev/rules-format.md`. Параллельные исполнители правят `affliction*`, `condition-hold`, `vision`, `catalog.json`, lang — править точечным `Edit`, после них.

## 1. Группа по признаку (CLAUDE.md §1.4)

Метод: скрипт по `tools/out/items.json` (`items[]`, `descEn`; типы spell/feat/action; HTML и `@UUID` вырезаны; предложения со `sustain` + одно из `choose|change|switch|different|either|select|instead|each time you sustain`) → 139 документов с шумом, разобрано вручную. Скрипт одноразовый (scratchpad), метод воспроизводим по этому описанию.

**(а) Смена эффекта/облика/режима, который держится между Поддержаниями** — механизм `reshape`: ~10 документов заклинаний: Darkened Forest Form (`BhJtCTLbngvZm8EA`), Spellsurge (`XIgvCPaSy5WXStVD`), Mantle of the Frozen Heart (`CcXtbTxtdV9MKQfu`), Mantle of the Magma Heart (`j2kfNBFpLa0JjVr8`), Threefold Aspect (`MNiT0dHol5fEcKlz`), Draconic Barrage (`S6Kkk15MWGqzC00a`), Control Sand (`oahqARSgOGDRybBQ`), Metamorphosis (`pswdik31kuHEvdno` + дубль в `claws-of-the-tyrant-bestiary`). Смежные (feat/иное, не тот же механизм): Transcend the Azimuth, Rapid Switch, Multifaceted Will, Helpful Wood Spirits, Musical Shift, Animal Vision — 4–7 документов. В `catalog.json` из группы только DFF.
**Решение пользователя:** записи остальной группы (а) — после живой проверки DFF, пачкой; не в этом плане.

**(б) Выбор действия/ветки на каждое Поддержание** (Spiritual Guardian 3 дока, Spiritual Weapon/Armament, Dancing Blade, Spirit Object, Scouting Eye и др. ~25; «эффект на раунд в области»: Storm Lord, Impaling Briars, Storm of Vengeance, Wrathful Storm — 11). Другой механизм (нет эффекта на замену, разовое действие раунда). **Вне этого плана** (решение пользователя).

## 2. Как устроено сейчас (факты из кода)

- **Якорь/Поддержание** (`sustain.mjs`): якорь на авторе с ключом `anchorKey(msgId)`; `run()`/`onMessage` → `count()` пишет `anchor.flags.sustain.last = pos` и зовёт `sustained`-слушателей (без ожидания). Конец якоря (`onDeleteItem`) снимает всё с `meta.sustainOf===key` (`removeBound`); `dismiss` = `anchor.delete()` под очередью `sustain:<key>`.
- **Шаги**: `choose` пишет ops `chose` с ключом `<msgId>:self:<i>`; `applyOps` идемпотентен по `meta.key` и `doneOps` — **повтор на том же сообщении не спросит заново** (берёт `prev`). Значит смена идёт на **новом** служебном сообщении (новые ключи).
- **Новое сообщение сам исполняет `createChatMessage`** (`use.mjs:~254`: `kind:"use"` без `awaitingActions` → `execUse` → `applyUseSteps`). Вручную `applyUseSteps` после создания звать нельзя — гонка/двойной эффект.
- **Прецедент pulse** (`use.mjs onPulse`): новая карточка `kind:"use"` со срезанным правилом и `state.sustainKey`; `applyOps` при `sustainKey` вешает `meta.sustainOf` только на живой якорь, `attach(create:false)` не создаёт второй якорь.
- **Откат** (`undoOps`): `created` → удалить (`undo:true`), `effRemoved` → пересоздать из `o.data` у `o.actor` (поле `actor` обязательно), `chose` пропускается, `prune` после цикла.
- **ChoiceSet эффектов**: `applyEffect` → `chooseChoices(actor, data, ctx.chooser)` (`apply.mjs:521`, окно `PICK_MS=120000`, у игрока-автора через сокет, иначе у ГМа). `callGM` ждёт `CALL_MS=200000` (`leader.mjs`).
- **Эффекты DFF** (по исходникам pf2e на GitHub; в локальной установке пак — leveldb, прочитать нельзя): Pest Form (`spell-effect-pest-form`) — только `BattleForm`, ChoiceSet **нет**; Elemental Form — **ChoiceSet есть** (воздух/земля/огонь/металл/вода/дерево); Animal Form (наш `h68Fr3fht1319txv`) — ChoiceSet есть (подтверждено Критиком; сверить по `packs/_source/effects` основного репо при реализации). Соответствие uuid `ydsLEGjY89Akc4oZ` = Pest Form не проверено — сверить при реализации.

Вывод: блок `choose+effect` можно исполнить повторно на новом сообщении; откат работает через `effRemoved` + `created` + `prune`.

## 3. Схема данных

В `onUse`: `"reshape": true`. Валидатор `rules.mjs` (рядом с `pulse`, ~стр.637 и далее): допустим только при `targets:"self"`, при `apply` с `choose{from:"options"}` и хотя бы одним шагом `sustain:true`; несовместим с `pulse` и `check`; при успехе явно `out.reshape = true` (иначе поле отбрасывается нормализацией). Ошибка `use.reshape` — в lang.
`reshapeRule(rule)` (чистая, по образцу `pulseRule`): `{apply: [choose, ...шаги to:"self" с sustain:true]}`, возвращает ещё индекс `choose` (`chooseIndex`) — ключ `chose` строится из него, не жёстко `:0`.
Ранг для вариантов — ранг сотворения (`origin.castRank` сообщения `anchor.flags.sustain.msg`), не ранг в книге.

## 4. Поток UI и исполнения

Подпись кнопки везде: **«Изменить выбор»** (решение пользователя; lang ru/en).

1. **Слушатель** `sustain.sustained` → `onReshape` (в `use.mjs`, рядом с `onPulse`): `guardActiveGM`, правило из сообщения сотворения (`cu.rule`) или `resolveRule(spell)`, `rule.onUse.reshape`, `compat.shouldYield` не взял. Режимы: кнопка работает во всех режимах, кроме `effect:"off"` (решение Руководителя: сама кнопка — ручное действие; в `button` и `auto` одинаково). Служебное сообщение исполняется как в обычных режимах: при `button` его применение — `execUse` по его же правилам; если мир не позволяет авто-применение, кнопка применения не добавляется: карточка смены создаётся с готовыми ops, а шаг создания эффекта — по режиму; чтобы не получить вторую кнопку, при `effect:"button"` для служебной карточки применение выполняется сразу (клик «Изменить выбор» и есть ручное действие) — флаг `state.reshape.force` обходит режим в `execUse`.
2. **Шёпот** (`card()`, автору и ГМу, предыдущий шёпот того же якоря удаляется — как `remind`): одна кнопка «Изменить выбор». В данных шёпота: `actor`, `key`, `pos` (позиция Поддержания), без `reshaped`.
   **Порог показа**: шёпот есть, если после отбора по рангу сотворения (a) вариантов ≥2, **или** (b) вариант один, но его эффект имеет собственный ChoiceSet (внутри формы можно сменить выбор: Animal Form). DFF ранг 1: единственный вариант Pest Form, ChoiceSet нет → шёпота нет. Ранг 2: два варианта → есть. Проверка (b) — по шаблону эффекта (`fromUuid(step.effect.uuid)` → `system.rules` содержит `ChoiceSet` без `selection`), чистая функция `hasOwnChoice(effectSource)`.
3. **Выбор — у нажавшего, до `callGM`.** Клик (клиент нажавшего, игрок-владелец или ГМ): отбор вариантов по рангу (чистая функция, вынесенная из `applyOps`: `apply.optionsOf(step, wset)`; ранг сотворения кладётся в данные шёпота) → `askChoice` (**вне любых очередей**, `PICK_MS` — окно может висеть до 2 мин; `callGM` с `CALL_MS=200000` стартует после окна, таймауты не складываются) → `callGM("sustainReshape", actorUuid, key, msgId, value, chooserUserId)`. Закрытое окно — ничего не делаем, кнопка остаётся.
4. **Исполнение на ГМе** (`use.mjs reshapeRun`, вход `main.mjs` по образцу `sustainRun`, проверка владельца, `gm(...)`), всё под очередью `sustain:<key>` (под ней же `dismiss`; окна на ГМе внутри очереди нет — выбор уже сделан):
   a. после ожидания клика повторно проверить: якорь жив (`alive`), на шёпоте нет `reshaped`, `value` допустим (есть среди вариантов по рангу сотворения — иначе отказ), момент Поддержания (п.7);
   b. выбор значения совпадает с текущим вариантом — **не запрещается** (Animal Form → Animal Form с другим ChoiceSet разрешён текстом: «change to a different shape from those available»). Исключение текущего варианта: только если его эффект без собственного ChoiceSet (смена Pest→Pest бессмысленна и дала бы лишь пересоздание); иначе — выбор разрешён. Для ранга ≥2 «не исключать вовсе» упростило бы код, но дало бы пустую смену Pest→Pest; поэтому правило выше (проверка `hasOwnChoice`);
   c. `removeBound(actor, key)` → результат `{op:"effRemoved", data}` (если снято ничего/`skipped` — продолжать, op не пишем);
   d. **до `ChatMessage.create`** собрать `snap` (как `onPulse`: `resolved.rule = reshapeRule`, `state.sustainKey = base`, `state.reshape = {key, from: castMsg, pos}`); ключ `chose` — `<будущий id>`: id сообщения заранее неизвестен → ключ собирается так: `snap.state.reshape.preChoice = {index, value}`, а `applyOps` при `use.state?.reshape?.preChoice` на шаге `choose` по индексу берёт значение вместо окна (одна ветка в `applyOps`, ~3 строки; `chose` в ops пишется как обычно). `effRemoved` кладётся сразу в `snap.state.apply.self.ops` как `{op:"effRemoved", actor, key: <ключ якоря>, data}` (поля `actor` и `key` **обязательны**: откат пересоздаёт у `actor`); `{op:"reshaped", actor, key, effects:[uuid созданных]}` дописывается `applyOps` для привязок этого сообщения (см. п.5);
   e. `ChatMessage.create({ author: <id нажавшего>, speaker, flags: {use: snap, pf2e: {origin: {castRank}}} })` — **`author` = нажавший**, чтобы `chooserOf(message)` (ChoiceSet Animal/Elemental Form) отправил окно ему, а не ГМу. Исполняет `onCreateMessage` → `execUse` (шаги не зовём руками);
   f. флаг `reshaped` на шёпоте ставится после успешного создания (под той же очередью).
   Сбой создания после снятия: `effRemoved` уже в `snap` — без сообщения откатить нечем, поэтому порядок «создать сообщение (с ops) → `removeBound`» не годится (гонка с `execUse`); оставляем «`removeBound` → `create`» и при ошибке `create` сразу пересоздаём снятое из `data` (`createEmbeddedDocuments`) и сообщаем ГМу.
5. **Откат карточки смены** (`undoOps`, новая ветка `reshaped`): разрешён, **только если якорь жив и созданное этой карточкой ещё на актёре** (по `effects`/`meta.key`); иначе — отказ с уведомлением (`sustain.reshape.undoDenied`), ops не трогаются. Это закрывает откат не по порядку (после новой смены) и после конца якоря: `effRemoved` в такой момент воскресил бы эффект на мёртвом якоре. Разрешённый откат: созданное удаляется, старое пересоздаётся из `effRemoved` (с `actor`), `prune` не удаляет якорь (старое привязано).
6. **Откат карточки сотворения после смены**: карточка сотворения не знает про привязки, сделанные служебной карточкой. Поэтому в `undoOps` (после цикла, рядом с `prune`, у ветки откат карточки с живым якорем `anchorKey(message.id)`): если у якоря есть привязки сверх ops этой карточки — `removeBound(author, key)` и затем `prune` (иначе после смены `prune` увидит живое привязанное и якорь останется). Условие: откатываем карточку, породившую якорь (`op:"anchor"` в её ops).
7. **Момент Поддержания (CLAUDE.md §1.1)**: «each time you Sustain» — только вместе с Поддержанием. В шёпоте хранится `pos`. Клик в бою: отказ (предупреждение «что не так и что сделать»: «Сначала Поддержите заклинание в этом раунде» / «Сейчас не ход автора»), если `sameTurn(anchor.last, pos)` ложно или `posOfActor(actor)` ≠ `pos`/ход не автора; **обход Alt** у ГМа (по образцу `melee-reach`/`impulse-gate`; ГМ-путь передаёт флаг в `callGM`). Вне боя (`pos.combat == null`) — без ограничения.
8. **Таймаут/смерть якоря за время окна**: п.4a — повторная проверка после окна и клика; якорь исчез → `sustain.gone`, ничего не создаётся.
9. **Конец Поддержания** (`dismiss`, срыв, срок): `onDeleteItem` якоря снимает привязанное, в том числе созданное сменой. Откат смены после этого — запрещён (п.5).
10. **Ручное Поддержание из чата** (`onMessage`) → тот же `count()` → тот же слушатель.

## 5. Файлы

`scripts/rules.mjs` (валидатор + `out.reshape`); `scripts/use.mjs` (`onReshape`, `reshapeRun`, `reshapeRule`, регистрация, ветка `state.reshape.force`); `scripts/apply.mjs` (экспорт `optionsOf`, `hasOwnChoice`, `preChoice` в `choose`, op `reshaped`, ветка отката, снятие привязанного при откате карточки сотворения); `scripts/sustain.mjs` (`bind` для `data-af-reshape`, окно у нажавшего, проверка `pos`); `scripts/main.mjs` (`sustainReshape`); `lang/{ru,en}/sustain.json` («Изменить выбор», текст шёпота, `reshape.wrongTurn`, `reshape.needSustain`, `reshape.undoDenied`, «уже изменено»); `lang/*/rules.json` (`use.reshape`); `rules/catalog.json` (DFF: `"reshape": true`, после остальных исполнителей); `docs/dev/rules-format.md`; `plan-rustyspirit-gaps.md` (снять «не делаем»).

## 6. Тесты

Юнит: `tests/sustain-reshape.test.mjs` (`reshapeRule` + `chooseIndex`; валидатор — допустимые/недопустимые комбинации и `out.reshape`; `hasOwnChoice`; порог показа: DFF ранг 1 → нет, ранг 2/5 → да; момент Поддержания; отказ допустимости значения); `tests/apply.choice.test.mjs` (вынесенный `optionsOf`, `preChoice`, регресс обычного `choose`); откат `reshaped` (якорь жив/мёртв, не по порядку), откат карточки сотворения после смены (`removeBound`+`prune`). Шаблон — `sustain-pulse.test.mjs`.
Живой: `tests/live/sustain-reshape.js` по образцу `sustain-batch.js`, актёр — копия Кепи в «Тестовые копии (автоматизация)» RustySpirit (после прогона убрать; сцену «Тест» не трогать; чужие свежие сообщения не удалять). Сценарии: DFF ранг 2 → Поддержать → «Изменить выбор» → другой вариант, старый снят, новый на том же якоре, якорь один; Animal→Animal (внутри ChoiceSet, окно у нажавшего); клик без Поддержания в бою → отказ, ГМ-обход Alt; откат смены (порядок и после `dismiss` — отказ); откат сотворения после смены → якорь и привязанное сняты; ранг 1 — шёпота нет. Прогнать `dff-rank1/2` из `sustain-batch.js`.

## 7. Подводные камни и остаточные риски

- Вынос отбора вариантов из `applyOps` — риск регресса всех `choose` (тесты выше).
- `preChoice` — новая ветка в `applyOps`; ключ `chose` остаётся `<msg>:self:<chooseIndex>`.
- Окно ChoiceSet Animal/Elemental Form у нажавшего зависит от `chooserOf(message)`: проверить живым прогоном (`author` = нажавший).
- Если ГМ нажал за игрока без владельца-онлайн — окно у ГМа (как сейчас).
- `onDelete:"restrict"` эффект не снимается `removeBound` → новый создастся вторым: после снятия проверить, что привязанных не осталось, иначе отказ с сообщением.
- Один активный ГМ-лидер исполняет; вкладка ГМа двоит исполнение при игре пользователя (не вызывать с двух клиентов).
- Вне боя Поддержание «свежее» каждый раз — шёпот приходит на каждое; допустимо.
- Правила «один раз за Поддержание» в бою держит `reshaped` на шёпоте + `sameTurn`; вне боя — только `reshaped`.
- Не проверено (пометки): uuid Pest Form `ydsLEGjY89Akc4oZ` = Pest Form; ChoiceSet Animal Form — со слов Критика.

## 8. Объём

~150–180 строк кода (`use.mjs`, `apply.mjs`, `sustain.mjs`, `main.mjs`, `rules.mjs`), ~20 строк lang, 1 запись каталога, юнит ~150 строк, живой сценарий ~100 строк. Один исполнитель, 1–1,5 дня с живым прогоном.

## 9. Решения пользователя / Руководителя (закрыто)

Подпись «Изменить выбор». (б) вне плана. Остальные записи группы (а) — после живой проверки DFF, пачкой. Кнопка работает во всех режимах, кроме `off`.
