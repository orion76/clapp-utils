/**
 * Formatting of inserted and built nodes.
 *
 * The style of a container is read from its own text: whether it is multiline, how its
 * children are indented, which separator and which line break (`'\n'` or `'\r\n'`) it uses.
 * Insertions and built containers follow that style, so the rest of the document keeps its
 * bytes.
 */
import { insertChild } from '../node';
import type { JsonAstNode } from '../types';
import type { BuildStyle, ContainerStyle } from './types';

/** Key/value separator used when a container has no member to copy the separator from. */
export const KEY_SEPARATOR = ': ';

/** Indentation step used for a nested container when the host container is single-line. */
export const DEFAULT_INDENT_STEP = '  ';

/** Kind of one lexical item of the raw text around a node. */
type TriviaTokenKind = 'space' | 'comment' | 'comma' | 'raw';

/** One lexical item of the raw text around a node (`prolog`/`epilog`). */
interface TriviaToken {
  /** Kind of the item: whitespace, comment, separator comma or a single raw character. */
  readonly kind: TriviaTokenKind;
  /** Raw text of the item. */
  readonly text: string;
}

/** Whether the character is JSON whitespace. */
function isWhitespaceChar(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

/**
 * Split the raw text around a node into whitespace, comment, comma and raw items.
 *
 * Comments are recognised as text and stay whole, so a comma or a bracket inside a
 * comment is never mistaken for structural text.
 *
 * @returns the items, or `null` when the text ends inside a block comment
 */
function tokenizeTrivia(text: string): TriviaToken[] | null {
  const tokens: TriviaToken[] = [];
  let offset = 0;
  while (offset < text.length) {
    const char = text.charAt(offset);
    if (isWhitespaceChar(char)) {
      let end = offset + 1;
      while (end < text.length && isWhitespaceChar(text.charAt(end))) {
        end += 1;
      }
      tokens.push({ kind: 'space', text: text.slice(offset, end) });
      offset = end;
      continue;
    }
    if (char === '/' && text.charAt(offset + 1) === '/') {
      const newline = text.indexOf('\n', offset + 2);
      const end = newline === -1 ? text.length : newline;
      tokens.push({ kind: 'comment', text: text.slice(offset, end) });
      offset = end;
      continue;
    }
    if (char === '/' && text.charAt(offset + 1) === '*') {
      const close = text.indexOf('*/', offset + 2);
      if (close === -1) {
        return null;
      }
      const end = close + 2;
      tokens.push({ kind: 'comment', text: text.slice(offset, end) });
      offset = end;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma', text: ',' });
      offset += 1;
      continue;
    }
    tokens.push({ kind: 'raw', text: char });
    offset += 1;
  }
  return tokens;
}

/** Join lexical items back into text. */
function renderTokens(tokens: TriviaToken[]): string {
  return tokens.map((token) => token.text).join('');
}

/** Copy of the items without trailing whitespace items. */
function trimTrailingSpaces(tokens: TriviaToken[]): TriviaToken[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1].kind === 'space') {
    end -= 1;
  }
  return tokens.slice(0, end);
}

/** Index of the last separator comma, `-1` when the items hold none. */
function lastCommaIndex(tokens: TriviaToken[]): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].kind === 'comma') {
      return index;
    }
  }
  return -1;
}

/** Index of the last raw item, `-1` when the items hold none. */
function lastRawIndex(tokens: TriviaToken[]): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].kind === 'raw') {
      return index;
    }
  }
  return -1;
}

/** Whether the last comment of the items is a `//` comment (its line break is elsewhere). */
function lastCommentIsLine(tokens: TriviaToken[]): boolean {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].kind === 'comment') {
      return tokens[index].text.startsWith('//');
    }
  }
  return false;
}

/** Join a head and a tail, keeping a space before a comment that would touch the head. */
function joinComment(head: string, tail: string): string {
  if (tail.startsWith('/') && head !== '' && !isWhitespaceChar(head.charAt(head.length - 1))) {
    return `${head} ${tail}`;
  }
  return tail;
}

/**
 * Offset of the first raw occurrence of a bracket in the text around a node.
 *
 * @returns the offset, `-1` when the bracket is absent
 */
function bracketOffset(text: string, bracket: string): number {
  const tokens = tokenizeTrivia(text);
  if (tokens === null) {
    return text.indexOf(bracket);
  }
  let offset = 0;
  for (const token of tokens) {
    if (token.kind === 'raw' && token.text === bracket) {
      return offset;
    }
    offset += token.text.length;
  }
  return -1;
}

