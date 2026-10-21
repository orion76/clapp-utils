# Модуль `json-ast` (`@clapp/utils`)

Инструкция для правки модуля; человекочитаемо — `packages/utils/README.md`, конспект — `.ai/prompts/library.md`.

## Назначение

Lossless-редактирование JSON: `JsonAst.parse` (`packages/utils/src/json-ast/json-ast.ts:32`) разбирает документ
в AST, `JsonAst.unparse` (`json-ast.ts:49`) собирает текст обратно побайтно — `unparse(parse(x)) === x`.
Сохраняются пробелы/табы/CRLF, порядок и дубли ключей, запись чисел (`-0`, `42.0`, `1e+10`) и экранирование
строк; правка значения не переформатирует документ (`packages/utils/tests/json-ast.test.ts:94`). В `data-file`
по-прежнему `jsonc-parser` (`packages/utils/src/data-file/formats/json/json.ts:11`) — модуль туда не подключён.

## Состав папки (`packages/utils/src/json-ast/`)

- `types.ts` — `AstNodePos` (`types.ts:16`), `JsonAstNodeType` (`types.ts:26`), `JsonAstNode` (`types.ts:65`) и
  типы обхода `JsonAstWalkWhen`/`JsonAstWalkDirection`/`JsonAstWalkCallback` (`types.ts:29-47`).
- `node.ts` — `JsonAstNodeImpl` (`node.ts:22`, атрибуты в `Map`, дети в массиве): `child` (`node.ts:75`),
  `childs` (`node.ts:94`), `walk` (`node.ts:107`) и фабрика `createNode` (`node.ts:143`) — единственная точка
  создания узла, она же привязывает детей к родителю (`node.ts:124`).
- `parse.ts` — рекурсивный спуск: `parseJsonAst` (`parse.ts:43`), `JsonParser` (`parse.ts:78`), документ
  (`parse.ts:94`), объект (`parse.ts:112`), массив (`parse.ts:133`), member (`parse.ts:154`), скаляры
  (`parse.ts:191`, `parse.ts:238`, `parse.ts:295`) и текст ошибки (`parse.ts:54`).
- `json-ast.ts` — фасад `JsonAst` (`json-ast.ts:23`), `index.ts` — реэкспорт `./json-ast` и `./types`
  (`index.ts:1-2`), подключается в `packages/utils/src/index.ts:7`. `parseJsonAst` и `createNode`
  экспортируются из своих файлов, но не из `index.ts`, поэтому наружу (`@clapp/utils`) не попадают — внутренние.

## Публичный API

- `JsonAst.parse(json: string): JsonAstNode` (`json-ast.ts:32`), `JsonAst.unparse(ast: JsonAstNode): string`
  (`json-ast.ts:49`); типы `JsonAstNode`/`JsonAstNodeType`/`AstNodePos` и типы обхода — через
  `packages/utils/src/index.ts:7`.
- Узел: `type()`, `attrs()`, `get`, `set` (возвращает узел, `undefined` удаляет атрибут), `pos()`, `parent()`,
  `child`, `childs`, `walk(callback, when = 'downward')` (`types.ts:65-120`); callback получает
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
  разделители и отступы; хелперов вставки/удаления нет (`appendChild` в `node.ts:124` — внутренний).

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

## Границы и запреты

- Только строгий JSON: без комментариев и trailing comma (`json-ast.ts:7-8`, `parse.ts:9`); JSONC — дело
  `jsonc-parser` в `data-file`. Нет `dump`, цветного вывода, CLI/`bin` и ASTq — правка только через `get`/`set`.
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

Сьют — `packages/utils/tests/json-ast.test.ts` (round-trip, форма AST, `childs`/`child`, ошибки). Сьюты `data-*`
красные предсуществующе после рефакторинга `data-file/formats/**` — к модулю не относятся.

## Стиль пакета

ESM (`"type": "module"`), `strict`, `moduleResolution: bundler`, относительные импорты без расширений
(`parse.ts:11`). Prettier — корневой `.prettierrc.json`: `singleQuote`, 2 пробела, `semi`, `trailingComma: "all"`,
без табов, ширина 140 (в старых заметках 120 — верьте конфигу).
