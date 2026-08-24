import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon, CaretDownIcon, DetectiveIcon, DotsThreeVerticalIcon } from "@phosphor-icons/react";
import {
  STATE_BADGE_VARIANT,
  STATE_LABEL,
  STATE_MARKER_CLASS,
  type CaseUiState,
} from "../../components/case-row.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js";
import { useCaseDetail, type AgentActionRow, type CaseEventRow, type CaseMessageRow } from "../../hooks/use-case-detail.js";
import { formatAmount } from "../../hooks/use-cases.js";
import { useCloseCase, useHandOffCase, useReplyToCase } from "../../hooks/use-escalations.js";
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
    <div className={cn("min-w-0 overflow-hidden rounded-lg border bg-surface-sunk", sent ? "border-accent/40" : "border-line")}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium text-ink">{draft.subject}</p>
        {sent ? <Badge variant="accent">Sent</Badge> : null}
      </div>
      <p className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-relaxed text-ink-muted">{draft.bodyText}</p>
    </div>
  );
}

function ReplyComposer({ caseId }: { caseId: string }) {
  const reply = useReplyToCase();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!body.trim()) return;
    reply.mutate(
      { caseId, body },
      {
        onSuccess: () => {
          setBody("");
          setSent(true);
          setOpen(false);
        },
      },
    );
  };

  if (!open) {
    return (
      <div className="mt-6 flex items-center justify-end gap-3">
        {sent ? <span className="text-caption text-recovered">Sent.</span> : null}
        <Button size="sm" onClick={() => setOpen(true)}>
          Reply
        </Button>
      </div>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-accent/30 bg-accent/[0.04] px-4 py-4 shadow-sm">
      <p className="text-label uppercase text-ink-faint">Reply as yourself</p>
      <textarea
        rows={8}
        autoFocus
        placeholder="Write to the customer…"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSent(false);
        }}
        className="mt-2.5 w-full resize-y rounded-sm border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent"
      />
      <div className="mt-2.5 flex items-center gap-3">
        <Button size="sm" onClick={handleSend} disabled={reply.isPending || !body.trim()}>
          {reply.isPending ? "Sending…" : "Send"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setBody("");
          }}
          disabled={reply.isPending}
        >
          Cancel
        </Button>
        {reply.isError ? <span className="text-caption text-lost">{reply.error.message}</span> : null}
      </div>
    </section>
  );
}

