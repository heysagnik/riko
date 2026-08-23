import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Logo } from "../../components/logo.js";

type Status = "working" | "redirecting" | "closed" | "unavailable" | "error";

interface PayResponse {
  payUrl: string;
  merchantName: string;
  amount: string;
}

export function PayPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [status, setStatus] = useState<Status>("working");
  const [details, setDetails] = useState<PayResponse | null>(null);

  useEffect(() => {
    if (!caseId) {
      setStatus("error");
      return;
    }
    let cancelled = false;

    fetch(`/api/public/pay/${caseId}`)
      .then(async (response) => {
        if (cancelled) return;

        if (response.status === 410) {
          setStatus("closed");
          return;
        }
        if (response.status === 409 || response.status === 502) {
          setStatus("unavailable");
          return;
        }
        if (!response.ok) {
          setStatus("error");
          return;
        }

        const body = (await response.json()) as PayResponse;
        setDetails(body);
        setStatus("redirecting");
        window.location.href = body.payUrl;
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [caseId]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md">
        <Logo />
        <div className="mt-8 border-t border-line pt-8">
          {status === "working" ? (
            <p className="text-sm text-ink-muted">Preparing your secure payment page…</p>
          ) : status === "redirecting" ? (
            <>
              <h1 className="text-title text-ink">Taking you to checkout</h1>
              <p className="mt-2 text-sm text-ink-muted">
                {details ? `${details.merchantName} — ${details.amount}.` : null} You'll finish on Razorpay's secure
                page.
              </p>
              {details ? (
                <p className="mt-4 text-sm text-ink-muted">
                  Not redirected?{" "}
                  <a className="underline" href={details.payUrl}>
                    Open the payment page
                  </a>
                  .
                </p>
              ) : null}
            </>
          ) : status === "closed" ? (
            <>
              <h1 className="text-title text-ink">Nothing left to pay</h1>
              <p className="mt-2 text-sm text-ink-muted">
                This payment has already been settled or the request was cancelled. You don't need to do anything.
              </p>
            </>
          ) : status === "unavailable" ? (
            <>
              <h1 className="text-title text-ink">Checkout is unavailable</h1>
              <p className="mt-2 text-sm text-ink-muted">
                We couldn't open the payment page just now. Please try again in a few minutes, or reply to the email
                you received and the business will help.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-title text-ink">That link didn't work</h1>
              <p className="mt-2 text-sm text-ink-muted">
                It may be expired or incomplete. Reply to the email you received and the business will sort it out.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
