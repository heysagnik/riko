import { useEffect, useState } from "react";
import { CaretRightIcon, EnvelopeSimpleIcon, PhoneIcon, WhatsappLogo } from "@phosphor-icons/react";
import {
  BRAND_TEMPLATE_DARK_CSS,
  BRAND_TEMPLATE_LIGHT_CSS,
  CONTENT_PLACEHOLDER,
  DEFAULT_BRAND_TEMPLATE,
} from "@riko/core/outreach/brand-template";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Select } from "../../components/ui/select.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { useSaveSenderIdentity, useSenderIdentity } from "../../hooks/use-sender-identity.js";
import { useSaveOutreachSettings } from "../../hooks/use-outreach-settings.js";
import { useAgentSettings, useSaveAgentSettings, type AgentSettings } from "../../hooks/use-agent-settings.js";
import { useTheme, type ResolvedTheme } from "../../lib/theme.js";
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
    `<tr><td class="riko-btn" style="background:#111111;">` +
    `<a href="${escapeHtml(url)}" class="riko-btn-label" style="display:inline-block;padding:11px 18px;font-size:14px;font-weight:500;` +
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
    `<a href="${escapeHtml(url)}" class="riko-unsub" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(label)}</a>` +
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
      inline += `${escapeHtml(before)}<a href="${escapeHtml(url)}" class="riko-link" style="color:#2563eb;">${escapeHtml(url)}</a>`;
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

function buildPreview(template: string, merchantName: string, resolvedTheme: ResolvedTheme): string {
  const source = template.includes(CONTENT_PLACEHOLDER) ? template : DEFAULT_BRAND_TEMPLATE;
  const html = source
    .split(CONTENT_PLACEHOLDER)
    .join(SAMPLE_BODY)
    .split("{{merchant_name}}")
    .join(merchantName || "Your business");

  const forcedStyle = `<style>${
    resolvedTheme === "dark" ? BRAND_TEMPLATE_DARK_CSS : BRAND_TEMPLATE_LIGHT_CSS
  }</style>`;
  return html.includes("</head>")
    ? html.replace(/<\/head>/i, `${forcedStyle}</head>`)
    : `${html}${forcedStyle}`;
}

const SECTIONS = [
  { id: "sender-identity", label: "Identity" },
  { id: "connectors", label: "Connectors" },
  { id: "agent", label: "Agent" },
  { id: "brand-template", label: "Brand template" },
  { id: "alerts", label: "Alerts" },
  { id: "pause-outreach", label: "Pause outreach" },
];

type AgentForm = {
  maxAttempts: string;
  cooldownHours: string;
  windowStart: string;
  windowEnd: string;
  firstEmailWithinWindow: boolean;
  agePayment: string;
  ageAbandonment: string;
  ageReceivable: string;
  minAmount: string;
  highValue: string;
  holdout: string;
  defaultLanguage: AgentSettings["defaultLanguage"];
  tone: AgentSettings["tone"];
  persistence: AgentSettings["persistence"];
  additionalInstructions: string;
};

const GUARDRAILS = [
  { label: "Fraud-flagged cases are never contacted", detail: "A compromised card is never chased, regardless of any setting on this page." },
  { label: "No discounts, credits, or deadlines", detail: "Riko never offers the customer anything. Only you can." },
  { label: "Disputes go to a person", detail: "A chargeback signal always escalates instead of another email." },
  { label: "Merchant-config faults escalate", detail: "Failures caused by your own gateway settings go to you, not the customer, until approved." },
  { label: "Unsubscribe is honored instantly", detail: "One click closes every open case for that customer." },
  { label: "Exactly one payment link", detail: "Every email carries your payment page and nothing else." },
];