function CaseActionsMenu({ caseId, isEscalated }: { caseId: string; isEscalated: boolean }) {
  const handOff = useHandOffCase();
  const close = useCloseCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Case actions"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-muted outline-none transition-colors hover:border-accent hover:text-ink focus-visible:border-accent"
        >
          <DotsThreeVerticalIcon size={16} weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isEscalated ? (
          <DropdownMenuItem onSelect={() => close.mutate(caseId)}>Close the case</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => handOff.mutate(caseId)}>Hand off</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => close.mutate(caseId)}>Close the case</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarSection({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-line bg-surface px-4 py-3.5 shadow-sm", className)}>
      <p className="text-label uppercase text-ink-faint">{label}</p>
      <div className="mt-2.5">{children}</div>
    </section>
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
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full items-center gap-2 rounded-md text-left text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
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
    <div className={cn("min-w-0 rounded-xl border px-3.5 py-2.5", inbound ? "border-line bg-surface" : "border-accent/30 bg-accent/[0.04]")}>
      {message.subject ? (
        <p className="border-b border-line pb-1.5 text-sm font-medium text-ink break-words">{message.subject}</p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-label uppercase text-ink-muted">{inbound ? customerName : "Sent"}</span>
        {message.intent ? <Badge variant="default">{intentLabel(message.intent)}</Badge> : null}
        {typeof message.confidence === "number" ? (
          <span className="text-caption tabular-nums text-ink-faint">
            {Math.round(message.confidence * 100)}% sure
          </span>
        ) : null}
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{message.body}</p>

      {message.rationale ? (
        <p className="mt-2 border-t border-line pt-2 text-caption text-ink-faint break-words">
          Riko read this as: {message.rationale}
        </p>
      ) : null}
    </div>
  );
}

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isRefetching } = useCaseDetail(caseId ?? "");

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/dashboard/cases");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[5fr_2fr]">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
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
  const isEscalated = caseRow.state === "ESCALATED";

  // A merchant reply logs both a "merchant_replied" case event and a
  // caseMessages row for the same action. Fold them into one timeline step
  // instead of showing "Merchant replied" followed by a mislabeled "Riko
  // replied" bubble for the same send.
  const excludedEventIds = new Set<string>();
  const merchantMessageIds = new Set<string>();
  const merchantReplyEvents = events.filter((e) => e.reason === "merchant_replied");
  for (const msg of messages) {
    if (msg.direction !== "outbound") continue;
    const match = merchantReplyEvents.find(
      (e) =>
        !excludedEventIds.has(e.id) &&
        Math.abs(new Date(e.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 5000,
    );
    if (match) {
      excludedEventIds.add(match.id);
      merchantMessageIds.add(msg.id);
    }
  }

  const entries: Entry[] = [
    ...events.filter((e) => !excludedEventIds.has(e.id)).map((e) => ({ kind: "event" as const, at: e.createdAt, item: e })),
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
      const label = inbound
        ? `${customer?.name ?? "Customer"} replied`
        : merchantMessageIds.has(entry.item.id)
          ? "You replied"
          : "Riko replied";
      steps.push({
        key: entry.item.id,
        at: entry.at,
        label,
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

  const attemptCap = 3;

  return (
    <div>
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeftIcon size={14} weight="regular" />
        Back
      </button>

      <header className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunk text-sm font-medium text-ink-muted">
              {(customer?.name ?? "?").charAt(0).toUpperCase() || "?"}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="text-title text-ink">{customer?.name ?? "Unknown customer"}</h1>
                <Badge variant={STATE_BADGE_VARIANT[caseRow.state]}>{STATE_LABEL[caseRow.state]}</Badge>
                {caseRow.arm === "holdout" ? <Badge variant="skipped">Control group</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {failureLabel(payment?.failureCategory)}
                {payment ? ` · failed ${day(payment.occurredAt)}` : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-4">
            <div className="text-right">
              <p className="text-figure-lg tabular-nums text-ink">
                {payment ? formatAmount(payment.amountMinor, payment.currency) : "—"}
              </p>
              <p className="mt-0.5 text-caption text-ink-faint">at stake</p>
            </div>
            {!isClosed ? <CaseActionsMenu caseId={caseRow.id} isEscalated={isEscalated} /> : null}
          </div>
        </div>
        <div className="border-t border-line bg-surface-sunk px-5 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {Array.from({ length: attemptCap }).map((_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={cn(
                      "h-1.5 w-8 rounded-full",
                      i < caseRow.attemptCount ? "bg-ink-faint" : "bg-line",
                    )}
                  />
                ))}
              </div>
              <p className="text-caption tabular-nums text-ink-muted">
                {caseRow.attemptCount} of {attemptCap} attempts
              </p>
            </div>
            <p className="text-caption text-ink-faint">Opened {day(caseRow.openedAt)} at {time(caseRow.openedAt)}</p>
          </div>
        </div>
      </header>

      <div className="mt-6 grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[5fr_2fr]">
        <section className="min-w-0 order-2 lg:order-1">
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

          <ol className="mt-5 space-y-6">
            {steps.map((step, i) => (
              <li key={step.key} className="relative pl-7">
                {i < steps.length - 1 ? (
                  <span className="absolute bottom-[-26px] left-[5.5px] top-5 w-px bg-line" aria-hidden />
                ) : null}
                <span
                  className={cn(
                    "absolute left-0 top-1 h-3 w-3 rounded-full ring-2 ring-surface",
                    STATE_MARKER_CLASS[step.state],
                  )}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium text-ink">{step.label}</p>
                  <span className="text-caption tabular-nums text-ink-faint">{time(step.at)}</span>
                </div>
                {step.message ? (
                  <div className="mt-2.5">
                    <MessageBubble message={step.message} customerName={customer?.name ?? "Customer"} />
                  </div>
                ) : null}
                {step.agentWork.length > 0 ? (
                  <div className="mt-2.5 rounded-lg border border-dashed border-line bg-surface-sunk/60 px-3 py-2.5">
                    <AgentWork entries={step.agentWork} sentSubject={sentSubject} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          {isEscalated ? <ReplyComposer caseId={caseRow.id} /> : null}
        </section>

        <aside className="min-w-0 order-1 lg:order-2">
          <div className="space-y-4 lg:sticky lg:top-6">
            <SidebarSection label="Riko decided">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <DetectiveIcon size={16} weight="regular" className="text-ink-muted" />
                <Badge variant={INTERVENTION_TONE[caseRow.intervention ?? ""] ?? "default"}>
                  {interventionLabel(caseRow.intervention)}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-ink">{reasonLabel(caseRow.interventionReason)}</p>
              {caseRow.nextActionAt && !isClosed ? (
                <p className="mt-1.5 text-caption text-ink-faint">
                  Next look {day(caseRow.nextActionAt)} at {time(caseRow.nextActionAt)}
                </p>
              ) : null}
            </SidebarSection>

            {isClosed ? (
              <SidebarSection label="Outcome">
                <Badge variant={STATE_BADGE_VARIANT[caseRow.state]}>{STATE_LABEL[caseRow.state]}</Badge>
                <p className="mt-2 text-sm text-ink">{reasonLabel(caseRow.closedReason)}</p>
                {caseRow.closedAt ? (
                  <p className="mt-1.5 text-caption text-ink-faint">
                    Closed {day(caseRow.closedAt)} at {time(caseRow.closedAt)}
                  </p>
                ) : null}
              </SidebarSection>
            ) : null}

            {scheduledDraft && !isClosed ? (
              <section className="min-w-0 rounded-lg border border-accent/30 bg-accent/[0.04] px-4 py-3.5 shadow-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <p className="text-label uppercase text-ink-faint">Written and scheduled</p>
                  {scheduledDraft.scheduledFor ? (
                    <Badge variant="waiting">
                      Sends {day(scheduledDraft.scheduledFor)} at {time(scheduledDraft.scheduledFor)}
                    </Badge>
                  ) : (
                    <Badge variant="waiting">Queued to send</Badge>
                  )}
                </div>
                <p className="mt-2.5 text-sm font-medium text-ink break-words">{scheduledDraft.subject}</p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink-muted">{scheduledDraft.body}</p>
                <p className="mt-2 border-t border-accent/20 pt-2 text-caption text-ink-faint">
                  Drafted {day(scheduledDraft.createdAt)} at {time(scheduledDraft.createdAt)}. Riko rewrites it if
                  the facts change before it sends.
                </p>
              </section>
            ) : null}

            <SidebarSection label="Payment">
              <dl className="space-y-2.5 text-sm">
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
                <div className="border-t border-line pt-2.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Case</dt>
                    <dd className="text-right font-mono text-caption text-ink-faint">{caseRow.id.slice(0, 8)}</dd>
                  </div>
                </div>
              </dl>
            </SidebarSection>
          </div>
        </aside>
      </div>
    </div>
  );
}
