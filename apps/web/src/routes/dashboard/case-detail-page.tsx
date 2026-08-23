import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftIcon, CaretDownIcon } from "@phosphor-icons/react";
import {
  STATE_BADGE_VARIANT,
  STATE_LABEL,
  STATE_MARKER_CLASS,
  type CaseUiState,
} from "../../components/case-row.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js";
import { useCaseDetail, type AgentActionRow, type CaseEventRow, type CaseMessageRow } from "../../hooks/use-case-detail.js";
import { formatAmount } from "../../hooks/use-cases.js";
import { failureLabel, intentLabel, interventionLabel, INTERVENTION_TONE, reasonLabel } from "../../lib/labels.js";
import { cn } from "../../lib/utils.js";

const STATE_SENTENCE: Record<CaseUiState, string> = {
  NEW: "Opened, waiting on a decision",
  SKIPPED: "Closed without contact",
  DRAFTING: "Riko is writing the email",
  SENDING: "Email is going out",
  WAITING: "Emailed, waiting to hear back",
  PROMISED: "Customer promised to pay",
  RECOVERED: "Customer paid",
  ESCALATED: "Handed to a person",
  LOST: "Not recovered",
};

interface EmailDraftOutput {
  subject: string;
  bodyText: string;
}

function isEmailDraft(value: unknown): value is EmailDraftOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).subject === "string" &&
    typeof (value as Record<string, unknown>).bodyText === "string"
  );
}

interface ValidationOutput {
  valid: boolean;
  failures: { rule: string; detail: string }[];
  score?: number;
}

function isValidation(value: unknown): value is ValidationOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).valid === "boolean" &&
    Array.isArray((value as Record<string, unknown>).failures)
  );
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

function DraftCard({ draft, sent }: { draft: EmailDraftOutput; sent: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-surface-sunk", sent ? "border-accent/40" : "border-line")}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium text-ink">{draft.subject}</p>
        {sent ? <Badge variant="accent">Sent</Badge> : null}
      </div>
      <p className="whitespace-pre-wrap px-3 py-2.5 text-sm leading-relaxed text-ink-muted">{draft.bodyText}</p>
    </div>
  );
}

type Entry =
  | { kind: "event"; at: string; item: CaseEventRow }
  | { kind: "action"; at: string; item: AgentActionRow }
  | { kind: "message"; at: string; item: CaseMessageRow };