export function SettingsPage() {
  const { data, isLoading } = useSenderIdentity();
  const save = useSaveSenderIdentity();
  const saveCap = useSaveOutreachSettings();
  const { data: agentData } = useAgentSettings();
  const saveAgent = useSaveAgentSettings();
  const identity = data?.senderIdentity ?? undefined;
  const { resolvedTheme } = useTheme();

  const [activeSection, setActiveSection] = useState<string>("sender-identity");

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [phone, setPhone] = useState("");
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

  const [agentForm, setAgentForm] = useState<AgentForm | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentSaved, setAgentSaved] = useState(false);
  const [sendingModalOpen, setSendingModalOpen] = useState(false);

  useEffect(() => {
    if (!agentData) return;
    const s = agentData.agentSettings;
    setAgentForm({
      maxAttempts: String(s.maxAttempts),
      cooldownHours: String(s.cooldownHours),
      windowStart: String(s.contactWindowStartHour),
      windowEnd: String(s.contactWindowEndHour),
      firstEmailWithinWindow: s.firstEmailWithinWindow,
      agePayment: String(s.maxAgeDaysPaymentFailure),
      ageAbandonment: String(s.maxAgeDaysCheckoutAbandonment),
      ageReceivable: String(s.maxAgeDaysOverdueReceivable),
      minAmount: String(s.minAmountMinor / 100),
      highValue: String(s.highValueThresholdMinor / 100),
      holdout: String(s.holdoutPercent),
      defaultLanguage: s.defaultLanguage,
      tone: s.tone,
      persistence: s.persistence,
      additionalInstructions: s.additionalInstructions,
    });
  }, [agentData]);

  useEffect(() => {
    const identity = data?.senderIdentity;
    if (!identity) return;
    setFromName(identity.fromName);
    setFromEmail(identity.fromEmail);
    setPhone(identity.phone ?? "");
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

  const persistSending = async (includeSmtp: boolean): Promise<boolean> => {
    if (includeSmtp && !smtpPassword && !smtpPasswordAlreadySet) {
      setError("SMTP password is required the first time you configure sending.");
      return false;
    }

    try {
      await save.mutateAsync({
        fromName,
        fromEmail,
        phone: phone || undefined,
        smtpHost: includeSmtp ? smtpHost : undefined,
        smtpPort: includeSmtp ? Number(smtpPort) : undefined,
        smtpSecure: includeSmtp ? smtpSecure : undefined,
        smtpUser: includeSmtp ? smtpUser : undefined,
        smtpPassword: includeSmtp ? smtpPassword || undefined : undefined,
        brandTemplateHtml: brandTemplateHtml || undefined,
        addressLine: addressLine || undefined,
        alertWebhookUrl: alertWebhookUrl || undefined,
      });
      setSmtpPassword("");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
      return false;
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (await persistSending(false)) {
      setSaved(true);
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

        <div className={cn("max-w-2xl", activeSection === "connectors" && "max-w-none")}>
          {isFormSection ? (
            <form onSubmit={handleSubmit}>
              {activeSection === "sender-identity" ? (
                <section>
                  <h2 className="text-subtitle text-ink">Identity</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    How you appear to customers and to us. Mail delivery itself is configured under Connectors →
                    Mail service.
                  </p>
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm">
                        <span className="text-label uppercase text-ink-muted">Sender name</span>
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
                        <span className="text-label uppercase text-ink-muted">Sender email</span>
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
                    </div>
                    <label className="block text-sm">
                      <span className="text-label uppercase text-ink-muted">Phone number</span>
                      <input
                        type="tel"
                        placeholder="+91 98765 43210"
                        autoComplete="off"
                        className={inputClass}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
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
                          srcDoc={buildPreview(brandTemplateHtml, fromName, resolvedTheme)}
                        />
                      </div>
                    </div>
                  </div>

                  {brandTemplateHtml && !brandTemplateHtml.includes(CONTENT_PLACEHOLDER) ? (
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

          {activeSection === "connectors" ? (
            <div>
              <h2 className="text-subtitle text-ink">Connectors</h2>
              <p className="mt-1 max-w-lg text-sm text-ink-muted">
                The channels Riko can reach your customers on. More connectors are on the way.
              </p>
              <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <button type="button" onClick={() => setSendingModalOpen(true)} className="text-left">
                  <Card className="h-full transition-colors duration-150 hover:border-line-strong">
                    <CardHeader className="flex flex-row items-center justify-between border-b border-line">
                      <span className="flex items-center gap-2.5">
                        <EnvelopeSimpleIcon size={18} weight="regular" className="text-ink-muted" />
                        <span className="text-sm font-medium text-ink">Mail service</span>
                      </span>
                      {identity?.smtpHost ? (
                        <Badge variant="recovered">Configured</Badge>
                      ) : (
                        <Badge variant="waiting">Not configured</Badge>
                      )}
                    </CardHeader>
                    <CardContent className="flex items-end justify-between pt-4">
                      <p className="text-caption text-ink-muted">
                        Your own domain and mail server. Outreach is sent from your address, never ours.
                      </p>
                      <CaretRightIcon size={14} weight="bold" className="ml-2 shrink-0 text-ink-faint" />
                    </CardContent>
                  </Card>
                </button>

                <Card className="h-full opacity-60">
                  <CardHeader className="flex flex-row items-center justify-between border-b border-line">
                    <span className="flex items-center gap-2.5">
                      <WhatsappLogo size={18} weight="regular" className="text-ink-muted" />
                      <span className="text-sm font-medium text-ink">WhatsApp</span>
                    </span>
                    <Badge variant="default">Coming soon</Badge>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <p className="text-caption text-ink-muted">
                      Recovery nudges where your customers actually reply. Same agent, same guardrails.
                    </p>
                  </CardContent>
                </Card>

                <Card className="h-full opacity-60">
                  <CardHeader className="flex flex-row items-center justify-between border-b border-line">
                    <span className="flex items-center gap-2.5">
                      <PhoneIcon size={18} weight="regular" className="text-ink-muted" />
                      <span className="text-sm font-medium text-ink">Call</span>
                    </span>
                    <Badge variant="default">Coming soon</Badge>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <p className="text-caption text-ink-muted">
                      A polite automated call for high-value cases that have ignored every email.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}

          {activeSection === "agent" && agentForm ? (
            <div>
              <h2 className="text-subtitle text-ink">Agent behavior</h2>
              <p className="mt-1 max-w-lg text-sm text-ink-muted">
                Every bound Riko reasons within. These are enforced by deterministic code after the model decides,
                and reflected live on the "What Riko may do" page.
              </p>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Cadence</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Emails per case (max)</span>
                    <input type="number" min={1} max={6} className={inputClass} value={agentForm.maxAttempts}
                      onChange={(e) => setAgentForm({ ...agentForm, maxAttempts: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Minimum gap between emails (hours)</span>
                    <input type="number" min={1} max={168} className={inputClass} value={agentForm.cooldownHours}
                      onChange={(e) => setAgentForm({ ...agentForm, cooldownHours: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Stop chasing failed payments after (days)</span>
                    <input type="number" min={1} max={90} className={inputClass} value={agentForm.agePayment}
                      onChange={(e) => setAgentForm({ ...agentForm, agePayment: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Stop chasing abandoned checkouts after (days)</span>
                    <input type="number" min={1} max={60} className={inputClass} value={agentForm.ageAbandonment}
                      onChange={(e) => setAgentForm({ ...agentForm, ageAbandonment: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Hand unpaid invoices to a person after (days)</span>
                    <input type="number" min={1} max={120} className={inputClass} value={agentForm.ageReceivable}
                      onChange={(e) => setAgentForm({ ...agentForm, ageReceivable: e.target.value })} />
                  </label>
                </div>
              </section>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Sending limits</h3>
                <div className="mt-3 max-w-xs">
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Daily send cap (emails per day)</span>
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
                  <p className="mt-2 text-caption text-ink-faint">
                    No more than this many emails leave your account per day, across all cases.
                  </p>
                </div>
              </section>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Contact window</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Window start (customer local hour)</span>
                    <input type="number" min={0} max={23} className={inputClass} value={agentForm.windowStart}
                      onChange={(e) => setAgentForm({ ...agentForm, windowStart: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Window end (customer local hour)</span>
                    <input type="number" min={1} max={24} className={inputClass} value={agentForm.windowEnd}
                      onChange={(e) => setAgentForm({ ...agentForm, windowEnd: e.target.value })} />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={agentForm.firstEmailWithinWindow}
                    onChange={(e) => setAgentForm({ ...agentForm, firstEmailWithinWindow: e.target.checked })}
                    className="h-4 w-4 rounded border-line-strong" />
                  <span className="text-ink-muted">Hold even the first email inside the window (off = first email goes any time)</span>
                </label>
              </section>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Money rules</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Skip cases below (₹, 0 = chase everything)</span>
                    <input type="number" min={0} className={inputClass} value={agentForm.minAmount}
                      onChange={(e) => setAgentForm({ ...agentForm, minAmount: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">High-value threshold (₹)</span>
                    <input type="number" min={0} className={inputClass} value={agentForm.highValue}
                      onChange={(e) => setAgentForm({ ...agentForm, highValue: e.target.value })} />
                  </label>
                </div>
                <p className="mt-2 text-caption text-ink-faint">
                  Cases at or above the high-value threshold make the agent extra careful and precise with amounts and links.
                </p>
              </section>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Voice</h3>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-label uppercase text-ink-muted">Language default</span>
                    <div className="mt-1">
                      <Select
                        value={agentForm.defaultLanguage}
                        onValueChange={(v) => setAgentForm({ ...agentForm, defaultLanguage: v as AgentSettings["defaultLanguage"] })}
                        options={[
                          { value: "customer_choice", label: "Follow each customer", hint: "Whatever this customer prefers" },
                          { value: "english", label: "English", hint: "For every customer" },
                          { value: "hinglish", label: "Hinglish", hint: "Roman-script Hindi + English" },
                        ]}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-label uppercase text-ink-muted">Tone</span>
                    <div className="mt-1">
                      <Select
                        value={agentForm.tone}
                        onValueChange={(v) => setAgentForm({ ...agentForm, tone: v as AgentSettings["tone"] })}
                        options={[
                          { value: "friendly", label: "Friendly", hint: "Warm and human" },
                          { value: "neutral", label: "Neutral", hint: "Professional and plain" },
                          { value: "formal", label: "Formal", hint: "Matter of record" },
                        ]}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-label uppercase text-ink-muted">Persistence</span>
                    <div className="mt-1">
                      <Select
                        value={agentForm.persistence}
                        onValueChange={(v) => setAgentForm({ ...agentForm, persistence: v as AgentSettings["persistence"] })}
                        options={[
                          { value: "gentle", label: "Gentle", hint: "Easy to say yes to" },
                          { value: "balanced", label: "Balanced", hint: "Standard escalation" },
                          { value: "firm", label: "Firm", hint: "Direct urgency where allowed" },
                        ]}
                      />
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-caption text-ink-faint">
                  Language default applies to customers whose own preference is unknown; a customer's choice always wins.
                </p>
              </section>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Measurement</h3>
                <div className="mt-3 max-w-xs">
                  <label className="block text-sm">
                    <span className="text-label uppercase text-ink-muted">Holdout (% of new cases left alone)</span>
                    <input type="number" min={0} max={50} className={inputClass} value={agentForm.holdout}
                      onChange={(e) => setAgentForm({ ...agentForm, holdout: e.target.value })} />
                  </label>
                  <p className="mt-2 text-caption text-ink-faint">
                    Holdout cases prove how much money Riko actually recovers versus what would have come back anyway. Keep it above zero if you want honest numbers.
                  </p>
                </div>
              </section>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Additional instructions</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Standing guidance the agent reads on every case. It shapes wording and emphasis; it can never
                  override the guardrails below.
                </p>
                <textarea
                  rows={6}
                  maxLength={2000}
                  placeholder={"e.g. We are a small studio - keep emails personal and never mention the word invoice. For orders above Rs 10,000 mention that we can split payment into two parts if they reply to this email."}
                  className={cn(inputClass, "mt-3 resize-y")}
                  value={agentForm.additionalInstructions}
                  onChange={(e) => setAgentForm({ ...agentForm, additionalInstructions: e.target.value })}
                />
                <p className="mt-1 text-caption text-ink-faint">{agentForm.additionalInstructions.length}/2000</p>
              </section>

              <section className="mt-8">
                <h3 className="text-label uppercase text-ink-muted">Fixed guardrails</h3>
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {GUARDRAILS.map((g) => (
                    <li key={g.label} className="py-2.5">
                      <p className="text-sm text-ink">{g.label}</p>
                      <p className="mt-0.5 text-caption text-ink-muted">{g.detail}</p>
                    </li>
                  ))}
                </ul>
              </section>

              {agentError ? (
                <p className="mt-6 rounded-sm border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                  {agentError}
                </p>
              ) : null}
              {agentSaved ? (
                <p className="mt-6 text-sm text-recovered animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out" role="status">
                  Saved. New limits apply from the next agent run.
                </p>
              ) : null}

              <div className="mt-8">
                <Button
                  disabled={saveAgent.isPending}
                  onClick={async () => {
                    if (!agentForm) return;
                    setAgentError(null);
                    setAgentSaved(false);
                    try {
                      await Promise.all([
                        saveAgent.mutateAsync({
                          maxAttempts: Number(agentForm.maxAttempts),
                          cooldownHours: Number(agentForm.cooldownHours),
                          contactWindowStartHour: Number(agentForm.windowStart),
                          contactWindowEndHour: Number(agentForm.windowEnd),
                          firstEmailWithinWindow: agentForm.firstEmailWithinWindow,
                          maxAgeDaysPaymentFailure: Number(agentForm.agePayment),
                          maxAgeDaysCheckoutAbandonment: Number(agentForm.ageAbandonment),
                          maxAgeDaysOverdueReceivable: Number(agentForm.ageReceivable),
                          minAmountMinor: Math.round(Number(agentForm.minAmount) * 100),
                          highValueThresholdMinor: Math.round(Number(agentForm.highValue) * 100),
                          holdoutPercent: Number(agentForm.holdout),
                          defaultLanguage: agentForm.defaultLanguage,
                          tone: agentForm.tone,
                          persistence: agentForm.persistence,
                          additionalInstructions: agentForm.additionalInstructions,
                        }),
                        saveCap.mutateAsync({ dailySendCap: Number(dailySendCap) || 500 }),
                      ]);
                      setAgentSaved(true);
                    } catch (err) {
                      setAgentError(err instanceof Error ? err.message : "Could not save agent settings.");
                    }
                  }}
                >
                  {saveAgent.isPending ? "Saving…" : "Save agent settings"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog
        open={sendingModalOpen}
        onOpenChange={(next) => {
          setSendingModalOpen(next);
          if (next) {
            setError(null);
            setSaved(false);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Mail service</DialogTitle>
            <DialogDescription>
              Outreach is sent from your domain through your own mail server. Riko never sends from a shared account.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              if (await persistSending(true)) {
                setSendingModalOpen(false);
                setSaved(true);
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block text-sm">
                <span className="text-label uppercase text-ink-muted">SMTP host</span>
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

            {error ? (
              <p className="rounded-sm border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setSendingModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save mail service"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
