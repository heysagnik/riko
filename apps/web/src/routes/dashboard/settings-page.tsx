import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { useSaveSenderIdentity, useSenderIdentity } from "../../hooks/use-sender-identity.js";
import { useSaveOutreachSettings } from "../../hooks/use-outreach-settings.js";
import { cn } from "../../lib/utils.js";

const inputClass =
  "mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent";

const SAMPLE_TEXT = `Hi, the payment of INR 1.00 to your ABC Merchant subscription did not go through. This is because we were unable to verify the card. Nothing has been cancelled - updating your card takes about a minute and everything picks up where it left off. Update your payment method: https://riko.sagnik.fun/pay/1576b556-e03b-42ee-8c62-5b8ba7f513eb. If you have already sorted this out, you can ignore this email. Unsubscribe: https://riko.sagnik.fun/unsubscribe/11fb8ead-cdc1-4cfb-843e-244911da8e88`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const URL_PATTERN = /https?:\/\/\S+/g;
const LABEL_PATTERN = /([A-Za-z][\w '-]{2,60}):\s*$/;

function renderButton(label: string, url: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">` +
    `<tr><td style="background:#111111;">` +
    `<a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 18px;font-size:14px;font-weight:500;` +
    `color:#ffffff;text-decoration:none;font-family:inherit;">${escapeHtml(normalizePaymentCta(label))}</a>` +
    `</td></tr></table>`
  );
}

function normalizePaymentCta(label: string): string {
  const l = label.trim().toLowerCase();
  if (l === "update your payment method" || l === "update payment method" || l === "update payment") {
    return "Update payment details";
  }
  return label;
}

function renderFooterLink(label: string, url: string): string {
  return (
    `<p style="margin:20px 0 0;font-size:12px;">` +
    `<a href="${escapeHtml(url)}" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(label)}</a>` +
    `</p>`
  );
}

function renderParagraph(paragraph: string): string[] {
  const matches = [...paragraph.matchAll(URL_PATTERN)];
  if (matches.length === 0) {
    const text = paragraph.trim();
    return text ? [`<p style="margin:0 0 14px;">${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`] : [];
  }

  const blocks: string[] = [];
  let cursor = 0;
  let inline = "";

  const flushInline = () => {
    if (inline.trim().length > 0) {
      blocks.push(`<p style="margin:0 0 14px;">${inline.trim()}</p>`);
    }
    inline = "";
  };

  for (const match of matches) {
    const rawUrl = match[0];
    const url = rawUrl.replace(/[).,!?]+$/, "");
    const trailingPunctuation = rawUrl.slice(url.length);
    const idx = match.index ?? 0;
    const before = paragraph.slice(cursor, idx);
    const labelMatch = before.match(LABEL_PATTERN);

    if (labelMatch && labelMatch[1]) {
      const label = labelMatch[1].trim();
      const precedingText = before.slice(0, labelMatch.index).trim();
      if (precedingText) {
        inline += `${escapeHtml(precedingText)} `;
      }
      flushInline();
      blocks.push(/^unsubscribe$/i.test(label) ? renderFooterLink(label, url) : renderButton(label, url));
    } else {
      inline += `${escapeHtml(before)}<a href="${escapeHtml(url)}" style="color:#2563eb;">${escapeHtml(url)}</a>`;
    }

    cursor = idx + url.length + trailingPunctuation.length;
  }

  inline += escapeHtml(paragraph.slice(cursor)).replace(/\n/g, "<br/>");
  flushInline();
  return blocks;
}

function toParagraphHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .flatMap((para) => renderParagraph(para.trim()))
    .join("");
}

const SAMPLE_BODY = toParagraphHtml(SAMPLE_TEXT);

const FALLBACK_TEMPLATE = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;background:#f5f6f8;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:8px;">
    <div style="padding:20px 24px;border-bottom:1px solid #e4e7ec;font-weight:600;">{{merchant_name}}</div>
    <div style="padding:24px;font-size:14px;line-height:1.6;color:#1f2430;">{{content}}</div>
  </div>
