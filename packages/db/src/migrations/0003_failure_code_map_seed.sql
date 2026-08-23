-- Seed data only, per PLAN.md section 4: provider differences live in this
-- table, not in adapter code. Adding a provider's codes here is the
-- extension point; the adapters' own categorize() maps are a computed
-- fallback and are superseded by this table when an entry exists.
insert into "failure_code_map" ("provider_id", "provider_code", "failure_category", "recoverable") values
  ('stripe', 'insufficient_funds', 'insufficient_funds', true),
  ('stripe', 'card_declined', 'bank_decline', true),
  ('stripe', 'expired_card', 'expired_card', true),
  ('stripe', 'authentication_required', 'authentication_required', true),
  ('stripe', 'processing_error', 'network_error', true),
  ('stripe', 'incorrect_number', 'invalid_instrument', true),
  ('stripe', 'invalid_expiry_month', 'invalid_instrument', true),
  ('stripe', 'invalid_expiry_year', 'invalid_instrument', true),
  ('stripe', 'invalid_cvc', 'invalid_instrument', true),
  ('razorpay', 'insufficient_funds', 'insufficient_funds', true),
  ('razorpay', 'expired_card', 'expired_card', true),
  ('razorpay', 'authentication_failed', 'authentication_required', true),
  ('razorpay', 'payment_declined', 'bank_decline', true),
  ('razorpay', 'issuer_unavailable', 'network_error', true),
  ('razorpay', 'gateway_error', 'network_error', true),
  ('razorpay', 'invalid_number', 'invalid_instrument', true),
  ('razorpay', 'invalid_expiry_month', 'invalid_instrument', true),
  ('razorpay', 'invalid_expiry_year', 'invalid_instrument', true),
  ('razorpay', 'invalid_cvv', 'invalid_instrument', true)
on conflict ("provider_id", "provider_code") do nothing;
