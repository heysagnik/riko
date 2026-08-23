import type { ExposureKind } from "./case.js";

export interface CaseFacts {
  caseId: string;
  exposureKind: ExposureKind;
  /** Tone the policy engine authorised. The validator rejects drafts that exceed it. */
  rung: string | null;
  amountMinor: number;
  currency: string;
  failureCategory: string;
  customerName: string;
  attemptNumber: number;
  priorSubjects: string[];
  merchantName: string;
  daysOverdue: number | null;
  updatePaymentMethodUrl: string;
  unsubscribeUrl: string;
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
