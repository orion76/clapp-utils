/**
 * Lossless JSON parser: recursive descent over a strict JSON grammar.
 *
 * Every node keeps the raw text of the document in its attributes, so `JsonAst.unparse`
 * reproduces the input byte for byte. The lossless attribute model is inspired by
 * json-asty 1.3.4 (https://github.com/rse/json-asty, MIT, Copyright (c) 2018-2026
 * Dr. Ralf S. Engelschall); the parser below is an independent implementation.
 *
 * The grammar is strict JSON: no comments and no trailing commas.
 */
import { createNode } from './node';
import type { AstNodePos, JsonAstNode, JsonAstNodeType } from './types';

/** Characters treated as JSON whitespace. */
const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/** Decoded value of a single character escape sequence. */
const SIMPLE_ESCAPES = new Map<string, string>([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);

/** A single hexadecimal digit of a `\uXXXX` escape sequence. */
const HEX_DIGIT = /^[0-9a-fA-F]$/;

/** Maximum length of the source excerpt included into a parse error message. */
const EXCERPT_MAX_WIDTH = 80;

/**
 * Parse JSON text into the lossless AST.
 *
 * @param json - JSON document
 * @returns the root node of the AST
 * @throws {Error} when the argument is not a string, or when the text is not valid JSON
 * (the message carries the position and a source excerpt of the failure)
 */
export function parseJsonAst(json: string): JsonAstNode {
  if (typeof json !== 'string') {
    throw new Error('invalid JSON argument (expected type string)');
  }
  return new JsonParser(json).parseDocument();
}

/**
 * Format a parse error message: `parse: JSON parsing failure:` plus the reason, the
 * position and the offending source line with a caret below the offending character.
 */
function formatParseError(json: string, position: AstNodePos, reason: string): string {
  const { line, column, offset } = position;
  const lineStart = offset - (column - 1);
  const newline = json.indexOf('\n', lineStart);
  const lineEnd = newline === -1 ? json.length : newline;
  let excerpt = json.slice(lineStart, lineEnd);
  if (excerpt.endsWith('\r')) {
    excerpt = excerpt.slice(0, -1);
  }
  const focus = column - 1;
  let windowStart = 0;
  if (excerpt.length > EXCERPT_MAX_WIDTH) {
    const centered = focus - Math.floor(EXCERPT_MAX_WIDTH / 2);
    windowStart = Math.max(0, Math.min(centered, excerpt.length - EXCERPT_MAX_WIDTH));
  }
  const window = excerpt.slice(windowStart, windowStart + EXCERPT_MAX_WIDTH);
  const caret = `${' '.repeat(Math.max(0, focus - windowStart))}^`;
  return (
    `parse: JSON parsing failure: ${reason} at line ${line}, column ${column}, offset ${offset}\n` +
    `${window}\n${caret}\n`
  );
}

/** Recursive descent parser over one JSON document. */
class JsonParser {
  private readonly json: string;
  private offset = 0;
  private line = 1;
  private column = 1;

  constructor(json: string) {
    this.json = json;
  }

  /**
   * Parse the document: `ws? value ws? eof`.
   *
   * The leading whitespace is prefixed to the `prolog` of the root node, the trailing
   * whitespace is appended to its `epilog`, exactly as the lossless model prescribes.
   */
  parseDocument(): JsonAstNode {
    const prolog = this.readWhitespace();
    const value = this.parseValue();
    const epilog = this.readWhitespace();
    const trailing = this.peek();
    if (trailing !== undefined) {
      throw this.error(`unexpected ${this.describe(trailing)} after the top-level value`);
    }
    if (prolog !== '') {
      value.set('prolog', prolog + this.readAttribute(value, 'prolog'));
    }
    if (epilog !== '') {
      value.set('epilog', this.readAttribute(value, 'epilog') + epilog);
    }
    return value;
  }

  /** Parse `ws? "{" ws?` (`member` (`ws? "," ws?` `member`)*)? `ws? "}" ws?`. */
  private parseObject(): JsonAstNode {
    const pos = this.position();
    const prologBegin = this.offset;
    this.expect('{');
    this.readWhitespace();
    const prolog = this.json.slice(prologBegin, this.offset);
    const members: JsonAstNode[] = [];
    if (this.peek() !== '}') {
      members.push(this.parseMember());
      while (this.separatorAhead()) {
        const separator = this.readSeparator();
        const previous = members[members.length - 1];
        previous.set('epilog', this.readAttribute(previous, 'epilog') + separator);
        members.push(this.parseMember());
      }
    }
    const epilog = this.readEpilog('}');
    return createNode('object', pos, { prolog, epilog }, members);
  }

  /** Parse `ws? "[" ws?` (`value` (`ws? "," ws?` `value`)*)? `ws? "]" ws?`. */
  private parseArray(): JsonAstNode {
    const pos = this.position();
    const prologBegin = this.offset;
    this.expect('[');
    this.readWhitespace();
    const prolog = this.json.slice(prologBegin, this.offset);
    const values: JsonAstNode[] = [];
    if (this.peek() !== ']') {
      values.push(this.parseValue());
      while (this.separatorAhead()) {
        const separator = this.readSeparator();
        const previous = values[values.length - 1];
        previous.set('epilog', this.readAttribute(previous, 'epilog') + separator);
        values.push(this.parseValue());
      }
    }
    const epilog = this.readEpilog(']');
    return createNode('array', pos, { prolog, epilog }, values);
  }

  /** Parse a member: a string key, `ws? ":" ws?` (stored in the key `epilog`) and a value. */
  private parseMember(): JsonAstNode {
    const pos = this.position();
    const name = this.parseString();
    const separatorBegin = this.offset;
    this.readWhitespace();
    this.expect(':');
    this.readWhitespace();
    name.set('epilog', this.json.slice(separatorBegin, this.offset));
    const value = this.parseValue();
    return createNode('member', pos, undefined, [name, value]);
  }

  /** Parse one JSON value at the current position. */
  private parseValue(): JsonAstNode {
    const char = this.peek();
    switch (char) {
      case '{':
        return this.parseObject();
      case '[':
        return this.parseArray();
      case '"':
        return this.parseString();
      case 't':
        return this.parseLiteral('true', true);
      case 'f':
        return this.parseLiteral('false', false);
      case 'n':
        return this.parseLiteral('null', null);
      default:
        if (char !== undefined && (char === '-' || (char >= '0' && char <= '9'))) {
          return this.parseNumber();
        }
        throw this.error(`expected a JSON value but found ${this.describe(char)}`);
    }
  }

  /** Parse `-? (0 | [1-9][0-9]*) (\.[0-9]+)? ([eE][+-]?[0-9]+)?`. */
  private parseNumber(): JsonAstNode {
    const pos = this.position();
    const begin = this.offset;
    if (this.peek() === '-') {
      this.step();
    }
    const first = this.peek();
    if (first === '0') {
      this.step();
    } else if (first !== undefined && first >= '1' && first <= '9') {
      this.step();
      while (this.isDigit(this.peek())) {
        this.step();
      }
    } else {
      throw this.error(`invalid number literal (expected a digit) but found ${this.describe(first)}`);
    }
    if (this.peek() === '.') {
      this.step();
      if (!this.isDigit(this.peek())) {
        throw this.error('invalid number literal (expected a digit after the decimal point)');
      }
      while (this.isDigit(this.peek())) {
        this.step();
      }
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.step();
      if (this.peek() === '+' || this.peek() === '-') {
        this.step();
      }
      if (!this.isDigit(this.peek())) {
        throw this.error('invalid number literal (expected a digit in the exponent)');
      }
      while (this.isDigit(this.peek())) {
        this.step();
      }
    }
    const next = this.peek();
    if (this.isDigit(next) || next === '.' || next === 'e' || next === 'E') {
      throw this.error(`invalid number literal ${JSON.stringify(this.json.slice(begin, this.offset + 1))}`);
    }
    const body = this.json.slice(begin, this.offset);
    return createNode('number', pos, { body, value: parseFloat(body) });
  }

  /** Parse a quoted string with JSON escapes. */
  private parseString(): JsonAstNode {
    const pos = this.position();
    const begin = this.offset;
    this.expect('"');
    let value = '';
    for (;;) {
      const char = this.peek();
      if (char === undefined) {
        throw this.error('unterminated string literal');
      }
      if (char === '"') {
        this.step();
        break;
      }
      if (char === '\\') {
        this.step();
        value += this.readEscape();
        continue;
      }
      if (char.charCodeAt(0) < 0x20) {
        throw this.error('unescaped control character in string literal');
      }
      value += char;
      this.step();
    }
    const body = this.json.slice(begin, this.offset);
    return createNode('string', pos, { body, value });
  }

  /** Parse the escape sequence after a backslash and return the decoded character. */
  private readEscape(): string {
    const char = this.peek();
    if (char === undefined) {
      throw this.error('unterminated escape sequence in string literal');
    }
    const simple = SIMPLE_ESCAPES.get(char);
    if (simple !== undefined) {
      this.step();
      return simple;
    }
    if (char !== 'u') {
      throw this.error(`invalid escape sequence ${JSON.stringify(`\\${char}`)} in string literal`);
    }
    this.step();
    let digits = '';
    for (let index = 0; index < 4; index += 1) {
      const digit = this.peek();
      if (digit === undefined || !HEX_DIGIT.test(digit)) {
        throw this.error('invalid unicode escape sequence in string literal');
      }
      digits += digit;
      this.step();
    }
    return String.fromCharCode(parseInt(digits, 16));
  }

  /** Parse `null`, `true` or `false`. */
  private parseLiteral(literal: 'null' | 'true' | 'false', value: null | boolean): JsonAstNode {
    const pos = this.position();
    for (let index = 0; index < literal.length; index += 1) {
      if (this.peek() !== literal.charAt(index)) {
        throw this.error(`invalid literal (expected ${JSON.stringify(literal)})`);
      }
      this.step();
    }
    const type: JsonAstNodeType = value === null ? 'null' : 'boolean';
    return createNode(type, pos, { body: literal, value });
  }

  /** Read `ws? "}" ws?` (or the given closing bracket) as the `epilog` of a container. */
  private readEpilog(closing: string): string {
    const begin = this.offset;
    this.readWhitespace();
    this.expect(closing);
    this.readWhitespace();
    return this.json.slice(begin, this.offset);
  }

  /** Read `ws? "," ws?` — the separator appended to the epilog of the previous element. */
  private readSeparator(): string {
    const begin = this.offset;
    this.readWhitespace();
    this.expect(',');
    this.readWhitespace();
    return this.json.slice(begin, this.offset);
  }

  /** Check whether a comma follows the current position, whitespace ignored. */
  private separatorAhead(): boolean {
    let offset = this.offset;
    while (offset < this.json.length && WHITESPACE.has(this.json.charAt(offset))) {
      offset += 1;
    }
    return this.json.charAt(offset) === ',';
  }

  /** Read and consume the run of JSON whitespace at the current position. */
  private readWhitespace(): string {
    const begin = this.offset;
    for (;;) {
      const char = this.peek();
      if (char === undefined || !WHITESPACE.has(char)) {
        break;
      }
      this.step();
    }
    return this.json.slice(begin, this.offset);
  }

  /** Consume the expected character or fail with its position. */
  private expect(char: string): void {
    if (this.peek() !== char) {
      throw this.error(`expected ${JSON.stringify(char)} but found ${this.describe(this.peek())}`);
    }
    this.step();
  }

  /** Read a string attribute, `''` when it is absent or not a string. */
  private readAttribute(node: JsonAstNode, name: string): string {
    const value = node.get(name);
    return typeof value === 'string' ? value : '';
  }

  /** Character at the current position (or `ahead` characters after it). */
  private peek(ahead = 0): string | undefined {
    const offset = this.offset + ahead;
    return offset < this.json.length ? this.json.charAt(offset) : undefined;
  }

  /** Consume one character, tracking the 1-based line and column. */
  private step(): void {
    const char = this.json.charAt(this.offset);
    this.offset += 1;
    if (char === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
  }

  /** Position of the current parsing point. */
  private position(): AstNodePos {
    return { line: this.line, column: this.column, offset: this.offset };
  }

  /** Whether the character is a decimal digit. */
  private isDigit(char: string | undefined): boolean {
    return char !== undefined && char >= '0' && char <= '9';
  }

  /** Human readable description of a character for error messages. */
  private describe(char: string | undefined): string {
    return char === undefined ? 'end of input' : `character ${JSON.stringify(char)}`;
  }

  /** Create the parse error for the current position. */
  private error(reason: string): Error {
    return new Error(formatParseError(this.json, this.position(), reason));
  }
}
