function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, lineStart + 512))?.[0] ?? '';
  return match;
}

function detectIndentUnit(text: string): string {
  const lines = text.split(/\r?\n/);
  let smallest: string | null = null;
  for (const line of lines) {
    const match = line.match(/^([ \t]+)\S/);
    if (match) {
      const candidate = match[1];
      if (!smallest || candidate.length < smallest.length) {
        smallest = candidate;
      }
    }
  }
  if (smallest) {
    return smallest.startsWith('\t') ? '\t' : smallest;
  }
  return '  ';
}
