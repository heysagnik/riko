import type { CaseFacts } from "@riko/shared";

export type GetCaseFacts = (caseId: string) => Promise<CaseFacts>;
