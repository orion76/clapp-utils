# Модуль `json-ast` (`@clapp/utils`)

Инструкция для правки модуля; человекочитаемо — `packages/utils/README.md`, конспект — `.ai/prompts/library.md`.

## Назначение

Lossless-редактирование JSON: `JsonAst.parse` (`packages/utils/src/json-ast/json-ast.ts:32`) разбирает документ
в AST, `JsonAst.unparse` (`json-ast.ts:49`) собирает текст обратно побайтно — `unparse(parse(x)) === x`.
Сохраняются пробелы/табы/CRLF, порядок и дубли ключей, запись чисел (`-0`, `42.0`, `1e+10`) и экранирование
строк; правка значения не переформатирует документ (`packages/utils/tests/json-ast.test.ts:94`). Правки по
пути (`get`/`node`/`has`/`set`/`add`/`delete`) — `JsonAstEditor` (`editor.ts:79`), см. раздел
«`JsonAstEditor`». В `data-file` по-прежнему `jsonc-parser`
(`packages/utils/src/data-file/formats/json/json.ts:11`) — модуль туда не подключён.

## Состав папки (`packages/utils/src/json-ast/`)

- `types.ts` — `AstNodePos` (`types.ts:16`), `JsonAstNodeType` (`types.ts:26`), `JsonAstNode` (`types.ts:83`),
  типы обхода `JsonAstWalkWhen`/`JsonAstWalkDirection`/`JsonAstWalkCallback` (`types.ts:29-47`) и типы пути
  `JsonAstPathSegment`/`JsonAstPath` (`types.ts:56`, `types.ts:64`).
- `node.ts` — `JsonAstNodeImpl` (`node.ts:22`, атрибуты в `Map`, дети в массиве): `child` (`node.ts:75`),
  `childs` (`node.ts:94`), `walk` (`node.ts:107`) и фабрика `createNode` (`node.ts:174`) — единственная точка
  создания узла, она же привязывает детей к родителю (`node.ts:124`). Сплайсинг готового дерева — внутренние
  `insertChild`/`removeChild`/`replaceChild` (`node.ts:203`, `node.ts:214`, `node.ts:226`) с пометкой `@internal`:
  из `index.ts` не экспортируются, вызывает их только редактор.
- `errors.ts` — `JsonAstPathError` (`errors.ts:15`): поля `path` и `segmentIndex`, сообщение содержит причину,
  сегмент и путь.
- `editor.ts` — `JsonAstEditor` (`editor.ts:79`) со статическими `node`/`has`/`get`/`set`/`add`/`delete`
  (`editor.ts:90`, `:105`, `:154`, `:179`, `:240`, `:300`) и приватные хелперы пути/форматирования
  (`validatePath` `editor.ts:331`, `resolveSlot` `editor.ts:396`, `containerStyle` `editor.ts:782`,
  `buildValue` `editor.ts:680`, `insertIntoContainer` `editor.ts:912`, `normalizeContainer` `editor.ts:882`).
- `parse.ts` — рекурсивный спуск: `parseJsonAst` (`parse.ts:43`), `JsonParser` (`parse.ts:78`), документ
  (`parse.ts:94`), объект (`parse.ts:112`), массив (`parse.ts:133`), member (`parse.ts:154`), скаляры
  (`parse.ts:191`, `parse.ts:238`, `parse.ts:295`) и текст ошибки (`parse.ts:54`).
- `json-ast.ts` — фасад `JsonAst` (`json-ast.ts:23`); `index.ts` — реэкспорт `./editor`, `./errors`, `./json-ast`
  и `./types` (`index.ts:1-4`), подключается в `packages/utils/src/index.ts:7`. `parseJsonAst`, `createNode` и
  внутренние mutate-методы узла экспортируются из своих файлов, но не из `index.ts`, поэтому наружу
  (`@clapp/utils`) не попадают — внутренние.

## Публичный API

- `JsonAst.parse(json: string): JsonAstNode` (`json-ast.ts:32`), `JsonAst.unparse(ast: JsonAstNode): string`
  (`json-ast.ts:49`); типы `JsonAstNode`/`JsonAstNodeType`/`AstNodePos` и типы обхода — через
  `packages/utils/src/index.ts:7`.
- `JsonAstEditor` (`editor.ts:79`): статические `node`/`has`/`get`/`set`/`add`/`delete`; `JsonAstPathError`
  (`errors.ts:15`) с `path` и `segmentIndex`; типы `JsonAstPathSegment`/`JsonAstPath` (`types.ts:56`, `:64`).
  Всё это реэкспортируется из `packages/utils/src/index.ts:7` через `json-ast/index.ts`.
- Узел: `type()`, `attrs()`, `get`, `set` (возвращает узел, `undefined` удаляет атрибут), `pos()`, `parent()`,
  `child`, `childs`, `walk(callback, when = 'downward')` (`types.ts:83-139`); callback получает
  `(node, depth, parent, when)` (`types.ts:42-47`).