/**
 * Read a string attribute of a node.
 *
 * @returns the attribute value, `''` when it is absent or not a string
 */
export function attribute(node: JsonAstNode, name: string): string {
  const value = node.get(name);
  return typeof value === 'string' ? value : '';
}

/** Check whether a node is an object or an array. */
function isContainer(node: JsonAstNode): boolean {
  const type = node.type();
  return type === 'object' || type === 'array';
}

/** Opening and closing bracket of a container node. */
function brackets(container: JsonAstNode): [string, string] {
  return container.type() === 'object' ? ['{', '}'] : ['[', ']'];
}

/**
 * Formatting of a container taken from its own text.
 *
 * A container is multiline when its `prolog` or its `epilog` contains a newline; the child
 * indent is the whitespace after the last newline of the `prolog` and the separator is `,`
 * plus a newline plus that indent. A single-line container separates children with `, `.
 * The line break comes from the container text: CRLF when it appears there, LF otherwise,
 * so an inserted line never mixes the two styles.
 */
export function containerStyle(container: JsonAstNode): ContainerStyle {
  const prolog = attribute(container, 'prolog');
  const epilog = attribute(container, 'epilog');
  const newline = lineBreak(prolog, epilog);
  if (!prolog.includes('\n') && !epilog.includes('\n')) {
    return { multiline: false, indent: '', separator: ', ', newline };
  }
  const indent = leadingWhitespace(lastLine(prolog));
  return { multiline: true, indent, separator: `,${newline}${indent}`, newline };
}

/**
 * Line break used by the document around a container: `'\r\n'` when the given text already
 * uses CRLF, `'\n'` otherwise.
 */
export function lineBreak(prolog: string, epilog: string): string {
  return prolog.includes('\r\n') || epilog.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Indentation of the bracket line of a container, derived from the whitespace before its
 * closing bracket.
 */
export function ownIndent(container: JsonAstNode): string {
  const epilog = attribute(container, 'epilog');
  const newline = epilog.lastIndexOf('\n');
  if (newline === -1) {
    return '';
  }
  return leadingWhitespace(epilog.slice(newline + 1));
}

/**
 * Indentation added by one nesting level of a container: the difference between the indent
 * of its children and the indent of its own closing bracket (`''` for the root).
 */
export function indentStep(container: JsonAstNode, style: ContainerStyle): string {
  const own = ownIndent(container);
  return style.indent.startsWith(own) ? style.indent.slice(own.length) : style.indent;
}

/** Build context for a value inserted into the given container. */
export function buildStyleFor(container: JsonAstNode, style: ContainerStyle): BuildStyle {
  if (!style.multiline) {
    return { multiline: false, indent: '', step: DEFAULT_INDENT_STEP, newline: style.newline };
  }
  return { multiline: true, indent: style.indent, step: indentStep(container, style), newline: style.newline };
}

/** Last line of a text. */
export function lastLine(text: string): string {
  const newline = text.lastIndexOf('\n');
  return newline === -1 ? text : text.slice(newline + 1);
}

/** Leading spaces and tabs of a text. */
export function leadingWhitespace(text: string): string {
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char !== ' ' && char !== '\t') {
      break;
    }
    index += 1;
  }
  return text.slice(0, index);
}

/**
 * Text of a node that belongs to the document around it, before the node content: the whole
 * `prolog` of a scalar, the part of a container `prolog` before its opening bracket.
 */
export function outsidePrefix(node: JsonAstNode): string {
  const prolog = attribute(node, 'prolog');
  if (!isContainer(node)) {
    return prolog;
  }
  const [open] = brackets(node);
  const index = bracketOffset(prolog, open);
  return index === -1 ? prolog : prolog.slice(0, index);
}

/**
 * Text of a node that belongs to the document around it, after the node content: the whole
 * `epilog` of a scalar, the part of a container `epilog` after its closing bracket.
 */
export function outsideSuffix(node: JsonAstNode): string {
  const epilog = attribute(node, 'epilog');
  if (!isContainer(node)) {
    return epilog;
  }
  const [, close] = brackets(node);
  const index = bracketOffset(epilog, close);
  return index === -1 ? '' : epilog.slice(index + 1);
}