</div>`;

function buildPreview(template: string, merchantName: string): string {
  const source = template.includes("{{content}}") ? template : FALLBACK_TEMPLATE;
  return source
    .split("{{content}}")
    .join(SAMPLE_BODY)
    .split("{{merchant_name}}")
    .join(merchantName || "Your business");
}

const SECTIONS = [
  { id: "sender-identity", label: "Sender identity" },
  { id: "smtp", label: "SMTP" },
  { id: "brand-template", label: "Brand template" },
  { id: "alerts", label: "Alerts" },
  { id: "send-window", label: "Send window" },
  { id: "pause-outreach", label: "Pause outreach" },
];

export function SettingsPage() {
  const { data, isLoading } = useSenderIdentity();
  const save = useSaveSenderIdentity();
  const saveCap = useSaveOutreachSettings();
  const identity = data?.senderIdentity ?? undefined;

  const [activeSection, setActiveSection] = useState<string>("sender-identity");

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [brandTemplateHtml, setBrandTemplateHtml] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [alertWebhookUrl, setAlertWebhookUrl] = useState("");
  const [dailySendCap, setDailySendCap] = useState("500");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const identity = data?.senderIdentity;
    if (!identity) return;
    setFromName(identity.fromName);
    setFromEmail(identity.fromEmail);
    setSmtpHost(identity.smtpHost ?? "");
    setSmtpPort(identity.smtpPort ? String(identity.smtpPort) : "587");
    setSmtpSecure(identity.smtpSecure);
    setSmtpUser(identity.smtpUser ?? "");
    setBrandTemplateHtml(identity.brandTemplateHtml ?? "");
    setAlertWebhookUrl(identity.alertWebhookUrl ?? "");
    setAddressLine(identity.addressLine ?? "");
    if (identity.dailySendCap) setDailySendCap(String(identity.dailySendCap));
  }, [data]);

  const smtpPasswordAlreadySet = data?.senderIdentity?.smtpPasswordSet ?? false;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (!smtpPassword && !smtpPasswordAlreadySet) {
      setError("SMTP password is required the first time you configure sending.");
      return;
    }

    try {
      await save.mutateAsync({
        fromName,
        fromEmail,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecure,
        smtpUser,
        smtpPassword: smtpPassword || undefined,
        brandTemplateHtml: brandTemplateHtml || undefined,
        addressLine: addressLine || undefined,
        alertWebhookUrl: alertWebhookUrl || undefined,
      });      setSmtpPassword("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const isFormSection =
    activeSection === "sender-identity" ||
    activeSection === "smtp" ||
    activeSection === "brand-template" ||
    activeSection === "alerts";

  return (
    <div>
      <div>
        <h1 className="text-title text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Sender identity, delivery, and outreach controls for your account.</p>
      </div>

      <div className="mt-6 overflow-x-auto lg:hidden">
        <Tabs value={activeSection} onValueChange={setActiveSection}>
          <TabsList className="w-max">
            {SECTIONS.map((section) => (
              <TabsTrigger key={section.id} value={section.id} className="shrink-0 whitespace-nowrap">
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[180px_1fr]">
        <nav className="hidden lg:block">
          <ul className="sticky top-8 space-y-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "block w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-150",
                    activeSection === section.id
                      ? "bg-accent/10 font-medium text-accent"
                      : "text-ink-muted hover:bg-surface-sunk hover:text-ink",
                  )}
                >
                  {section.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-2xl">
          {isFormSection ? (
            <form onSubmit={handleSubmit}>
              {activeSection === "sender-identity" ? (
                <section>
                  <h2 className="text-subtitle text-ink">Sender identity</h2>
                  <p className="mt-1 text-sm text-ink-muted">Outreach is sent from your domain, not from Riko.</p>
                  <div className="mt-4 space-y-3">
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">From name</span>
                      <input
                        type="text"
                        placeholder="Acme Inc"
                        required
                        autoComplete="off"
                        className={inputClass}
                        value={fromName}
                        onChange={(e) => setFromName(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">From email</span>
                      <input
                        type="email"
                        placeholder="billing@acme.com"
                        required
                        autoComplete="off"
                        className={inputClass}
                        value={fromEmail}
                        onChange={(e) => setFromEmail(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">Postal address (email footer)</span>
                      <input
                        type="text"
                        placeholder="Shop 4, MG Road, Bengaluru 560001"
                        autoComplete="off"
                        className={inputClass}
                        value={addressLine}
                        onChange={(e) => setAddressLine(e.target.value)}
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeSection === "smtp" ? (
                <section>
                  <h2 className="text-subtitle text-ink">SMTP</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Your own mail server or provider credentials. Riko never sends through a shared account —
                    without these, outreach for your cases stays gated and nothing is sent.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="col-span-2 block text-sm">
                      <span className="text-label uppercase text-ink-muted">Host</span>
                      <input
                        type="text"
                        placeholder="smtp.yourdomain.com"
                        required
                        autoComplete="off"
                        className={inputClass}
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">Port</span>
                      <input
                        type="number"
                        required
                        autoComplete="off"
                        className={inputClass}
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                      />
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-sm">
                      <input
                        type="checkbox"
                        checked={smtpSecure}
                        onChange={(e) => setSmtpSecure(e.target.checked)}
                        className="h-4 w-4 rounded border-line-strong"
                      />
                      <span className="text-ink-muted">Use TLS</span>
                    </label>
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">Username</span>
                      <input
                        type="text"
                        required
                        autoComplete="off"
                        className={inputClass}
                        value={smtpUser}
                        onChange={(e) => setSmtpUser(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">
                        Password{smtpPasswordAlreadySet ? " (leave blank to keep current)" : ""}
                      </span>
                      <input
                        type="password"
                        placeholder={smtpPasswordAlreadySet ? "••••••••" : ""}
                        autoComplete="new-password"
                        className={inputClass}
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {activeSection === "brand-template" ? (
                <section>
                  <h2 className="text-subtitle text-ink">Brand template</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Your HTML wrapper. Riko writes the message and drops it in at{" "}
                    <code className="rounded bg-surface-sunk px-1 py-0.5 font-mono text-caption text-ink">
                      {"{{content}}"}
                    </code>
                    . Use{" "}
                    <code className="rounded bg-surface-sunk px-1 py-0.5 font-mono text-caption text-ink">
                      {"{{merchant_name}}"}
                    </code>{" "}
                    for your business name. Leave blank to use Riko's plain default.
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">HTML</span>
                      <textarea
                        rows={18}
                        spellCheck={false}
                        placeholder={"<div style=\"font-family:sans-serif\">\n  <h1>{{merchant_name}}</h1>\n  {{content}}\n</div>"}
                        className={cn(inputClass, "resize-y font-mono text-caption leading-relaxed")}
                        value={brandTemplateHtml}
                        onChange={(e) => setBrandTemplateHtml(e.target.value)}
                      />
                    </label>

                    <div className="text-sm">
                      <span className="text-label uppercase text-ink-muted">Preview</span>
                      <div className="mt-1 overflow-hidden rounded-sm border border-line bg-white">
                        <iframe
                          title="Brand template preview"
                          className="h-[420px] w-full border-0"
                          sandbox=""
                          srcDoc={buildPreview(brandTemplateHtml, fromName)}
                        />
                      </div>
                    </div>
                  </div>

                  {brandTemplateHtml && !brandTemplateHtml.includes("{{content}}") ? (
                    <p className="mt-3 text-sm text-waiting">
                      Template has no {"{{content}}"} placeholder, so Riko's message would have nowhere to go. The
                      default template will be used until you add one.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {activeSection === "alerts" ? (
                <section>
                  <h2 className="text-subtitle text-ink">Alerts</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Riko posts a short message to this webhook when a case needs a person, when your outreach is
                    paused for safety, or when drafting fails repeatedly. Any incoming-webhook URL that accepts
                    JSON works.
                  </p>
                  <label className="mt-4 block text-sm">
                    <span className="text-label uppercase text-ink-muted">Webhook URL</span>
                    <input
                      type="url"
                      placeholder="https://hooks.example.com/services/..."
                      autoComplete="off"
                      className={inputClass}
                      value={alertWebhookUrl}
                      onChange={(e) => setAlertWebhookUrl(e.target.value)}
                    />
                  </label>
                </section>
              ) : null}

              {error ? (
                <p className="mt-6 rounded-sm border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                  {error}
                </p>
              ) : null}
              {saved ? (
                <p className="mt-6 text-sm text-recovered animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out" role="status">
                  Saved.
                </p>
              ) : null}

              <div className="mt-8">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          ) : null}

          {activeSection === "send-window" ? (
            <section>
              <h2 className="text-subtitle text-ink">Sending limits</h2>
              <p className="mt-1 text-sm text-ink-muted">
                The first email in a case goes out whenever it comes due. Follow-ups hold to 7:00–23:00 in the
                customer's own timezone. No more than this many emails leave your account per day.
              </p>
              <div className="mt-4 max-w-xs">
                <label className="block text-sm">
                  <span className="text-label uppercase text-ink-muted">Daily send cap</span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    required
                    className={inputClass}
                    value={dailySendCap}
                    onChange={(e) => setDailySendCap(e.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  disabled={saveCap.isPending}
                  onClick={async () => {
                    setError(null);
                    try {
                      await saveCap.mutateAsync({ dailySendCap: Number(dailySendCap) });
                      setSaved(true);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not save.");
                    }
                  }}
                >
                  {saveCap.isPending ? "Saving…" : "Save cap"}
                </Button>
              </div>
            </section>
          ) : null}

          {activeSection === "pause-outreach" ? (
            <section>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-subtitle text-ink">Pause outreach</h2>
                  <p className="mt-1 max-w-md text-sm text-ink-muted">
                    Stops every send, reply, and retry immediately. Recovery windows keep counting while paused,
                    so unpause soon.
                  </p>
                </div>
                <Switch
                  checked={identity?.outreachPaused ?? false}
                  disabled={saveCap.isPending || !identity}
                  onCheckedChange={(checked) => {
                    setError(null);
                    saveCap.mutate(
                      { outreachPaused: checked },
                      {
                        onError: (err) => setError(err instanceof Error ? err.message : "Could not save."),
                      },
                    );
                  }}
                />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
