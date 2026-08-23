import { z } from "zod";
import type { CaseState } from "../types/case.js";

export const CASE_STATES = [
  "NEW",
  "SKIPPED",
  "DRAFTING",
  "SENDING",
  "WAITING",
  "PROMISED",
  "RECOVERED",
  "ESCALATED",
  "LOST",
] as const;

export const CASE_STATE_GROUPS = {
  OPEN: ["NEW", "DRAFTING", "SENDING", "WAITING", "PROMISED"],
  RECOVERED: ["RECOVERED"],
  NEEDS_YOU: ["ESCALATED"],
  CLOSED: ["LOST", "SKIPPED"],
} as const satisfies Record<string, readonly CaseState[]>;

export type CaseStateGroup = keyof typeof CASE_STATE_GROUPS;

export const caseListQuerySchema = z.object({
  state: z.enum(["ALL", ...CASE_STATES, ...(Object.keys(CASE_STATE_GROUPS) as CaseStateGroup[])]).default("ALL"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function resolveCaseStates(state: string): readonly CaseState[] | null {
  if (state === "ALL") return null;
  if (state in CASE_STATE_GROUPS) return CASE_STATE_GROUPS[state as CaseStateGroup];
  return [state as CaseState];
}

export const caseIdParamSchema = z.object({
  caseId: z.string().uuid(),
});

export const metricsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(30),
});
