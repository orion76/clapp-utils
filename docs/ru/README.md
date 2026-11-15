> ⚠️ **В разработке.** Пакет ещё не готов к релизу: релиз ожидается в ближайшее время, API может меняться. Использовать в продакшне пока нельзя.

[English](../README.md)

# @clapp/utils

Общие помощники монорепозитория [`orion76/clapp`](https://github.com/orion76/clapp): работа с файловой системой и поиск проекта, разборщики аргументов, файлы данных JSON/JSONC/YAML и lossless AST для JSON. Пакет не поставляет CLI: каждый помощник — обычная функция, экспортируемая из корня пакета.

## Возможности

- **Файловая система и поиск проекта** — `findProjectRoot`, `getProjectRoot`, `resolveProjectRoot`, `isProjectRoot`, `isFileInside`, `getCwd`, `getUserProfileDirectory`.
- **Доступ к `package.json`** — `loadPackageJson` читает и типизирует `package.json` заданного корня проекта.
- **Разборщики аргументов** — `parseDateString` и тип `TArgumentParseFunc` для колбэка `parseArg` в commander.
- **Файлы данных** — `readValue`, `writeValue`, `addValue`, `deleteValue` с адресацией по пути из ключей и индексов, поверх JSON, JSONC и YAML; формат определяется по расширению, а комментарии и порядок полей сохраняются при round-trip.
- **Lossless JSON AST** — `JsonAst.parse` / `JsonAst.unparse` сохраняют каждый байт исходного текста, включая пробелы, порядок ключей, написание чисел и экранирование строк.
- **Правка AST по пути** — `JsonAstEditor` (`node`, `has`, `get`, `set`, `push`, `delete`) правит разобранный документ на месте и повторяет стиль контейнера, в который пишет.
- **Защитники типов** — `isString`.

## Установка

Пакет ещё не опубликован в npm, поэтому `npm install @clapp/utils` ничего не установит до первого релиза. До этого пакет используется как workspace-пакет монорепозитория:

```bash
npm install @clapp/utils
```

## Использование

Каждый помощник реэкспортируется из корня пакета.

```ts
import { JsonAst, findProjectRoot, readValue } from '@clapp/utils';
```

### Модули

| Модуль       | Что предоставляет                                                                     |
| ------------ | ------------------------------------------------------------------------------------- |
| `fs.ts`      | `isProjectRoot`, `findProjectRoot`, `getProjectRoot`, `getCwd`, `isFileInside`         |
| `project.ts` | `loadPackageJson`                                                                      |
| `parse-arg/` | разборщики аргументов и их типы, например `parseDateString`                            |
| `data-file/` | `readValue`, `writeValue`, `addValue`, `deleteValue`, `detectFileFormat`, `escapePath` |
| `json-ast/`  | `JsonAst.parse` / `JsonAst.unparse`, `JsonAstEditor` по пути — lossless AST для JSON   |

### Файлы данных (`data-file`)

`data-file` читает и пишет документы JSON, JSONC и YAML по пути. Путь — это массив ключей объектов и индексов массивов (`TObjectPath`), например `['scripts', 'build']`. Бэкенд выбирается по расширению файла: `.json`/`.jsonc` используют `jsonc-parser` и сохраняют комментарии и висячие запятые, `.yaml`/`.yml` используют пакет `yaml` и сохраняют комментарии и порядок полей.

```ts
import { readValue, writeValue, addValue } from '@clapp/utils';

readValue('package.json', ['version']);
writeValue('package.json', ['version'], '1.0.0');
addValue('clapp.config.yml', ['plugins', 'PLUGIN_COMMAND'], { patterns: ['commands/**/*.plugin.{js,ts}'] });
```

### Lossless JSON AST (`json-ast`)

`json-ast` разбирает строгий JSON в дерево, которое хранит исходный текст документа и выгружает его обратно без изменений. Модуль предназначен для правки JSON с сохранением форматирования: в `data-file` он пока не подключён.

#### Публичный API

```ts
import { JsonAst, JsonAstEditor, JsonAstPathError } from '@clapp/utils';
import type { JsonAstNode, JsonAstNodeType, AstNodePos, JsonAstPath, JsonAstPathSegment } from '@clapp/utils';

const ast: JsonAstNode = JsonAst.parse('{"a": 1}');
const text: string = JsonAst.unparse(ast);
```

- `JsonAst.parse(json: string): JsonAstNode` — разбирает документ; возвращает корневой узел.
- `JsonAst.unparse(ast: JsonAstNode): string` — восстанавливает исходный текст.
- `JsonAstEditor` — экземпляр редактора над разобранным деревом с чтением по пути и правками, сохраняющими форматирование (`node`, `has`, `get`, `set`, `push`, `delete`; см. ниже).
- `JsonAstPathError` — сбой операции по пути; несёт `path` и `segmentIndex` (`null`, когда сбой относится ко всему пути).
- `JsonAstPath` / `JsonAstPathSegment` — `(string | number)[]` и `string | number`.
- `JsonAstNode` — интерфейс узла (`packages/utils/src/json-ast/types.ts:83`).
- `JsonAstNodeType` — `'object' | 'member' | 'array' | 'string' | 'number' | 'boolean' | 'null'`.
- `AstNodePos` — `{ line: number; column: number; offset: number }`, строка и столбец с 1, смещение с 0.

Модуль экспортируется из корня пакета (`packages/utils/src/index.ts:7`) через `packages/utils/src/json-ast/index.ts`, который реэкспортирует `json-ast.ts`, `types.ts` и каталог `editor/`. Фабрика парсера `parseJsonAst`, фабрика узлов `createNode` и помощники редактора (`path.ts`, `value.ts`, `build.ts`, `format.ts`) внутренние и остаются за пределами API пакета.

#### Модель узлов

Узел хранит исходный текст в своих атрибутах, а раскодированное значение JavaScript — отдельно:

- `prolog` — исходный текст перед содержимым узла;
- `body` — исходный текст литерала или строки в кавычках, вместе с кавычками;
- `epilog` — исходный текст после содержимого узла;
- `value` — раскодированное значение JavaScript.

| Узел      | `prolog`      | `body`                | `epilog`            | `value`              |
| --------- | ------------- | --------------------- | ------------------- | -------------------- |
| `object`  | `ws? "{" ws?` | —                     | `ws? "}" ws?`       | —                    |
| `member`  | —             | —                     | —                   | —                    |
| `array`   | `ws? "[" ws?` | —                     | `ws? "]" ws?`       | —                    |
| `string`  | —             | текст в кавычках      | —                   | раскодированная строка |
| `number`  | —             | исходный литерал      | —                   | `parseFloat(body)`   |
| `boolean` | —             | `true` / `false`      | —                   | `true` / `false`     |
| `null`    | —             | `null`                | —                   | `null`               |

У узла `member` два дочерних элемента: строка-ключ и значение. Двоеточие вместе с окружающими пробелами (`ws? ":" ws?`) хранится в `epilog` ключа. В объектах и массивах разделитель (`ws? "," ws?`) дописывается в `epilog` предыдущего члена или элемента.

Корень дерева — единственный узел-значение. Пробелы перед документом дописываются в его `prolog`, пробелы после него — в его `epilog`.

`unparse` обходит дерево через `ast.walk(callback, 'both')` и склеивает `prolog`, затем `body` (или `JSON.stringify(value)`, когда у узла нет body), затем `epilog` (`packages/utils/src/json-ast/json-ast.ts:63`). Поскольку каждый байт исходника лежит в одном из этих атрибутов, вывод совпадает с входом.

#### Гарантии round-trip

`JsonAst.unparse(JsonAst.parse(x)) === x` байт в байт, включая:

- пробелы, табы, переводы строк и CRLF, ведущие и хвостовые пробелы документа;
- порядок ключей и дубликаты ключей;
- написание чисел: `-0`, `42.0`, `1e+10`, `42.7e-10`, длинные целые;
- экранирование строк: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX` и суррогатные пары.

Правка не переформатирует документ. При выгрузке исходный `body` скаляра имеет приоритет над `value`, поэтому один только `node.set('value', …)` меняет раскодированное значение, не трогая выходной текст. Чтобы переписать литерал, задайте его `body` (и `value`, чтобы читатели оставались согласованными); окружающие отступы, разделители и остальной документ останутся нетронутыми.

```ts
import { JsonAst } from '@clapp/utils';

const source = `{
  "name": "clapp",
  "count": 1
}
`;

const ast = JsonAst.parse(source);

ast.walk((node) => {
  if (node.type() === 'number' && node.get('body') === '1') {
    node.set('body', '2');
    node.set('value', 2);
  }
});

JsonAst.unparse(ast); // same document, only `1` is replaced with `2`
```

#### Навигация и обход

- `type(): string` — тип узла.
- `attrs(): string[]` — имена всех атрибутов.
- `get(name: string): unknown` — один атрибут, `undefined`, если его нет.
- `set(name: string, value: unknown): JsonAstNode` — задать один атрибут; `undefined` удаляет его; возвращает узел.
- `pos(): AstNodePos` — позиция в исходнике.
- `parent(): JsonAstNode | null` — родительский узел, `null` для корня.
- `child(pos: number): JsonAstNode | null` — один дочерний узел; делегирует в `childs(pos)`.
- `childs(begin = 0, end = childCount): JsonAstNode[]` — копия диапазона дочерних узлов `[begin, end)`.
- `walk(callback, when = 'downward'): JsonAstNode` — обход в глубину; колбэк получает `(node, depth, parent, when)`, где `when` — `'downward'` до детей и `'upward'` после них; `'both'` выполняет обе фазы.

`childs` принимает только целые числа с `0 <= begin <= end <= childCount`; любой другой диапазон бросает `RangeError` с запрошенным диапазоном, числом детей и допустимым диапазоном (`packages/utils/src/json-ast/node.ts:94`). `child(pos)` реализован через `childs(pos)`, поэтому недопустимая позиция бросает тот же `RangeError`, а `null` возвращается только при `pos === childCount` (`packages/utils/src/json-ast/node.ts:75`).

```ts
const root = JsonAst.parse('{\n  "key": [1, "two"]\n}');

root.type();                       // 'object'
root.pos();                        // { line: 1, column: 1, offset: 0 }
root.parent();                     // null

const member = root.child(0);      // 'member'
member?.child(0)?.get('body');     // '"key"'
member?.child(0)?.get('epilog');   // ': '
member?.child(1)?.pos();           // { line: 2, column: 10, offset: 11 }

root.walk((node, depth, parent, when) => {
  // depth-first, source order
}, 'both');
```

#### Правка по пути (`JsonAstEditor`)

`JsonAstEditor` читает и правит разобранный документ по пути. Создайте один редактор над деревом, полученным из `JsonAst.parse`, и вызывайте его методы экземпляра: каждый метод работает с этим деревом на месте, поэтому других состояний у редактора нет, а результат после каждой правки рендерится через `JsonAst.unparse(ast)`. Статических методов нет.

Путь — массив сегментов: строка — это ключ объекта, число — индекс массива, а в объекте — ключ `String(number)`; каноническая десятичная строка (`'0'`, `'1'`, ...) тоже принимается как индекс массива. При дубликатах ключей побеждает последнее вхождение, ровно как в `JSON.parse`. Пустой путь адресует корень документа при чтении, а `set` и `delete` его отклоняют; `push` принимает его только тогда, когда корень сам является массивом.

```ts
import { JsonAst, JsonAstEditor } from '@clapp/utils';

const ast = JsonAst.parse('{"name": "clapp", "scripts": {"build": "rollup -c"}, "tags": []}');
const editor = new JsonAstEditor(ast);

editor.get(['scripts', 'build']); // 'rollup -c'
editor.has(['scripts', 'test']); // false

editor.set(['name'], 'clapp-2'); // replace an existing value
editor.set(['scripts', 'test'], 'jest'); // create a missing key
editor.push(['tags'], 'cli'); // append to an existing array
editor.delete(['scripts', 'build']);

JsonAst.unparse(ast); // {"name": "clapp-2", "scripts": {"test": "jest"}, "tags": ["cli"]}
```

- `node(path)` — адресованный узел: узел-значение члена объекта, элемент массива или корень документа для пустого пути.
- `has(path)` — существует ли путь целиком. Сначала проверяются сегменты, поэтому сегмент, который не является строкой или неотрицательным целым числом, бросает `JsonAstPathError`; отсутствующий ключ, отсутствующий индекс, индекс за границей массива, неканоническая строка-индекс и путь через скаляр возвращают `false`.
- `get(path)` — обычные значения JavaScript: объекты в порядке документа (последний дубликат ключа побеждает), массивы и скалярный `value`; исходные `prolog`/`body`/`epilog` никогда не раскрываются.
- `set(path, value)` — записывает значение. Существующий адрес заменяется: скаляр, заменённый скаляром того же типа, переписывает только свой литерал, а любая другая замена пересобирает узел, чтобы `type()` описывал новое значение. Отсутствующий адрес создаётся внутри существующего родителя: объект получает новый ключ, дописанный после его членов, а массив — новый элемент при `index === length` (больший индекс — ошибка, используйте `push`). Промежуточные сегменты никогда не создаются: родитель должен существовать и быть объектом или массивом.
- `push(path, value)` — дописывает значение в конец существующего массива, адресованного путём (или в корень документа, если тот является массивом, при пустом пути). Отсутствующий путь, скаляр и объект — ошибки.
- `delete(path)` — удаляет член объекта или элемент массива и подчищает разделитель предыдущего члена, сохраняя остальной его текст (например, закрывающую скобку соседнего контейнера). Контейнер, ставший пустым, нормализуется в `{}`/`[]`; путь должен существовать.

Каждый нетронутый байт документа остаётся как есть. Новый текст повторяет стиль принимающего контейнера: многострочный контейнер использует свой отступ и перевод строки документа (CRLF, если текст контейнера уже использует его, иначе LF), однострочный — `, `, а пустой контейнер получает первое значение компактно. При добавлении значения хвостовая разметка предыдущего ребёнка переезжает к новому последнему ребёнку, поэтому разделитель пишется сразу после содержимого. `pos()` не пересчитывается: позиции описывают исходный разбор, собранный узел сохраняет позицию заменённого узла или принимающего контейнера, а `JsonAst.unparse` позиции не использует.

Сбои по пути бросают `JsonAstPathError` с полным `path` и `segmentIndex` сбойного сегмента (`null`, когда некорректен сам путь). Значения, которые не являются JSON (`undefined`, функция, символ, bigint, `NaN`, `Infinity`, не-простой объект), и циклические ссылки бросают обычный `Error` до того, как дерево будет затронуто.

#### Ошибки

- `parse` бросает `Error`, когда аргумент не строка (`invalid JSON argument (expected type string)`), и на некорректном JSON. Сообщение о синтаксической ошибке начинается с `parse: JSON parsing failure:`, несёт `line`, `column` и `offset` и включает проблемную строку исходника с кареткой под ошибочным символом (`packages/utils/src/json-ast/parse.ts:54`).
- `unparse` бросает `Error`, когда аргумент не узел AST (`generate: invalid AST argument (expected type object)`).
- `childs`/`child` бросают `RangeError` на недопустимых диапазонах и позициях.

```ts
import { JsonAst } from '@clapp/utils';

try {
  JsonAst.parse('{"a":}');
} catch (error) {
  // Error: parse: JSON parsing failure: expected a JSON value but found character "}" at line 1, column 6, offset 5
  // {"a":}
  //      ^
}

const array = JsonAst.parse('[10, 20, 30]');
try {
  array.childs(2, 1);
} catch (error) {
  // RangeError: childs: invalid range [2, 1) for 3 children
  // (expected integers with 0 <= begin <= end <= 3)
}
```

#### Границы

- Грамматика — строгий JSON: без комментариев и висячих запятых. JSONC остаётся задачей `jsonc-parser` в `data-file` (`packages/utils/src/data-file/formats/json/json.ts:11`).
- Нет `dump`, цветного вывода, CLI/`bin` и языка запросов к AST. Структурные правки ограничены одним существующим или новым значением за раз через `JsonAstEditor` (`set`/`push`/`delete`): никаких переносов и копирований между документами, массовых правок, patch/diff.
- Парсер — независимая реализация рекурсивного спуска (`packages/utils/src/json-ast/parse.ts:78`). Он не использует инструменты PEG/ASTy и не добавляет зависимостей: runtime-зависимости по-прежнему `jsonc-parser`, `object-path` и `yaml` (плюс peer-зависимость `@orion76/logger`).
- Модель lossless-атрибутов вдохновлена [json-asty](https://github.com/rse/json-asty) 1.3.4 (MIT, Copyright © 2018-2026 Dr. Ralf S. Engelschall); код — независимая реализация. Атрибуция повторена в заголовках модулей (`packages/utils/src/json-ast/json-ast.ts:10`, `parse.ts:5`, `node.ts:4`, `types.ts:4`).

#### Проверка

```bash
npm run test:jest -w @clapp/utils -- json-ast
npx tsc --noEmit -p packages/utils/tsconfig.tests.json
npm run build:utils
```

Наборы тестов `json-ast` — это `packages/utils/tests/json-ast.test.ts` (round-trip, форма AST, контракт `childs`/`child` и ошибки разбора) и `packages/utils/tests/json-ast-editor.test.ts` (чтение, `set`/`push`/`delete`, форматирование, CRLF, пути ошибок и инварианты). Остальные наборы `data-*` сейчас красные по уже существовавшей причине после рефакторинга `data-file/formats/**` (отслеживается отдельно); полный прогон пакета не зелёный, пока это не исправлено.

## Связанные пакеты

| Пакет                                                                       | Репозиторий                                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`@clapp/common`](https://www.npmjs.com/package/@clapp/common)               | [`orion76/clapp-common`](https://github.com/orion76/clapp-common)                         |
| [`@clapp/core`](https://www.npmjs.com/package/@clapp/core)                   | [`orion76/clapp-core`](https://github.com/orion76/clapp-core)                             |
| [`@clapp/ai-workflow-plugins`](https://www.npmjs.com/package/@clapp/ai-workflow-plugins) | [`orion76/clapp-ai-workflow-plugins`](https://github.com/orion76/clapp-ai-workflow-plugins) |
| [`@clapp/ai-workflow-cli`](https://www.npmjs.com/package/@clapp/ai-workflow-cli) | [`orion76/clapp-ai-workflow-cli`](https://github.com/orion76/clapp-ai-workflow-cli)       |
| [`@clapp/ai-workflow-mcp`](https://www.npmjs.com/package/@clapp/ai-workflow-mcp) | [`orion76/clapp-ai-workflow-mcp`](https://github.com/orion76/clapp-ai-workflow-mcp)       |

## Лицензия

MIT
