CREATE INDEX "cases_tenant_opened_idx" ON "cases" USING btree ("tenant_id","opened_at");--> statement-breakpoint
CREATE INDEX "cases_tenant_state_idx" ON "cases" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "agent_actions_case_created_idx" ON "agent_actions" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "outreach_case_created_idx" ON "outreach" USING btree ("case_id","created_at");