import { useEffect, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button.js";
import { Select } from "../../components/ui/select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useConnectRazorpay, useConnections } from "../../hooks/use-connections.js";
import { useSaveSenderIdentity } from "../../hooks/use-sender-identity.js";
import { useSaveAgentSettings, type AgentSettings } from "../../hooks/use-agent-settings.js";
import { AGENT_SETTINGS_DEFAULTS } from "@riko/shared";
import { cn } from "../../lib/utils.js";

const inputClass =
  "mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent";

const DISMISS_KEY = "riko:onboarding-dismissed";

const STEPS = [
  { id: "connect", label: "Connect payments" },
  { id: "smtp", label: "Email delivery" },
  { id: "agent", label: "Your agent" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function StepRail({ current }: { current: StepId }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="mb-6 flex items-center gap-2">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.id} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium transition-colors duration-150",
                done && "border-accent bg-accent text-accent-foreground",
                active && "border-accent text-accent",
                !done && !active && "border-line-strong text-ink-faint",
              )}
            >
              {done ? <CheckIcon size={11} weight="bold" /> : index + 1}
            </span>
            <span className={cn("hidden truncate text-caption sm:block", active ? "text-ink" : "text-ink-faint")}>
              {step.label}
            </span>
            {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-line" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function OnboardingModal() {
  const { data: connectionsData, isLoading: connectionsLoading } = useConnections();
  const connectRazorpay = useConnectRazorpay();
  const saveIdentity = useSaveSenderIdentity();
  const saveAgent = useSaveAgentSettings();

  const [step, setStep] = useState<StepId>("connect");
  const [error, setError] = useState<string | null>(null);

  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");

  const [tuning, setTuning] = useState(false);
  const [language, setLanguage] = useState<AgentSettings["defaultLanguage"]>("customer_choice");
  const [tone, setTone] = useState<AgentSettings["tone"]>("friendly");
  const [persistence, setPersistence] = useState<AgentSettings["persistence"]>("balanced");
  const [instructions, setInstructions] = useState("");

  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "true",
  );

  const hasConnection = (connectionsData?.connections.length ?? 0) > 0;
  const open = !dismissed && !connectionsLoading && !hasConnection;
  const webhookUrl = `${window.location.origin}/webhooks/razorpay`;

  useEffect(() => {
    if (hasConnection && step === "connect") setStep("smtp");
  }, [hasConnection, step]);

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await connectRazorpay.mutateAsync({ keyId, keySecret, webhookSecret });
      setStep("smtp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect Razorpay.");
    }
  };

  const handleSmtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await saveIdentity.mutateAsync({
        fromName,
        fromEmail,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecure,
        smtpUser,
        smtpPassword,
      });
      setStep("agent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your sending setup.");
    }
  };

  const handleFinish = async () => {
    setError(null);
    try {
      if (tuning) {
        await saveAgent.mutateAsync({
          ...AGENT_SETTINGS_DEFAULTS,
          defaultLanguage: language,
          tone,
          persistence,
          additionalInstructions: instructions.trim(),
        });
      }
      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your agent settings.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Set up Riko</DialogTitle>
          <DialogDescription>Three quick steps and your recovery agent starts working.</DialogDescription>
        </DialogHeader>

        <StepRail current={step} />

        {step === "connect" ? (
          <form className="space-y-4" onSubmit={handleConnect}>
            {error ? (
              <p className="rounded-md border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                {error}
              </p>
            ) : null}
            <div className="rounded-md border border-line bg-surface-sunk p-3 text-caption text-ink-muted">
              <p>
                In your Razorpay dashboard, create a webhook pointing to{" "}
                <code className="break-all rounded bg-surface px-1 py-0.5 font-mono text-[11px] text-ink">{webhookUrl}</code>{" "}
                with events <span className="text-ink">payment.failed</span> and{" "}
                <span className="text-ink">payment.captured</span>, then paste its secret below along with your API keys.
              </p>
            </div>
            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Key ID</span>
              <input
                type="text"
                placeholder="rzp_live_..."
                required
                autoComplete="off"
                className={inputClass}
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Key secret</span>
              <input
                type="password"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                className={inputClass}
                value={keySecret}
                onChange={(e) => setKeySecret(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Webhook secret</span>
              <input
                type="password"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                className={inputClass}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" className="flex-1" disabled={connectRazorpay.isPending}>
                {connectRazorpay.isPending ? "Connecting…" : "Connect"}
              </Button>
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setStep("smtp")}>
                I'll do this later
              </Button>
            </div>
          </form>
        ) : null}

        {step === "smtp" ? (
          <form className="space-y-4" onSubmit={handleSmtp}>
            {error ? (
              <p className="rounded-md border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                {error}
              </p>
            ) : null}
            <p className="text-caption text-ink-muted">
              Outreach is sent from your own domain through your own mail server — Riko never sends from a shared
              account.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block text-sm">
                <span className="text-label uppercase text-ink-muted">From name</span>
                <input
                  type="text"
                  placeholder="Acme Billing"
                  required
                  autoComplete="off"
                  className={inputClass}
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                />
              </label>
              <label className="col-span-2 block text-sm">
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
                <span className="text-label uppercase text-ink-muted">Password</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  className={inputClass}
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" className="flex-1" disabled={saveIdentity.isPending}>
                {saveIdentity.isPending ? "Saving…" : "Save and continue"}
              </Button>
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setStep("agent")}>
                I'll do this later
              </Button>
            </div>
          </form>
        ) : null}

        {step === "agent" ? (
          <div className="space-y-4">
            {error ? (
              <p className="rounded-md border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => setTuning(false)}
              className={cn(
                "block w-full rounded-md border p-4 text-left transition-colors duration-150",
                !tuning ? "border-accent bg-accent/5" : "border-line hover:border-line-strong",
              )}
            >
              <p className="text-sm font-medium text-ink">Use recommended settings</p>
              <p className="mt-1 text-caption text-ink-muted">
                Friendly tone, balanced persistence, English or Hinglish per customer, honest measurement holdout.
                Change everything later under Settings → Agent.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setTuning(true)}
              className={cn(
                "block w-full rounded-md border p-4 text-left transition-colors duration-150",
                tuning ? "border-accent bg-accent/5" : "border-line hover:border-line-strong",
              )}
            >
              <p className="text-sm font-medium text-ink">Configure the agent myself</p>
              <p className="mt-1 text-caption text-ink-muted">
                Set the voice and any standing guidance before Riko writes its first email.
              </p>
            </button>

            {tuning ? (
              <div className="space-y-3 rounded-md border border-line p-4">
                <div>
                  <span className="text-label uppercase text-ink-muted">Language default</span>
                  <div className="mt-1">
                    <Select
                      value={language}
                      onValueChange={(v) => setLanguage(v as AgentSettings["defaultLanguage"])}
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
                      value={tone}
                      onValueChange={(v) => setTone(v as AgentSettings["tone"])}
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
                      value={persistence}
                      onValueChange={(v) => setPersistence(v as AgentSettings["persistence"])}
                      options={[
                        { value: "gentle", label: "Gentle", hint: "Easy to say yes to" },
                        { value: "balanced", label: "Balanced", hint: "Standard escalation" },
                        { value: "firm", label: "Firm", hint: "Direct urgency where allowed" },
                      ]}
                    />
                  </div>
                </div>
                <label className="block text-sm">
                  <span className="text-label uppercase text-ink-muted">Standing guidance (optional)</span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    placeholder={"e.g. Never mention invoices, we're a small studio."}
                    className={cn(inputClass, "resize-y")}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </label>
              </div>
            ) : null}

            <Button type="button" className="w-full" disabled={saveAgent.isPending} onClick={handleFinish}>
              {saveAgent.isPending ? "Saving…" : "Finish setup"}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
