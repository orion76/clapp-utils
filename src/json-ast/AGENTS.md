# Модуль `json-ast` (`@clapp/utils`)

Инструкция для правки модуля; человекочитаемо — `packages/utils/README.md`, конспект — `.ai/prompts/library.md`.

## Назначение

Lossless-редактирование JSON: `JsonAst.parse` (`packages/utils/src/json-ast/json-ast.ts:32`) разбирает документ
в AST, `JsonAst.unparse` (`json-ast.ts:49`) собирает текст обратно побайтно — `unparse(parse(x)) === x`.
Сохраняются пробелы/табы/CRLF, порядок и дубли ключей, запись чисел (`-0`, `42.0`, `1e+10`) и экранирование
строк; правка значения не переформатирует документ (`packages/utils/tests/json-ast.test.ts:94`). Правки по
пути (`get`/`node`/`has`/`set`/`push`/`delete`) выполняет `JsonAstEditor`
(`packages/utils/src/json-ast/editor/json-ast-editor.ts:67`), см. раздел «`JsonAstEditor`». В `data-file`
по-прежнему `jsonc-parser` (`packages/utils/src/data-file/formats/json/json.ts:11`) — модуль туда не подключён.

## Состав папки (`packages/utils/src/json-ast/`)

- `types.ts` — `AstNodePos` (`types.ts:16`), `JsonAstNodeType` (`types.ts:26`), `JsonAstNode` (`types.ts:66`)
  и типы обхода `JsonAstWalkWhen`/`JsonAstWalkDirection`/`JsonAstWalkCallback` (`types.ts:29-47`). Типы пути
  живут в `editor/types.ts`.
- `node.ts` — `JsonAstNodeImpl` (`node.ts:22`, атрибуты в `Map`, дети в массиве): `child` (`node.ts:75`),
  `childs` (`node.ts:94`), `walk` (`node.ts:107`) и фабрика `createNode` (`node.ts:174`) — единственная точка
  создания узла, она же привязывает детей к родителю. Сплайсинг готового дерева — внутренние
  `insertChild`/`removeChild`/`replaceChild` (`node.ts:203`, `:214`, `:226`) с пометкой `@internal`:
  из `index.ts` не экспортируются, вызывает их только редактор.
- `parse.ts` — рекурсивный спуск: `parseJsonAst` (`parse.ts:43`), `JsonParser` (`parse.ts:78`), документ
  (`parse.ts:94`), объект (`parse.ts:112`), массив (`parse.ts:133`), member (`parse.ts:154`), скаляры
  (`parse.ts:191`, `parse.ts:238`, `parse.ts:295`) и текст ошибки (`parse.ts:54`).
- `json-ast.ts` — фасад `JsonAst` (`json-ast.ts:23`).
- `editor/` — редактор по пути, один файл на назначение:
  - `json-ast-editor.ts` — только `class JsonAstEditor` (`json-ast-editor.ts:67`) с публичными методами
    `node`/`has`/`get`/`set`/`push`/`delete`;
  - `types.ts` — `JsonAstPathSegment` (`editor/types.ts:16`), `JsonAstPath` (`editor/types.ts:24`) и
    внутренние `Slot`/`ContainerStyle`/`BuildStyle`;
  - `errors.ts` — `JsonAstPathError` (`errors.ts:15`): поля `path` и `segmentIndex`, сообщение содержит
    причину, сегмент и путь;
  - `path.ts` — валидация и резолв пути: `validatePath` (`path.ts:22`), `resolveSegments` (`path.ts:101`),
    `findMemberIndex` (`path.ts:156`), `arrayIndex` (`path.ts:184`), `segmentKey`, `assertMutationPath`,
    `rootPathError`;
  - `value.ts` — `decodeValue` (`value.ts:16`), `assertJsonValue` (`value.ts:54`),
    `isContainerValue`;
  - `build.ts` — `buildValue` (`build.ts:54`), `buildArray` (`build.ts:70`), `buildObject` (`build.ts:104`),
    `createMember` (`build.ts:135`), `createScalarNode`/`scalarText`/`scalarType`/`childStyle`;
  - `format.ts` — `containerStyle` (`format.ts:49`), `buildStyleFor` (`format.ts:91`),
    `normalizeContainer` (`format.ts:149`), `prepareContainerForInsert` (`format.ts:165`),
    `appendChild` (`format.ts:220`), `stripTrailingSeparator` (`format.ts:251`),
    `keySeparator` (`format.ts:263`), `outsidePrefix`/`outsideSuffix`, `lineBreak`, `indentStep`;
  - `index.ts` — единственная точка реэкспорта публичной поверхности: `JsonAstEditor`, `JsonAstPathError` и
    `export type { JsonAstPath, JsonAstPathSegment }`; хелперы `path`/`value`/`build`/`format` наружу не выходят.
