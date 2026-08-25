import type { LanguageModel } from "ai";
import type { CaseFacts, EmailDraft } from "@riko/shared";
import { draftEmail } from "./draft-email.js";
import { validateDraft } from "./validate/rules.js";
import { scoreDraft } from "./validate/score.js";
import type { LogAction } from "./tools/log-action.js";

const MAX_DRAFT_ATTEMPTS = 3;

export type DraftLoopOutcome =
  | { status: "valid"; draft: EmailDraft }
  | { status: "escalated"; lastFailures: string[] };

export async function runDraftLoop(
  model: LanguageModel,
  modelId: string,
  caseId: string,
  facts: CaseFacts,
  logAction: LogAction,
): Promise<DraftLoopOutcome> {
  let validationErrors: string[] = [];
  let best: { draft: EmailDraft; score: number } | null = null;

  for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt += 1) {
    const temperature = validationErrors.length > 0 ? 0.3 : 0.7;

    let result;
    try {
      result = await draftEmail(model, modelId, { facts, validationErrors, temperature });
    } catch (error) {
      await logAction({
        caseId,
        tool: "draft_email",
        input: { facts, validationErrors, attempt },
        output: { error: error instanceof Error ? error.message : String(error) },
        model: modelId,
        latencyMs: null,
      });
      validationErrors = ["generation_failed: the previous response was unusable, return only the JSON object"];
      continue;
    }

    await logAction({
      caseId,
      tool: "draft_email",
      input: { facts, validationErrors, attempt },
      output: result.draft,
      model: result.model,
      latencyMs: result.latencyMs,
    });

    const validation = validateDraft(result.draft, facts);
    const score = validation.valid ? scoreDraft(result.draft, facts) : -1;

    await logAction({
      caseId,
      tool: "validate_draft",
      input: result.draft,
      output: { ...validation, score },
      model: null,
      latencyMs: null,
    });

    if (validation.valid) {
      if (!best || score > best.score) best = { draft: result.draft, score };
      if (score >= 80 || attempt === MAX_DRAFT_ATTEMPTS) {
        return { status: "valid", draft: best.draft };
      }
      validationErrors = [];
      continue;
    }

    validationErrors = validation.failures.map((f) => `${f.rule}: ${f.detail}`);
  }

  if (best) return { status: "valid", draft: best.draft };
  return { status: "escalated", lastFailures: validationErrors };
}
