import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Switch } from "../../components/ui/switch.js";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { useSaveSenderIdentity, useSenderIdentity } from "../../hooks/use-sender-identity.js";
import { cn } from "../../lib/utils.js";

const inputClass =
  "mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent";

const SAMPLE_BODY = `<p style="margin:0 0 14px;">Hi Ananya Krishnan, the card we have on file expired, so this month's INR 2,499.00 payment did not go through.</p><p style="margin:0 0 14px;">Nothing has been cancelled — updating your card takes about a minute.</p><p style="margin:0;"><a href="#">Update your payment method</a></p>`;

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
  { id: "send-window", label: "Send window" },
  { id: "pause-outreach", label: "Pause outreach" },
];

export function SettingsPage() {
  const { data, isLoading } = useSenderIdentity();
  const save = useSaveSenderIdentity();

  const [activeSection, setActiveSection] = useState<string>("sender-identity");

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [brandTemplateHtml, setBrandTemplateHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const identity = data?.senderIdentity;
    if (!identity) return;
    setFromName(identity.fromName);
    setFromEmail(identity.fromEmail);
    setReplyTo(identity.replyTo ?? "");
    setSmtpHost(identity.smtpHost ?? "");
    setSmtpPort(identity.smtpPort ? String(identity.smtpPort) : "587");
    setSmtpSecure(identity.smtpSecure);
    setSmtpUser(identity.smtpUser ?? "");
    setBrandTemplateHtml(identity.brandTemplateHtml ?? "");
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
        replyTo: replyTo || undefined,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecure,
        smtpUser,
        smtpPassword: smtpPassword || undefined,
        brandTemplateHtml: brandTemplateHtml || undefined,
      });
      setSmtpPassword("");
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
    activeSection === "sender-identity" || activeSection === "smtp" || activeSection === "brand-template";

  return (
    <div>
      <h1 className="text-title text-ink">Settings</h1>
      <p className="mt-1 text-sm text-ink-muted">Sender identity, delivery, and outreach controls for your account.</p>

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
                      <span className="text-label uppercase text-ink-muted">Reply-to (optional)</span>
                      <input
                        type="email"
                        placeholder="support@acme.com"
                        autoComplete="off"
                        className={inputClass}
                        value={replyTo}
                        onChange={(e) => setReplyTo(e.target.value)}
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
                          className="h-[420px] w-full"
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

              {error ? (
                <p className="mt-6 rounded-sm border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                  {error}
                </p>
              ) : null}
              {saved ? <p className="mt-6 text-sm text-recovered">Saved.</p> : null}

              <div className="mt-8">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          ) : null}

          {activeSection === "send-window" ? (
            <section>
              <div className="flex items-baseline justify-between">
                <h2 className="text-subtitle text-ink">Send window</h2>
                <span className="text-caption text-ink-faint">Coming soon</span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">Outreach respects your timezone and this window.</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-label uppercase text-ink-muted">Timezone</span>
                  <input
                    type="text"
                    placeholder="America/New_York"
                    disabled
                    autoComplete="off"
                    className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-label uppercase text-ink-muted">Daily cap</span>
                  <input
                    type="number"
                    placeholder="100"
                    disabled
                    autoComplete="off"
                    className={cn(inputClass, "disabled:cursor-not-allowed disabled:opacity-50")}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {activeSection === "pause-outreach" ? (
            <section className="flex items-center justify-between">
              <div>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-subtitle text-ink">Pause outreach</h2>
                  <span className="text-caption text-ink-faint">Coming soon</span>
                </div>
                <p className="mt-1 text-sm text-ink-muted">No new emails will be sent while paused.</p>
              </div>
              <Switch checked={false} disabled />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
