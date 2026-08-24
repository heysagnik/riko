// A value containing a literal "</tag>" could otherwise close a boundary tag
// early and inject text the model reads as being outside the data block it
// was meant to stay inside.
export function escapeForTag(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
