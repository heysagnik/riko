export function escapeForTag(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
