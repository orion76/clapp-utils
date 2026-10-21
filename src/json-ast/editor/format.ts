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
  const index = prolog.indexOf(open);
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
  const index = epilog.indexOf(close);
  return index === -1 ? '' : epilog.slice(index + 1);
}

/**
 * Normalise an empty container to `{}` or `[]`: the inner whitespace is dropped, the
 * whitespace around the container is kept.
 */
export function normalizeContainer(container: JsonAstNode): void {
  const [open, close] = brackets(container);
  const prolog = attribute(container, 'prolog');
  const epilog = attribute(container, 'epilog');
  const openIndex = prolog.indexOf(open);
  const closeIndex = epilog.indexOf(close);
  container.set('prolog', openIndex === -1 ? open : prolog.slice(0, openIndex + 1));
  container.set('epilog', closeIndex === -1 ? epilog : epilog.slice(closeIndex));
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
 * Insert a detached node into a container and place the separator.
 *
 * Appending puts the separator into the `epilog` of the previous child; inserting anywhere
 * else puts it into the `epilog` of the new child, so it separates the new node from the
 * following one.
 */
export function insertIntoContainer(container: JsonAstNode, index: number, child: JsonAstNode, style: ContainerStyle): void {
  const children = container.childs();
  if (children.length === 0) {
    insertChild(container, 0, child);
    return;
  }
  if (index >= children.length) {
    const previous = children[children.length - 1];
    previous.set('epilog', attribute(previous, 'epilog') + style.separator);
    insertChild(container, children.length, child);
    return;
  }
  child.set('epilog', attribute(child, 'epilog') + style.separator);
  insertChild(container, index, child);
}

/**
 * Key/value separator of a new object member: the `epilog` of the first existing key, or
 * the standard `": "` when the object has no members.
 */
export function keySeparator(object: JsonAstNode): string {
  const member = object.child(0);
  const key = member === null ? null : member.child(0);
  if (key === null) {
    return KEY_SEPARATOR;
  }
  const epilog = attribute(key, 'epilog');
  return epilog === '' ? KEY_SEPARATOR : epilog;
}
