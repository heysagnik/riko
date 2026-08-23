export interface LogActionInput {
  caseId: string;
  tool: string;
  input: unknown;
  output: unknown;
  model: string | null;
  latencyMs: number | null;
}

export type LogAction = (entry: LogActionInput) => Promise<void>;
