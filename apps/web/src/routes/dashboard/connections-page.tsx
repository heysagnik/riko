import { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { RazorpayLogo, StripeLogo } from "../../components/brand-logos.js";
import { useConnectRazorpay, useConnectStripe, useConnections } from "../../hooks/use-connections.js";

const inputClass =
  "mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent";

export function ConnectionsPage() {
  const { data, isLoading } = useConnections();
  const connectStripe = useConnectStripe();
  const connectRazorpay = useConnectRazorpay();

  const [stripeDialogOpen, setStripeDialogOpen] = useState(false);
  const [stripeApiKey, setStripeApiKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [stripeError, setStripeError] = useState<string | null>(null);

  const [razorpayDialogOpen, setRazorpayDialogOpen] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [razorpayError, setRazorpayError] = useState<string | null>(null);

  const stripeConnection = data?.connections.find((c) => c.providerId === "stripe" && c.status === "active");
  const razorpayConnection = data?.connections.find((c) => c.providerId === "razorpay" && c.status === "active");

  const handleConnectStripe = async (event: React.FormEvent) => {
    event.preventDefault();
    setStripeError(null);
    try {
      await connectStripe.mutateAsync({ apiKey: stripeApiKey, webhookSecret: stripeWebhookSecret });
      setStripeApiKey("");
      setStripeWebhookSecret("");
      setStripeDialogOpen(false);
    } catch (err) {
      setStripeError(err instanceof Error ? err.message : "Could not connect Stripe.");
    }
  };

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

  return (
    <div>
      <h1 className="text-title text-ink">Connections</h1>
      <p className="mt-1 text-sm text-ink-muted">Read-only access. We never move money.</p>

      {isLoading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-line">
              <StripeLogo className="h-5 w-auto" />
              {stripeConnection ? (
                <Badge variant="recovered">Connected</Badge>
              ) : (
                <Badge variant="default">Not connected</Badge>
              )}
            </CardHeader>
            <CardContent className="pt-4">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-label uppercase text-ink-faint">Account</dt>
                  <dd className="font-mono text-ink">{stripeConnection?.providerAccountId ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-label uppercase text-ink-faint">Status</dt>
                  <dd className="text-ink">{stripeConnection?.status ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-label uppercase text-ink-faint">Connected</dt>
                  <dd className="tabular-nums text-ink">
                    {stripeConnection ? new Date(stripeConnection.connectedAt).toLocaleDateString() : "—"}
                  </dd>
                </div>
              </dl>
              {!stripeConnection ? (
                <Button className="mt-4" onClick={() => setStripeDialogOpen(true)}>
                  Connect Stripe
                </Button>
              ) : null}
            </CardContent>
          </Card>

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
              {!razorpayConnection ? (
                <Button className="mt-4" onClick={() => setRazorpayDialogOpen(true)}>
                  Connect Razorpay
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={stripeDialogOpen} onOpenChange={setStripeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Stripe</DialogTitle>
            <DialogDescription>From Developers → API Keys in your Stripe Dashboard. Encrypted at rest.</DialogDescription>
          </DialogHeader>

          <form className="space-y-3" onSubmit={handleConnectStripe}>
            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Secret key</span>
              <input
                type="password"
                placeholder="sk_test_xxxxxxxxxxxx"
                required
                autoComplete="new-password"
                className={inputClass}
                value={stripeApiKey}
                onChange={(e) => setStripeApiKey(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-label uppercase text-ink-muted">Webhook signing secret</span>
              <input
                type="password"
                placeholder="whsec_xxxxxxxxxxxx"
                required
                autoComplete="new-password"
                className={inputClass}
                value={stripeWebhookSecret}
                onChange={(e) => setStripeWebhookSecret(e.target.value)}
              />
            </label>

            {stripeError ? (
              <p className="rounded-sm border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
                {stripeError}
              </p>
            ) : null}

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={connectStripe.isPending}>
                {connectStripe.isPending ? "Connecting…" : "Connect Stripe"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStripeDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
