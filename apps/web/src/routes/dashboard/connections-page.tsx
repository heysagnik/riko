import { useState } from "react";
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
import { Skeleton } from "../../components/ui/skeleton.js";
import { RazorpayLogo } from "../../components/brand-logos.js";
import { useConnectRazorpay, useConnections, useDisconnect, useWebhookSecret } from "../../hooks/use-connections.js";

const inputClass =
  "mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent";

const WEBHOOK_URL = `${typeof window !== "undefined" ? window.location.origin : ""}/webhooks/razorpay`;

export function ConnectionsPage() {
  const { data, isLoading } = useConnections();
  const connectRazorpay = useConnectRazorpay();
  const disconnect = useDisconnect();

  const [razorpayDialogOpen, setRazorpayDialogOpen] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [razorpayError, setRazorpayError] = useState<string | null>(null);

  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const razorpayConnection = data?.connections.find((c) => c.providerId === "razorpay" && c.status === "active");
  const { data: webhookSecretData, isLoading: webhookSecretLoading } = useWebhookSecret(
    razorpayConnection?.id,
    webhookDialogOpen,
  );

  const handleConnectRazorpay = async (event: React.FormEvent) => {
    event.preventDefault();
    setRazorpayError(null);
    try {
      await connectRazorpay.mutateAsync({ keyId, keySecret, webhookSecret });
      setKeyId("");
      setKeySecret("");
      setWebhookSecret("");
      setRazorpayDialogOpen(false);
    } catch (err) {
      setRazorpayError(err instanceof Error ? err.message : "Could not connect Razorpay.");
    }
  };

  const handleCopyWebhookUrl = async () => {
    await navigator.clipboard.writeText(WEBHOOK_URL);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyWebhookSecret = async () => {
    if (!webhookSecretData) return;
    await navigator.clipboard.writeText(webhookSecretData.webhookSecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const handleDisconnect = () => {
    if (!razorpayConnection) return;
    disconnect.mutate(razorpayConnection.id);
  };

  return (
    <div>
      <h1 className="text-title text-ink">Connections</h1>
      <p className="mt-1 text-sm text-ink-muted">Read-only access. We never move money.</p>

      {isLoading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-line">
              <RazorpayLogo className="h-5 w-auto" />
              {razorpayConnection ? (
                <Badge variant="recovered">Connected</Badge>
              ) : (
                <Badge variant="default">Not connected</Badge>
              )}
            </CardHeader>
            <CardContent className="pt-4">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-label uppercase text-ink-faint">Key ID</dt>
                  <dd className="font-mono text-ink">{razorpayConnection?.providerAccountId ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-label uppercase text-ink-faint">Status</dt>
                  <dd className="text-ink">{razorpayConnection?.status ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-label uppercase text-ink-faint">Connected</dt>
                  <dd className="tabular-nums text-ink">
                    {razorpayConnection ? new Date(razorpayConnection.connectedAt).toLocaleDateString() : "—"}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                {!razorpayConnection ? (
                  <Button onClick={() => setRazorpayDialogOpen(true)}>Connect Razorpay</Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setWebhookDialogOpen(true)}>
                      Set up webhook
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={handleDisconnect}
                      disabled={disconnect.isPending}
                    >
                      {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={razorpayDialogOpen} onOpenChange={setRazorpayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Razorpay</DialogTitle>
            <DialogDescription>
              From Settings → API Keys in your Razorpay Dashboard. Encrypted at rest.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-3" onSubmit={handleConnectRazorpay}>
            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Key ID</span>
              <input
                type="text"
                placeholder="rzp_test_xxxxxxxxxxxx"
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
                required
                autoComplete="new-password"
                className={inputClass}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </label>

            {razorpayError ? (
              <p className="rounded-sm border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                {razorpayError}
              </p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={connectRazorpay.isPending}>
                {connectRazorpay.isPending ? "Connecting…" : "Connect Razorpay"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRazorpayDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={webhookDialogOpen} onOpenChange={setWebhookDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up the Razorpay webhook</DialogTitle>
            <DialogDescription>
              In your Razorpay Dashboard, go to Settings → Webhooks → Add New Webhook, paste this URL, and use the
              same webhook secret you gave Riko when you connected the account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Webhook URL</span>
              <div className="mt-1 flex gap-2">
                <input type="text" readOnly value={WEBHOOK_URL} className={`${inputClass} mt-0 font-mono text-caption`} />
                <Button type="button" variant="outline" onClick={handleCopyWebhookUrl}>
                  {copiedUrl ? "Copied" : "Copy"}
                </Button>
              </div>
            </label>

            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Webhook secret</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookSecretLoading ? "Loading…" : (webhookSecretData?.webhookSecret ?? "")}
                  className={`${inputClass} mt-0 font-mono text-caption`}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyWebhookSecret}
                  disabled={webhookSecretLoading || !webhookSecretData}
                >
                  {copiedSecret ? "Copied" : "Copy"}
                </Button>
              </div>
            </label>

            <p className="text-sm text-ink-muted">
              Select at least <code className="rounded bg-surface-sunk px-1 py-0.5 font-mono text-caption">payment.failed</code>,{" "}
              <code className="rounded bg-surface-sunk px-1 py-0.5 font-mono text-caption">payment.captured</code>, and{" "}
              <code className="rounded bg-surface-sunk px-1 py-0.5 font-mono text-caption">order.paid</code> events.
            </p>
          </div>

          <div className="flex justify-end pt-1">
            <Button type="button" variant="ghost" onClick={() => setWebhookDialogOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
