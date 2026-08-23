const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Clients mangle In-Reply-To and forwards drop it; a plus-tag survives both.
export function taggedReplyTo(baseAddress: string, caseId: string): string {
  const at = baseAddress.lastIndexOf("@");
  if (at <= 0) return baseAddress;
  const local = baseAddress.slice(0, at);
  const domain = baseAddress.slice(at + 1);
  if (local.includes("+")) return baseAddress;
  return `${local}+${caseId}@${domain}`;
}

export function caseIdFromRecipient(recipients: (string | null | undefined)[]): string | null {
  for (const recipient of recipients) {
    if (!recipient) continue;
    for (const match of recipient.matchAll(/\+([0-9a-f-]{36})@/gi)) {
      const candidate = match[1]!;
      if (UUID.test(candidate)) return candidate.toLowerCase();
    }
  }
  return null;
}