/**
 * Normalise an empty container to `{}` or `[]`: the inner whitespace is dropped, the
 * whitespace around the container is kept.
 *
 * Inner comments are text, not whitespace: when the container holds one, the inner text is
 * kept instead of being dropped, so the comment survives the normalisation.
 */
export function normalizeContainer(container: JsonAstNode): void {
  const [open, close] = brackets(container);
  const prolog = attribute(container, 'prolog');
  const epilog = attribute(container, 'epilog');
  const openIndex = bracketOffset(prolog, open);
  const closeIndex = bracketOffset(epilog, close);
  const outsideOpen = openIndex === -1 ? prolog : prolog.slice(0, openIndex + 1);
  const outsideClose = closeIndex === -1 ? epilog : epilog.slice(closeIndex);
  const inner =
    (openIndex === -1 ? '' : prolog.slice(openIndex + 1)) +
    (closeIndex === -1 ? '' : epilog.slice(0, closeIndex));
  if (!inner.includes('/')) {
    container.set('prolog', outsideOpen);
    container.set('epilog', outsideClose);
    return;
  }
  container.set('prolog', outsideOpen + inner);
  container.set('epilog', outsideClose);
}

/**
 * Prepare a container for an insertion: an empty container becomes compact (`{}`/`[]`) so
 * the first child is added without line breaks.
 *
 * @returns the formatting the container will use for the new child
 */
export function prepareContainerForInsert(container: JsonAstNode): ContainerStyle {
  if (container.childs().length === 0) {
    normalizeContainer(container);
  }
  return containerStyle(container);
}

/**
 * Node that holds the text after the content of a child: the value of a `member` (a member
 * itself carries no text of its own), the node itself for an array element or a scalar.
 */
function contentEnd(node: JsonAstNode): JsonAstNode {
  if (node.type() !== 'member') {
    return node;
  }
  const value = node.child(1);
  return value === null ? node : value;
}

/**
 * Text of a container `epilog` up to and including its closing bracket.
 *
 * The parser stores `ws? <bracket> ws?` in the container `epilog`; this helper keeps the
 * bracket (and the whitespace before it) and leaves the trailing trivia to the caller.
 */
function containerPrefix(container: JsonAstNode, epilog: string): string {
  const [, close] = brackets(container);
  const index = bracketOffset(epilog, close);
  return index === -1 ? '' : epilog.slice(0, index + 1);
}

/**
 * Add the text that separates the last child from a new one.
 *
 * The returned text is the given `epilog` with a separator comma and the layout of the
 * container (`\n` plus indent, or a space) placed after the content, while comments and
 * other trivia stay where they were. A trailing comma already present in the `epilog` is
 * reused instead of adding a second one, so appending to a JSONC document with a trailing
 * comma stays valid and keeps its comments.
 *
 * @param epilog - trailing text of the previous child (brackets, trivia, separators)
 * @param style - formatting of the receiving container
 * @returns the new trailing text
 */
function appendSeparator(epilog: string, style: ContainerStyle): string {
  const layout = style.separator.slice(1);
  const tokens = tokenizeTrivia(epilog);
  if (tokens === null) {
    return epilog + style.separator;
  }
  const commaIndex = lastCommaIndex(tokens);
  if (commaIndex !== -1) {
    const head = tokens.slice(0, commaIndex);
    const headText = lastCommentIsLine(head) ? renderTokens(head) : renderTokens(trimTrailingSpaces(head));
    const tailText = renderTokens(trimTrailingSpaces(tokens.slice(commaIndex + 1)));
    return `${headText},${joinComment(headText, tailText)}${layout}`;
  }
  const insertAt = lastRawIndex(tokens) + 1;
  const headText = renderTokens(tokens.slice(0, insertAt));
  const tailText = renderTokens(trimTrailingSpaces(tokens.slice(insertAt)));
  return `${headText},${joinComment(headText, tailText)}${layout}`;
}

/** Trailing layout of a child `epilog`: spaces, tabs and line breaks at its end. */
const TRAILING_LAYOUT = /[ \t\r\n]+$/;

/**
 * Cut the trailing layout (spaces, tabs and line breaks) off a text and return both parts.
 *
 * The parser stores the text before a container's closing bracket in the `epilog` of the
 * last child, so the layout at the end of a child `epilog` belongs after the whole child
 * content in the document. When a new child is appended, that layout has to move to the new
 * last child, otherwise the closing bracket would lose its line break.
 *
 * @returns the text without the layout and the cut layout itself (`''` when absent)
 */