- `index.ts` — реэкспорт `./editor`, `./json-ast` и `./types` (`index.ts:1-3`), подключается в
  `packages/utils/src/index.ts:7`. `parseJsonAst`, `createNode`, хелперы редактора и внутренние mutate-методы
  узла экспортируются из своих файлов, но не из `index.ts`, поэтому наружу (`@clapp/utils`) не попадают.

## Публичный API

- `JsonAst.parse(json: string): JsonAstNode` (`json-ast.ts:32`), `JsonAst.unparse(ast: JsonAstNode): string`
  (`json-ast.ts:49`); типы `JsonAstNode`/`JsonAstNodeType`/`AstNodePos` и типы обхода — через
  `packages/utils/src/index.ts:7`.
- `JsonAstEditor` (`editor/json-ast-editor.ts:67`) — инстанс-API: `new JsonAstEditor(ast)`, затем
  `node`/`has`/`get`/`set`/`push`/`delete` без параметра `ast`; статических методов нет.
- `JsonAstPathError` (`editor/errors.ts:15`) с `path` и `segmentIndex`; типы
  `JsonAstPathSegment`/`JsonAstPath` (`editor/types.ts:16`, `:24`). Всё это реэкспортируется из
  `packages/utils/src/index.ts:7` через `json-ast/index.ts` → `json-ast/editor/index.ts`.
- Узел: `type()`, `attrs()`, `get`, `set` (возвращает узел, `undefined` удаляет атрибут), `pos()`, `parent()`,
  `child`, `childs`, `walk(callback, when = 'downward')` (`types.ts:66`); callback получает
  `(node, depth, parent, when)` (`types.ts:42`).

## Lossless-модель

Атрибуты (`types.ts`): `prolog` — текст перед содержимым, `body` — сырой литерал или строка с кавычками,
`epilog` — после содержимого (разделитель/закрывающая скобка), `value` — декодированное значение.

| тип       | `prolog`      | `body`            | `epilog`      | `value`               |
| --------- | ------------- | ----------------- | ------------- | --------------------- |
| `object`  | `ws? "{" ws?` | —                 | `ws? "}" ws?` | —                     |
| `array`   | `ws? "[" ws?` | —                 | `ws? "]" ws?` | —                     |
| `member`  | —             | —                 | —             | —                     |
| `string`  | —             | текст с кавычками | —             | декодированная строка |
| `number`  | —             | сырой литерал     | —             | `parseFloat(body)`    |
| `boolean` | —             | `true` / `false`  | —             | `true` / `false`      |
| `null`    | —             | `null`            | —             | `null`                |

- `member` — двое детей (ключ и значение); `ws? ":" ws?` лежит в `epilog` ключа (`parse.ts:161`). `ws? "," ws?`
  дописывается в `epilog` предыдущего члена/элемента (`parse.ts:121-126`, `parse.ts:142-147`), а `ws? "}" ws?` /
  `ws? "]" ws?` — в `epilog` контейнера (`parse.ts:308`).
- Скаляры: `body` — сырой текст, `value` — декодированное значение (`parse.ts:234`, `parse.ts:264`,
  `parse.ts:304`). Корень — value-узел (документ не оборачивается в отдельный узел): ведущие пробелы документа
  идут в его `prolog`, замыкающие — в `epilog` (`parse.ts:94-108`).

## Правила правки

