import { Badge } from "../../components/ui/badge.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { usePolicy, type PolicyLimit } from "../../hooks/use-policy.js";

const GROUP_LABEL: Record<PolicyLimit["group"], string> = {
  budget: "How much",
  temporal: "How long",
  compliance: "What is off limits",
};

const GROUP_ORDER: PolicyLimit["group"][] = ["budget", "temporal", "compliance"];

export function PolicyPage() {
  const { data, isLoading } = usePolicy();

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-title text-ink">What Riko may do</h1>
        {data.outreachPaused ? <Badge variant="lost">Outreach paused</Badge> : null}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        Riko decides what to say. It does not decide any of this. Every bound below is enforced in code before a
        message can leave, and every time one stops a case it is written into that case's history.
      </p>

      <section className="mt-10">
        <h2 className="text-subtitle text-ink">Limits</h2>
        <dl className="mt-4 space-y-6">
          {GROUP_ORDER.map((group) => {
            const limits = data.limits.filter((l) => l.group === group);
            if (limits.length === 0) return null;
            return (
              <div key={group}>
                <p className="text-label uppercase text-ink-muted">{GROUP_LABEL[group]}</p>
                <div className="mt-2 divide-y divide-line border-y border-line">
                  {limits.map((limit) => (
                    <div key={limit.id} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
                      <dt className="text-ink-muted">{limit.label}</dt>
                      <dd className="shrink-0 tabular-nums text-ink">{limit.value}</dd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-subtitle text-ink">When Riko stops</h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {data.stoppingRules.map((rule) => (
            <li key={rule.id} className="py-3">
              <p className="text-sm text-ink">{rule.label}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{rule.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-subtitle text-ink">How far Riko may push</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Each rung is earned by what happened, never chosen by the agent. It cannot skip one.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-4 font-normal text-ink-muted">Rung</th>
                <th className="py-2 pr-4 font-normal text-ink-muted">Action</th>
                <th className="py-2 pr-4 font-normal text-ink-muted">Reached when</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.ladder.map((rung) => (
                <tr key={rung.rung}>
                  <td className="py-3 pr-4 align-top tabular-nums text-ink-faint">{rung.rung}</td>
                  <td className="py-3 pr-4 align-top text-ink">{rung.channel}</td>
                  <td className="py-3 pr-4 align-top">
                    <p className="text-ink-muted">{rung.entry}</p>
                    <p className="mt-0.5 text-caption text-ink-faint">{rung.detail}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