function AgentWork({ entries, sentSubject }: { entries: Entry[]; sentSubject: string | null }) {
  const [open, setOpen] = useState(false);

  const drafts = entries.filter((e) => e.kind === "action" && e.item.tool === "draft_email");
  const totalMs = entries.reduce(
    (sum, e) => sum + (e.kind === "action" ? (e.item.latencyMs ?? 0) : 0),
    0,
  );

  const finalDraft = [...drafts].reverse().find((e) => e.kind === "action" && isEmailDraft(e.item.output));
  const finalOutput = finalDraft && finalDraft.kind === "action" ? finalDraft.item.output : null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-sm py-1 text-left text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <CaretDownIcon
          size={14}
          weight="bold"
          className={cn("shrink-0 transition-transform duration-150", open ? "rotate-0" : "-rotate-90")}
        />
        <span>
          Riko wrote {drafts.length} {drafts.length === 1 ? "draft" : "drafts"} and checked{" "}
          {drafts.length === 1 ? "it" : "them"}
        </span>
        <span className="text-caption tabular-nums text-ink-faint">{(totalMs / 1000).toFixed(1)}s</span>
      </button>

      {!open && isEmailDraft(finalOutput) ? (
        <div className="mt-3">
          <DraftCard draft={finalOutput} sent={finalOutput.subject === sentSubject} />
        </div>
      ) : null}

      {open ? (
        <ol className="mt-3 space-y-4">
          {entries.map((entry) => {
            if (entry.kind !== "action") return null;
            const { item } = entry;

            if (item.tool === "draft_email" && isEmailDraft(item.output)) {
              return (
                <li key={item.id}>
                  <p className="mb-1.5 text-caption text-ink-faint">
                    Draft · {item.model ?? "model"} · {item.latencyMs ?? "—"}ms
                  </p>
                  <DraftCard draft={item.output} sent={item.output.subject === sentSubject} />
                </li>
              );
            }

            if (item.tool === "validate_draft" && isValidation(item.output)) {
              return (
                <li key={item.id} className="text-sm">
                  {item.output.valid ? (
                    <span className="flex items-center gap-2">
                      <Badge variant="recovered">Checks passed</Badge>
                      {typeof item.output.score === "number" ? (
                        <span className="text-caption tabular-nums text-ink-faint">
                          quality {item.output.score}/100
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <div>
                      <Badge variant="lost">Rejected</Badge>
                      <ul className="mt-1.5 space-y-0.5">
                        {item.output.failures.map((f) => (
                          <li key={f.rule} className="text-caption text-ink-muted">
                            {f.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            }

            return (
              <li key={item.id} className="text-caption text-ink-faint">
                {item.tool}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function MessageBubble({ message, customerName }: { message: CaseMessageRow; customerName: string }) {
  const inbound = message.direction === "inbound";

  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-2.5",
        inbound ? "border-line" : "border-accent/30 bg-accent/[0.04]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-label uppercase text-ink-muted">{inbound ? customerName : "Riko"}</span>
        {message.intent ? <Badge variant="default">{intentLabel(message.intent)}</Badge> : null}
        {typeof message.confidence === "number" ? (
          <span className="text-caption tabular-nums text-ink-faint">
            {Math.round(message.confidence * 100)}% sure
          </span>
        ) : null}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{message.body}</p>

      {message.rationale ? (
        <p className="mt-2 border-t border-line pt-2 text-caption text-ink-faint">
          Riko read this as: {message.rationale}
        </p>
      ) : null}
    </div>
  );
}

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data, isLoading, error, refetch, isRefetching } = useCaseDetail(caseId ?? "");

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-lost">Could not load this case.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          {isRefetching ? "Retrying…" : "Try again"}
        </Button>
      </div>
    );
  }

  const { case: caseRow, events, actions, messages, scheduledDraft, customer, payment } = data;
  const isClosed = Boolean(caseRow.closedAt);

  const entries: Entry[] = [
    ...events.map((e) => ({ kind: "event" as const, at: e.createdAt, item: e })),
    ...actions.map((a) => ({ kind: "action" as const, at: a.createdAt, item: a })),
    ...messages.map((m) => ({ kind: "message" as const, at: m.createdAt, item: m })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const sentDraft = [...actions]
    .reverse()
    .find((a) => a.tool === "draft_email" && isEmailDraft(a.output));
  const sentSubject = sentDraft && isEmailDraft(sentDraft.output) ? sentDraft.output.subject : null;

  type Step = {
    key: string;
    at: string;
    label: string;
    state: CaseUiState;
    agentWork: Entry[];
    message: CaseMessageRow | null;
  };

  const steps: Step[] = [];
  let pending: Entry[] = [];
  for (const entry of entries) {
    if (entry.kind === "action") {
      pending.push(entry);
      continue;
    }
    if (entry.kind === "message") {
      const inbound = entry.item.direction === "inbound";
      steps.push({
        key: entry.item.id,
        at: entry.at,
        label: inbound ? `${customer?.name ?? "Customer"} replied` : "Riko replied",
        state: caseRow.state,
        agentWork: pending,
        message: entry.item,
      });
      pending = [];
      continue;
    }
    steps.push({
      key: entry.item.id,
      at: entry.at,
      label: entry.item.reason ? reasonLabel(entry.item.reason) : STATE_SENTENCE[entry.item.toState],
      state: entry.item.toState,
      agentWork: pending,
      message: null,
    });
    pending = [];
  }
  if (pending.length > 0 && steps.length > 0) {
    steps[steps.length - 1]!.agentWork.push(...pending);
  }

  return (
    <div>
      <Link
        to="/dashboard/cases"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeftIcon size={14} weight="regular" />
        Cases
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-title text-ink">{customer?.name ?? "Unknown customer"}</h1>
        <Badge variant={STATE_BADGE_VARIANT[caseRow.state]}>{STATE_LABEL[caseRow.state]}</Badge>
        {caseRow.arm === "holdout" ? <Badge variant="skipped">Control group</Badge> : null}
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
        <span className="text-figure tabular-nums text-ink">
          {payment ? formatAmount(payment.amountMinor, payment.currency) : "—"}
        </span>
        <span aria-hidden>·</span>
        <span>{failureLabel(payment?.failureCategory)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{caseRow.attemptCount} of 3 attempts used</span>
      </p>

      <section className="mt-8 rounded-lg border border-line px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-label uppercase text-ink-muted">Riko decided</span>
          <Badge variant={INTERVENTION_TONE[caseRow.intervention ?? ""] ?? "default"}>
            {interventionLabel(caseRow.intervention)}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-ink">{reasonLabel(caseRow.interventionReason)}</p>
        {caseRow.nextActionAt && !isClosed ? (
          <p className="mt-1 text-caption text-ink-faint">
            Next look {day(caseRow.nextActionAt)} at {time(caseRow.nextActionAt)}
          </p>
        ) : null}
      </section>

      {scheduledDraft && !isClosed ? (
        <section className="mt-4 rounded-lg border border-accent/30 bg-accent/[0.04] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-label uppercase text-ink-muted">Written and scheduled</span>
            {scheduledDraft.scheduledFor ? (
              <Badge variant="waiting">
                Sends {day(scheduledDraft.scheduledFor)} at {time(scheduledDraft.scheduledFor)}
              </Badge>
            ) : (
              <Badge variant="waiting">Queued to send</Badge>
            )}
          </div>
          <p className="mt-2.5 text-sm font-medium text-ink">{scheduledDraft.subject}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-muted">{scheduledDraft.body}</p>
          <p className="mt-2 text-caption text-ink-faint">
            Drafted {day(scheduledDraft.createdAt)} at {time(scheduledDraft.createdAt)}. Riko rewrites it if the
            facts change before it sends.
          </p>
        </section>
      ) : null}

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_220px]">
        <section className="order-2 lg:order-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-subtitle text-ink">What happened</h2>
            <a
              href={`/api/cases/${caseRow.id}/audit`}
              className="text-sm text-accent transition-colors duration-150 hover:text-accent-hover"
            >
              Export audit
            </a>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <p className="mt-1.5 inline-flex cursor-help items-center gap-1.5 text-caption text-ink-faint">
                <span
                  className={cn(
                    "h-[6px] w-[6px] rounded-full",
                    data.chain.valid ? "bg-recovered" : "bg-lost",
                  )}
                  aria-hidden
                />
                {data.chain.valid
                  ? `${data.chain.eventCount} steps, none altered since`
                  : "This history has been altered"}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {data.chain.valid
                ? "Each step is hashed together with the one before it, so editing or removing any of them afterwards breaks the chain. This one still checks out."
                : `The hash chain breaks at step ${data.chain.brokenAtSeq ?? "?"}. Someone changed this record outside Riko.`}
            </TooltipContent>
          </Tooltip>

          <ol className="mt-4 space-y-5">
            {steps.map((step, i) => (
              <li key={step.key} className="relative pl-6">
                {i < steps.length - 1 ? (
                  <span className="absolute bottom-[-22px] left-[3px] top-4 w-px bg-line" aria-hidden />
                ) : null}
                <span
                  className={cn(
                    "absolute left-0 top-1.5 h-[7px] w-[7px] rounded-full",
                    STATE_MARKER_CLASS[step.state],
                  )}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm text-ink">{step.label}</p>
                  <span className="text-caption tabular-nums text-ink-faint">{time(step.at)}</span>
                </div>
                {step.message ? (
                  <div className="mt-2">
                    <MessageBubble message={step.message} customerName={customer?.name ?? "Customer"} />
                  </div>
                ) : null}
                {step.agentWork.length > 0 ? (
                  <div className="mt-2.5">
                    <AgentWork entries={step.agentWork} sentSubject={sentSubject} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <aside className="order-1 lg:order-2">
          <h2 className="text-label uppercase text-ink-muted">Details</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Failed</dt>
              <dd className="text-right text-ink">{payment ? day(payment.occurredAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Cause</dt>
              <dd className="text-right text-ink">{payment?.failureSource ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Provider code</dt>
              <dd className="text-right font-mono text-caption text-ink">{payment?.failureCode ?? "—"}</dd>
            </div>
            {payment?.providerRetryAt ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Provider retry</dt>
                <dd className="text-right text-ink">{day(payment.providerRetryAt)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Case</dt>
              <dd className="text-right font-mono text-caption text-ink-faint">{caseRow.id.slice(0, 8)}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {isClosed ? (
        <section className="mt-10 rounded-lg border border-line px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-label uppercase text-ink-muted">Case closed</span>
            <Badge variant={STATE_BADGE_VARIANT[caseRow.state]}>{STATE_LABEL[caseRow.state]}</Badge>
          </div>
          <p className="mt-2 text-sm text-ink">{reasonLabel(caseRow.closedReason)}</p>
          {caseRow.closedAt ? (
            <p className="mt-1 text-caption text-ink-faint">
              Closed {day(caseRow.closedAt)} at {time(caseRow.closedAt)}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
