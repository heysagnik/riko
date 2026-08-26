import type { ExposureKind } from "./case.js";
import type { AgentPersistence, AgentTone } from "../schemas/agent-settings.js";

export type DraftLanguage = "english" | "hinglish";

export interface CaseFacts {
  caseId: string;
  exposureKind: ExposureKind;
  rung: string | null;
  language: DraftLanguage;
  amountMinor: number;
  currency: string;
  failureCategory: string;
  failureSource?: string | null;
  failureDescription?: string | null;
  customerName: string;
  attemptNumber: number;
  priorSubjects: string[];
  merchantName: string;
  daysOverdue: number | null;
  updatePaymentMethodUrl: string;
  unsubscribeUrl: string;
  merchantGuidance?: string | null;
  tone?: AgentTone | null;
  persistence?: AgentPersistence | null;
  highValue?: boolean | null;
}

export interface EmailDraft {
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

export interface ValidationFailure {
  rule: string;
  detail: string;
}

export interface ValidationResult {
  valid: boolean;
  failures: ValidationFailure[];
}
