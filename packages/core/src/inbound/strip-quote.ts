// Every outbound email ends with an "Unsubscribe: <link>" footer, and most
// clients quote the entire original message below a reply. Without this,
// classification and promise-extraction run over the footer too - which is
// how a plain "thanks, I'll pay this Friday" reply gets read as an
// unsubscribe request purely because the quoted original contained the word.

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

  // Lines a client prefixed with "> " are quoted regardless of whether a
  // header was found first (forwarding chains, plain-text clients).
  const withoutQuoteMarkers = withoutQuoteBlock
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

  return withoutQuoteMarkers.trim();
}
