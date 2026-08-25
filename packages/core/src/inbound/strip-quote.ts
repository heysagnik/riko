
const QUOTE_HEADER_PATTERNS = [
  /^on .{0,120} wrote:\s*$/im,
  /^-{2,}\s*original message\s*-{2,}\s*$/im,
  /^from:\s.+$/im,
  /^sent:\s.+$/im,
];

export function stripQuotedContent(text: string): string {
  let cutIndex = text.length;

  for (const pattern of QUOTE_HEADER_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.index < cutIndex) {
      cutIndex = match.index;
    }
  }

  const withoutQuoteBlock = text.slice(0, cutIndex);

  const withoutQuoteMarkers = withoutQuoteBlock
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

  return withoutQuoteMarkers.trim();
}