## Lossless-модель

Атрибуты (`types.ts:55-59`): `prolog` — текст перед содержимым, `body` — сырой литерал или строка с кавычками,
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
  `JsonAstEditor`, а не руками через `set` атрибутов и `appendChild` (внутренний).

## `JsonAstEditor`

Класс в `editor.ts` — единственный публичный вход для правок по пути. Все методы статические, работают над
переданным деревом in place; текст получают обычным `JsonAst.unparse`.

- Путь — `JsonAstPath` (`(string | number)[]`). Объект: строка — ключ, число — `String(number)`; массив: число
  или каноничная целая строка `/^(0|[1-9][0-9]*)$/`. Дубли ключей — цель **последнее** вхождение (как
  `JSON.parse`). Пустой путь — корень для чтения; для `set`/`add`/`delete` — `JsonAstPathError`.
- `node`/`has`/`get` — чтение. `has` не бросает на отсутствующий ключ/индекс или путь через скаляр (только на
  невалидный сегмент). `get` возвращает только JS-значения: объекты в порядке документа (дубли — последний),
  массивы, скаляры — `value`.
- **`set` ≠ `add`**: `set` меняет только существующий путь (иначе ошибка); `add` создаёт только новый элемент
  (объект — **append** в конец членов, существующий ключ — ошибка «use set»; массив — `0..length`, `length` —
  append). `delete` удаляет член/элемент и чистит разделитель; опустевший контейнер нормализуется до `{}`/`[]`
  (внутренние пробелы убираются, внешние сохраняются).
- Скаляр → скаляр того же типа: меняются только `body` + `value`, тип узла и все остальные байты сохраняются.
  **Смена типа** скаляра (в т.ч. `number` → `string`) и любая замена с контейнером собирают узел заново, чтобы
  `type()` отражал фактическое значение; `prolog`/`epilog` заменяемого узла сохраняются.
- Форматирование вставок/построенных контейнеров — по стилю принимающего контейнера: многострочный — отступ
  детей из `prolog`, разделитель `,` + перевод строки + отступ; однострочный — `, `; пустой — компактно.
  Перевод строки берётся из стиля документа: если в `prolog`/`epilog` контейнера есть `\r\n` — `\r\n`, иначе
  `\n`; смешанных переводов строк не создаём.
- `pos()` после мутаций не пересчитывается: у нового узла позиция заменённого/принимающего узла. `unparse`
  позиции не использует.
- Невалидные значения (`undefined`, функция, `symbol`, `bigint`, `NaN`, `±Infinity`, не-plain-объект, цикл) —
  обычный `Error` (не `JsonAstPathError`), проверяются до любых изменений дерева.

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
- Редактор: `JsonAstPathError` (`errors.ts:15`) с сообщением
  `json-ast path error: <reason> (segment <seg> at index <i> in path [...])` (или `... (path [...])` для ошибки
  всего пути), полями `path` и `segmentIndex`; сообщения тесты проверяют по подстрокам. Невалидное значение —
  обычный `Error` с `invalid JSON value at <где>: ...`.

## Границы и запреты

- Только строгий JSON: без комментариев и trailing comma (`json-ast.ts:7-8`, `parse.ts:9`); JSONC — дело
  `jsonc-parser` в `data-file`. Нет `dump`, цветного вывода, CLI/`bin` и ASTq; правка — только `JsonAstEditor`
  по одному существующему (`set`/`delete`) или новому (`add`) значению, без перемещений между документами,
  массовых правок и patch/diff.
- Не добавляйте зависимости и PEG/ASTy (`pegjs*`, `asty*`, `peggy`): парсер — собственный рекурсивный спуск;
  состав зависимостей фиксирует тест (`packages/utils/tests/json-ast.test.ts:333-336`).
- Атрибуция модели (json-asty 1.3.4, MIT, © 2018-2026 Dr. Ralf S. Engelschall) в шапках сохраняется:
  `json-ast.ts:10`, `parse.ts:5`, `node.ts:4`, `types.ts:4`.

## Проверки

```bash
npm run test:jest -w @clapp/utils -- json-ast
npx tsc --noEmit -p packages/utils/tsconfig.tests.json
npm run build:utils
```

Сьюты — `packages/utils/tests/json-ast.test.ts` (round-trip, форма AST, `childs`/`child`, ошибки) и
`packages/utils/tests/json-ast-editor.test.ts` (чтение, `set`/`add`/`delete`, форматирование/CRLF, ошибки,
инварианты). Сьюты `data-*` красные предсуществующе после рефакторинга `data-file/formats/**` — к модулю не
относятся.

## Стиль пакета

ESM (`"type": "module"`), `strict`, `moduleResolution: bundler`, относительные импорты без расширений
(`parse.ts:11`). Prettier — корневой `.prettierrc.json`: `singleQuote`, 2 пробела, `semi`, `trailingComma: "all"`,
без табов, ширина 140 (в старых заметках 120 — верьте конфигу).