- `unparse` идёт `walk(..., 'both')` (`json-ast.ts:63`): на `downward` пишет `prolog`, затем `body`, а если
  `body` не строка — `JSON.stringify(value)` (`json-ast.ts:65-77`); на `upward` — `epilog` (`json-ast.ts:78-83`).
- Значит, `unparse` предпочитает сырой `body`: `set('value', ...)` текст не меняет; для замены литерала меняйте
  `body` и согласованно `value` (`packages/utils/tests/json-ast.test.ts:120-134`). Смена `prolog`/`epilog` сдвигает
  разделители и отступы. Структурные правки (замена/вставка/удаление узла) делаются только через
  `JsonAstEditor`, а не руками через `set` атрибутов и `insertChild`/`appendChild` (внутренние).

## `JsonAstEditor`

Класс в `editor/json-ast-editor.ts` — единственный публичный вход для правок по пути. Создаётся
`new JsonAstEditor(ast)` над деревом `JsonAst.parse`; все методы инстансные и работают над этим деревом in
place, текст получают обычным `JsonAst.unparse`.

- Путь — `JsonAstPath` (`(string | number)[]`). Объект: строка — ключ, число — `String(number)`; массив: число
  или каноничная целая строка `/^(0|[1-9][0-9]*)$/`. Дубли ключей — цель **последнее** вхождение (как
  `JSON.parse`). Пустой путь — корень для чтения; `set`/`delete` — `JsonAstPathError`; `push([])` допустим,
  только если корень документа — массив.
- `node`/`has`/`get` — чтение. `node`/`get` бросают на отсутствующий ключ/индекс, путь через скаляр и
  невалидный сегмент. `has` сначала вызывает `validatePath` (невалидный по типу сегмент — `JsonAstPathError`),
  затем `try { this.node(path); return true } catch { return false }`: отсутствие ключа/индекса, выход за
  границу массива, путь через скаляр и неканоничная строка индекса (`'01'`, `'x'`) — `false`. `get` возвращает
  только JS-значения: объекты в порядке документа (дубли — последний, `__proto__` — обычный собственный ключ),
  массивы, скаляры — `value`.
- **`set` заменяет и создаёт**: существующий адрес меняется по правилам ниже; отсутствующий создаётся в
  существующем родителе — объект получает новый `member` в конец (ключ — сегмент), массив — новый элемент при
  `index === length`; `index > length` — `JsonAstPathError` с подсказкой `push`. Промежуточные сегменты не
  создаются: родитель (`path.slice(0, -1)`) обязан существовать и быть объектом/массивом.
- **`push(path, value)`** только дописывает значение в конец **существующего** массива, на который указывает
  путь (или в корень-массив при пустом пути); скаляр/объект/отсутствующий путь — `JsonAstPathError`.
- Скаляр → скаляр того же типа: меняются только `body` + `value`, тип узла и все остальные байты сохраняются.
  **Смена типа** скаляра (в т.ч. `number` → `string`) и любая замена с контейнером собирают узел заново, чтобы
  `type()` отражал фактическое значение; `prolog`/`epilog` заменяемого узла сохраняются (`outsidePrefix`/
  `outsideSuffix`).
- `delete` удаляет член/элемент; если удалён последний — у предыдущего срезается только хвостовой разделитель
  (`stripTrailingSeparator`, регулярка `/\s*,\s*$/`), поэтому закрывающая скобка контейнера-соседа остаётся
  (`[{"a": 1}, 2]` → `[{"a": 1}]`). Опустевший контейнер нормализуется до `{}`/`[]` (внутренние пробелы
  убираются, внешние сохраняются).
- Форматирование вставок/построенных контейнеров — по стилю принимающего контейнера: многострочный — отступ
  детей из `prolog`, разделитель `,` + перевод строки + отступ; однострочный — `, `; пустой — компактно.
  Перевод строки берётся из стиля документа: если в `prolog`/`epilog` контейнера есть `\r\n` — `\r\n`, иначе
  `\n`; смешанных переводов строк не создаём. `appendChild` ставит разделитель сразу после содержимого
  предыдущего ребёнка, а его хвостовой layout (пробелы/перевод строки после закрывающей скобки, перенесённый
  предыдущим append) переезжает в `epilog` нового последнего ребёнка, иначе запятая встала бы после перевода
  строки.
