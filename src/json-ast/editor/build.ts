/**
 * Building of detached nodes for new values.
 *
 * A value passed to `set` or `add` is turned into a subtree that follows the formatting
 * context of the place it goes to; positions are taken from the anchor node, because the
 * editor never recalculates them.
 */
import { createNode } from '../node';
import type { AstNodePos, JsonAstNode, JsonAstNodeType } from '../types';
import { KEY_SEPARATOR } from './format';
import type { BuildStyle } from './types';

/**
 * Text of a scalar node for a new `body`: a quoted string, a number literal (with `-0`
 * kept), `true`, `false` or `null`.
 */
export function scalarText(value: string | number | boolean | null): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Object.is(value, -0) ? '-0' : String(value);
  }
  return value ? 'true' : 'false';
}

/** Node type of a scalar value. */
export function scalarType(value: string | number | boolean | null): JsonAstNodeType {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  return typeof value === 'number' ? 'number' : 'boolean';
}

/** Build a scalar node with the text and the decoded value of the argument. */
export function createScalarNode(value: string | number | boolean | null, pos: AstNodePos): JsonAstNode {
  return createNode(scalarType(value), pos, { body: scalarText(value), value });
}

/**
 * Build a node for a validated JSON value.
 *
 * @param value - validated JSON value
 * @param style - formatting context of the place the value goes to
 * @param pos - position to report from the new nodes
 * @returns a detached node with the whole subtree
 */
export function buildValue(value: unknown, style: BuildStyle, pos: AstNodePos): JsonAstNode {
  if (Array.isArray(value)) {
    return buildArray(value, style, pos);
  }
  if (value !== null && typeof value === 'object') {
    return buildObject(value as Record<string, unknown>, style, pos);
  }
  return createScalarNode(value as string | number | boolean | null, pos);
}

/**
 * Build an array node.
 *
 * An empty array stays compact (`[]`); a multiline context spreads the elements over lines
 * with one indentation step, a single-line context joins them with `, `.
 */
export function buildArray(values: unknown[], style: BuildStyle, pos: AstNodePos): JsonAstNode {
  if (values.length === 0) {
    return createNode('array', pos, { prolog: '[', epilog: ']' });
  }
  const children = childStyle(style);
  const separator = children.multiline ? `,${children.newline}${children.indent}` : ', ';
  const elements: JsonAstNode[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const element = buildValue(values[index], children, pos);
    if (index < values.length - 1) {
      element.set('epilog', separator);
    }
    elements.push(element);
  }
  if (!style.multiline) {
    return createNode('array', pos, { prolog: '[', epilog: ']' }, elements);
  }
  return createNode(
    'array',
    pos,
    { prolog: `[${children.newline}${children.indent}`, epilog: `${children.newline}${style.indent}]` },
    elements,
  );
}

/**
 * Build an object node.
 *
 * An empty object stays compact (`{}`); a multiline context spreads the members over lines
 * with one indentation step, a single-line context joins them with `, `. Keys use the
 * standard `": "` separator.
 */
export function buildObject(value: Record<string, unknown>, style: BuildStyle, pos: AstNodePos): JsonAstNode {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return createNode('object', pos, { prolog: '{', epilog: '}' });
  }
  const children = childStyle(style);
  const separator = children.multiline ? `,${children.newline}${children.indent}` : ', ';
  const members: JsonAstNode[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const member = createMember(key, value[key], children, KEY_SEPARATOR, pos);
    if (index < keys.length - 1) {
      member.set('epilog', separator);
    }
    members.push(member);
  }
  if (!style.multiline) {
    return createNode('object', pos, { prolog: '{', epilog: '}' }, members);
  }
  return createNode(
    'object',
    pos,
    { prolog: `{${children.newline}${children.indent}`, epilog: `${children.newline}${style.indent}}` },
    members,
  );
}

/**
 * Build a `member` node: a string key with the requested separator in its `epilog` and a
 * value node.
 */
export function createMember(key: string, value: unknown, style: BuildStyle, keySeparator: string, pos: AstNodePos): JsonAstNode {
  const name = createNode('string', pos, { body: JSON.stringify(key), value: key });
  name.set('epilog', keySeparator);
  return createNode('member', pos, undefined, [name, buildValue(value, style, pos)]);
}

/** Indentation added per nesting level inside the given build context. */
export function childStyle(style: BuildStyle): BuildStyle {
  if (!style.multiline) {
    return style;
  }
  return { multiline: true, indent: style.indent + style.step, step: style.step, newline: style.newline };
}