function takeTrailingLayout(text: string): { text: string; layout: string } {
  const trimmed = text.replace(TRAILING_LAYOUT, '');
  if (trimmed === text) {
    return { text, layout: '' };
  }
  return { text: trimmed, layout: text.slice(trimmed.length) };
}

/**
 * Append a detached node to a container and place the separator.
 *
 * The separator goes into the text after the previous child, so the new child closes the
 * container; an empty container receives its first child compactly. Only the end of a
 * container is supported: the editor API no longer inserts into the middle.
 *
 * The text after a `member` is split between its value node and the member itself, so the
 * two parts are joined before the separator is placed and split back afterwards: the value
 * keeps its own closing bracket, the separator and the comments go into the member. The
 * trailing layout of the previous child (the line break and indent before the closing
 * bracket) moves to the new child, so the bracket keeps its place. Comments are never
 * synthesised and never dropped.
 */
export function appendChild(container: JsonAstNode, child: JsonAstNode, style: ContainerStyle): void {
  const children = container.childs();
  if (children.length === 0) {
    insertChild(container, 0, child);
    return;
  }
  const previous = children[children.length - 1];
  const content = contentEnd(previous);
  const contentEpilog = attribute(content, 'epilog');
  if (content === previous) {
    const { text, layout } = takeTrailingLayout(contentEpilog);
    content.set('epilog', appendSeparator(text, style));
    if (layout !== '') {
      child.set('epilog', attribute(child, 'epilog') + layout);
    }
    insertChild(container, children.length, child);
    return;
  }
  const prefix = containerPrefix(content, contentEpilog);
  const trailing = contentEpilog.slice(prefix.length) + attribute(previous, 'epilog');
  const { text, layout } = takeTrailingLayout(trailing);
  content.set('epilog', prefix);
  previous.set('epilog', appendSeparator(text, style));
  if (layout !== '') {
    child.set('epilog', attribute(child, 'epilog') + layout);
  }
  insertChild(container, children.length, child);
}

/** Trailing separator of a child `epilog`: `ws? "," ws?` as the parser stores it. */
const TRAILING_SEPARATOR = /\s*,\s*$/;

/**
 * Remove the trailing separator from the `epilog` of a member or an element.
 *
 * The parser appends `ws? "," ws?` to the `epilog` of the preceding child, while a container
 * child keeps its own closing bracket at the start of its `epilog` (`outsideSuffix` cuts
 * exactly that part off). Clearing the whole `epilog` would therefore drop the bracket of a
 * container child and leave invalid JSON, so only the comma and the whitespace around it are
 * removed: `, `, `,\n  ` and `,\r\n` disappear, everything before them stays. Comments are
 * kept: a comma between them and the surrounding whitespace goes, the comment text stays.
 * When the `epilog` does not end with a separator it is left untouched.
 */
export function stripTrailingSeparator(node: JsonAstNode): void {
  const epilog = attribute(node, 'epilog');
  if (!epilog.includes(',')) {
    return;
  }
  const tokens = epilog.includes('/') ? tokenizeTrivia(epilog) : null;
  if (tokens === null) {
    const stripped = epilog.replace(TRAILING_SEPARATOR, '');
    if (stripped !== epilog) {
      node.set('epilog', stripped);
    }
    return;
  }
  const commaIndex = lastCommaIndex(tokens);
  if (commaIndex === -1) {
    return;
  }
  const head = tokens.slice(0, commaIndex);
  const headText = lastCommentIsLine(head) ? renderTokens(head) : renderTokens(trimTrailingSpaces(head));
  const tailText = renderTokens(trimTrailingSpaces(tokens.slice(commaIndex + 1)));
  node.set('epilog', headText + joinComment(headText, tailText));
}

/**
 * Key/value separator of a new object member: the `epilog` of the first existing key, or
 * the standard `": "` when the object has no members. A key `epilog` that holds a comment
 * is not copied, so a new member never synthesises a comment.
 */
export function keySeparator(object: JsonAstNode): string {
  const member = object.child(0);
  const key = member === null ? null : member.child(0);
  if (key === null) {
    return KEY_SEPARATOR;
  }
  const epilog = attribute(key, 'epilog');
  return epilog === '' || epilog.includes('/') ? KEY_SEPARATOR : epilog;
}
