import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Logo } from "../../components/logo.js";

type Status = "working" | "done" | "already" | "error";

export function UnsubscribePage() {
  const { customerId } = useParams<{ customerId: string }>();
  const [status, setStatus] = useState<Status>("working");

  useEffect(() => {
    if (!customerId) {
      setStatus("error");
      return;
    }
    let cancelled = false;

    fetch(`/api/public/unsubscribe/${customerId}`, { method: "POST" })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setStatus("error");
          return;
        }
        const body = (await response.json()) as { alreadyUnsubscribed?: boolean };
        setStatus(body.alreadyUnsubscribed ? "already" : "done");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md">
        <Logo />
        <div className="mt-8 border-t border-line pt-8">
          {status === "working" ? (
            <p className="text-sm text-ink-muted">Updating your preferences…</p>
          ) : status === "done" ? (
            <>
              <h1 className="text-title text-ink">You're unsubscribed</h1>
              <p className="mt-2 text-sm text-ink-muted">
                We won't email you about this payment again. Any messages already queued have been stopped.
              </p>
              <p className="mt-4 text-sm text-ink-muted">
                Your payment itself is unchanged — if you still want to keep the service, contact the business
                directly.
              </p>
            </>
          ) : status === "already" ? (
            <>
              <h1 className="text-title text-ink">Already unsubscribed</h1>
              <p className="mt-2 text-sm text-ink-muted">You're not on this list. No further emails will be sent.</p>
            </>
          ) : (
            <>
              <h1 className="text-title text-ink">That link didn't work</h1>
              <p className="mt-2 text-sm text-ink-muted">
                It may be expired or incomplete. Reply to the email you received and the business will remove you.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