- Новый ключ объекта: `": "` из `epilog` первого ключа существующего члена, иначе `": "` (`keySeparator`).
- `pos()` после мутаций не пересчитывается: у нового узла позиция заменённого/принимающего узла. `unparse`
  позиции не использует.
- Невалидные значения (`undefined`, функция, `symbol`, `bigint`, `NaN`, `±Infinity`, не-plain-объект, цикл) —
  обычный `Error` (не `JsonAstPathError`), проверяются до любых изменений дерева (`assertJsonValue`).

## Контракт детей

- `childs(begin = 0, end = childCount)`: только целые `0 <= begin <= end <= childCount`, иначе `RangeError` с
  текстом `childs: invalid range [begin, end) for N children (expected integers with 0 <= begin <= end <= N)`
  (`node.ts:94-103`); возвращается копия диапазона `[begin, end)` (`node.ts:104`).
- `child(pos)` делегирует в `childs(pos)` (`node.ts:75-77`), валидация одна на оба метода; `null` — только при
  `pos === childCount`, никогда для некорректной позиции.

## Ошибки

Тексты — часть контракта (`packages/utils/tests/json-ast.test.ts:281`, `:288`, `:308`); менять только с тестами.

- `parse` на не-строке — `invalid JSON argument (expected type string)` (`json-ast.ts:35`, дубль `parse.ts:45`);
  `unparse` на не-узле — `generate: invalid AST argument (expected type object)` (`json-ast.ts:57`, критерий узла
  в `json-ast.ts:51-55`).
- Синтаксис: `parse: JSON parsing failure: <reason> at line N, column M, offset K`, затем строка исходника и
  каретка (`parse.ts:71-74`), фрагмент ≤ 80 символов (`parse.ts:33`); `line`/`column` 1-based, `offset` 0-based
  (`types.ts:13-15`).
- Редактор: `JsonAstPathError` (`editor/errors.ts:15`) с сообщением
  `json-ast path error: <reason> (segment <seg> at index <i> in path [...])` (или `... (path [...])` для ошибки
  всего пути), полями `path` и `segmentIndex`; сообщения тесты проверяют по подстрокам. Невалидное значение —
  обычный `Error` с `invalid JSON value at <где>: ...`.

## Границы и запреты

- Только строгий JSON: без комментариев и trailing comma (`json-ast.ts:7-8`, `parse.ts:9`); JSONC — дело
  `jsonc-parser` в `data-file`. Нет `dump`, цветного вывода, CLI/`bin` и ASTq; правка — только `JsonAstEditor`
  по одному значению (`set`/`push`/`delete`), без перемещений между документами, массовых правок и patch/diff.
- Не добавляйте зависимости и PEG/ASTy (`pegjs*`, `asty*`, `peggy`): парсер — собственный рекурсивный спуск;
  состав зависимостей фиксирует тест (`packages/utils/tests/json-ast.test.ts:333-336`).
- Атрибуция модели (json-asty 1.3.4, MIT, © 2018-2026 Dr. Ralf S. Engelschall) в шапках сохраняется:
  `json-ast.ts:10`, `parse.ts:5`, `node.ts:4`, `types.ts:4`.

## Проверки

```bash
cd packages/utils && npm run test:jest -- json-ast
npx tsc --noEmit -p packages/utils/tsconfig.tests.json
npm run build:utils
```

Сьюты — `packages/utils/tests/json-ast.test.ts` (round-trip, форма AST, `childs`/`child`, ошибки) и
`packages/utils/tests/json-ast-editor.test.ts` (чтение, `set`/`push`/`delete`, форматирование/CRLF, ошибки,
инварианты). Сьюты `data-*` красные предсуществующе после рефакторинга `data-file/formats/**` — к модулю не
относятся.

## Стиль пакета

ESM (`"type": "module"`), `strict`, `moduleResolution: bundler`, относительные импорты без расширений
(`parse.ts:11`). Prettier — корневой `.prettierrc.json`: `singleQuote`, 2 пробела, `semi`, `trailingComma: "all"`,
без табов, ширина 140 (в старых заметках 120 — верьте конфигу).
