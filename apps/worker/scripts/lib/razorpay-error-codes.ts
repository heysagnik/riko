// Shared fixture data for the Razorpay failure-code benchmark scripts.
// Sourced from Razorpay's "List of Errors" documentation - the "Bad Request
// Errors" and "Gateway Errors" tables - covering every documented payment
// failure reason across cards, UPI, netbanking, and mandates.

export type DocSection = "bad_request" | "gateway";

export interface RazorpayErrorDoc {
  code: string;
  section: DocSection;
  description: string;
}

// Reasons that appear in both the "Bad Request Errors" and "Gateway Errors"
// tables are kept once, tagged with the section where razorpay.ts's error
// mapping most plausibly expects to see them (a merchant-request-shaped
// message before payment, or a gateway/bank decline during payment).
export const RAZORPAY_ERROR_CODES: RazorpayErrorDoc[] = [
  // --- Bad Request Errors -------------------------------------------------
  { code: "amount_less_than_minimum_amount", section: "bad_request", description: "Amount in the payment request is less than the minimum amount." },
  { code: "authentication_failed", section: "bad_request", description: "The payment failed as 3D secure, or OTP authentication failed." },
  { code: "bank_account_invalid", section: "bad_request", description: "The bank account is not valid." },
  { code: "bank_account_validation_failed", section: "bad_request", description: "The third party validation failed as the given bank account details were incorrect." },
  { code: "bank_not_enabled", section: "bad_request", description: "The selected bank to complete the transaction is not enabled for your business." },
  { code: "bank_technical_error", section: "bad_request", description: "The issuing bank was facing technical problems at the moment the payment was attempted." },
  { code: "capture_failed", section: "bad_request", description: "Payment capture has failed." },
  { code: "card_expired", section: "bad_request", description: "The card has expired." },
  { code: "card_network_not_enabled", section: "bad_request", description: "The card's network (Visa, Mastercard, etc.) is not enabled for the merchant." },
  { code: "card_not_enrolled", section: "bad_request", description: "The card is not enrolled for this payment method." },
  { code: "card_number_invalid", section: "bad_request", description: "The card number is invalid." },
  { code: "card_type_invalid", section: "bad_request", description: "The card type is invalid." },
  { code: "compliance_violation", section: "bad_request", description: "The payment violates compliance requirements." },
  { code: "debit_instrument_blocked", section: "bad_request", description: "The customer is using a blocked card to complete the payment." },
  { code: "emi_greater_than_max_amount", section: "bad_request", description: "The EMI amount is greater than the maximum allowed amount." },
  { code: "emi_plan_unavailable", section: "bad_request", description: "The EMI plan is not available." },
  { code: "incorrect_atm_pin", section: "bad_request", description: "Incorrect ATM PIN entered." },
  { code: "incorrect_card_details", section: "bad_request", description: "Incorrect card details entered." },
  { code: "incorrect_card_expiry_date", section: "bad_request", description: "Incorrect card expiry date entered." },
  { code: "incorrect_cardholder_name", section: "bad_request", description: "Incorrect cardholder name entered." },
  { code: "incorrect_cvv", section: "bad_request", description: "The customer has entered an incorrect CVV to complete the payment." },
  { code: "incorrect_otp", section: "bad_request", description: "The customer has entered an incorrect OTP to complete the payment." },
  { code: "incorrect_pin", section: "bad_request", description: "Incorrect PIN entered." },
  { code: "input_validation_failed", section: "bad_request", description: "Payment failed due to wrong request or input sent in the payment request." },
  { code: "insufficient_funds", section: "bad_request", description: "The customer does not have sufficient funds in the account to complete the payment." },
  { code: "international_transaction_not_allowed", section: "bad_request", description: "International transactions are not allowed." },
  { code: "invalid_amount", section: "bad_request", description: "The amount provided is invalid." },
  { code: "invalid_currency", section: "bad_request", description: "The currency passed is not supported or is invalid." },
  { code: "invalid_device", section: "bad_request", description: "The device used is invalid for this transaction." },
  { code: "invalid_email", section: "bad_request", description: "The email address provided is invalid." },
  { code: "invalid_mobile_number", section: "bad_request", description: "The mobile number provided is not valid." },
  { code: "invalid_order_id", section: "bad_request", description: "Order ID required in the payment request is either missing or is invalid." },
  { code: "invalid_request", section: "bad_request", description: "The request is invalid." },
  { code: "invalid_user_details", section: "bad_request", description: "Invalid user details provided." },
  { code: "invalid_vpa", section: "bad_request", description: "The customer has entered an incorrect VPA to complete the payment." },
  { code: "live_mode_not_enabled", section: "bad_request", description: "Live mode is not enabled for your business." },
  { code: "merchant_not_activated", section: "bad_request", description: "The merchant account is not activated." },
  { code: "mismatch_in_transaction_details", section: "bad_request", description: "There is a mismatch in transaction details." },
  { code: "mobile_number_invalid", section: "bad_request", description: "The mobile number is invalid." },
  { code: "order_already_paid", section: "bad_request", description: "There can only be one successful payment for each order ID." },
  { code: "order_payment_method_mismatch", section: "bad_request", description: "The method mentioned in the order request is different from the method mentioned in the payment request." },
  { code: "order_amount_mismatch", section: "bad_request", description: "The amount mentioned in the order request is different from the amount mentioned in the payment request." },
  { code: "otp_attempts_exceeded", section: "bad_request", description: "OTP attempts have been exceeded." },
  { code: "otp_expired", section: "bad_request", description: "The OTP has expired." },
  { code: "payment_cancelled", section: "bad_request", description: "The customer has explicitly cancelled the payment." },
  { code: "payment_failed", section: "bad_request", description: "Payment processing failed due to error at bank or wallet gateway." },
  { code: "payment_method_not_enabled", section: "bad_request", description: "The selected payment method is not enabled for your business." },
  { code: "payment_pending_approval", section: "bad_request", description: "The payment is currently pending approval as part of the maker-checker flow." },
  { code: "payment_risk_check_failed", section: "bad_request", description: "Payment declined due to risk checks." },
  { code: "payment_timed_out", section: "bad_request", description: "The customer did not complete the transaction within the specified time." },
  { code: "pin_attempts_exceeded", section: "bad_request", description: "PIN attempts have been exceeded." },
  { code: "pin_not_set", section: "bad_request", description: "PIN is not set for the payment method." },
  { code: "record_not_found", section: "bad_request", description: "The requested record was not found." },
  { code: "recurring_payment_not_enabled", section: "bad_request", description: "Recurring payments are not enabled." },
  { code: "refund_limit_crossed", section: "bad_request", description: "The refund limit has been crossed." },
  { code: "server_error", section: "bad_request", description: "Technical error at Razorpay's server." },
  { code: "transaction_daily_limit_exceeded", section: "bad_request", description: "The customer has exceeded the daily transaction limit set on the card." },
  { code: "transaction_limit_exceeded", section: "bad_request", description: "The customers have exceeded the credit or debit limit set on their cards." },
  { code: "transaction_frequency_limit_exceeded", section: "bad_request", description: "NPCI transaction frequency limit exhausted." },
  { code: "transaction_on_vpa_restricted", section: "bad_request", description: "Transaction on this VPA has been temporarily / permanently blocked by the PSP." },
  { code: "upi_app_technical_error", section: "bad_request", description: "Technical error occurred at the customer's PSP." },
  { code: "upi_autopay_not_supported_on_psp", section: "bad_request", description: "UPI Autopay is not supported on PSP." },
  { code: "upi_collect_not_enabled", section: "bad_request", description: "UPI Collect flow is not enabled." },
  { code: "upi_intent_not_enabled", section: "bad_request", description: "UPI Intent flow is not enabled." },
  { code: "user_not_eligible", section: "bad_request", description: "The customer failed the eligibility check and is not eligible for credit." },
  { code: "user_not_registered_for_netbanking", section: "bad_request", description: "The customer's bank account is not registered for netbanking." },
  { code: "verification_failed", section: "bad_request", description: "Verification of the payment using the status check API has failed." },

  // --- Gateway Errors ------------------------------------------------------
  { code: "authorisation_declined_by_psp", section: "gateway", description: "PSP app has rejected the authorisation request." },
  { code: "bank_cutoff_in_progress", section: "gateway", description: "Bank CBS cutoff is in progress." },
  { code: "bank_not_available", section: "gateway", description: "Bank is not available due to a downtime or a technical issue." },
  { code: "beneficiary_account_does_not_exist", section: "gateway", description: "An issue with the beneficiary account which does not exist." },
  { code: "beneficiary_account_dormant", section: "gateway", description: "An issue with the beneficiary account which is dormant." },
  { code: "card_declined", section: "gateway", description: "The card has been declined." },
  { code: "collect_on_mcc_blocked", section: "gateway", description: "UPI Collect is blocked for this MCC." },
  { code: "collect_request_pending", section: "gateway", description: "A collect request is already pending for this transaction." },
  { code: "credit_limit_exceeded", section: "gateway", description: "The customer's credit limit has been exceeded." },
  { code: "credit_limit_expired", section: "gateway", description: "The customer's credit limit has expired." },
  { code: "credit_limit_inactive", section: "gateway", description: "The customer's credit limit is inactive." },
  { code: "credit_limit_not_approved", section: "gateway", description: "The customer's credit limit is not approved." },
  { code: "credit_not_permitted", section: "gateway", description: "Credit transactions are not permitted for this customer." },
  { code: "credit_failed", section: "gateway", description: "Credit processing has failed." },
  { code: "debit_declined", section: "gateway", description: "The debit transaction has been declined." },
  { code: "deemed_transaction", section: "gateway", description: "The transaction is deemed and cannot be processed." },
  { code: "debit_instrument_inactive", section: "gateway", description: "The debit instrument is inactive." },
  { code: "duplicate_rrn_found", section: "gateway", description: "A duplicate RRN was found." },
  { code: "funds_blocked_by_mandate", section: "gateway", description: "Funds are blocked by an existing mandate." },
  { code: "gateway_technical_error", section: "gateway", description: "Technical error occurred at the gateway." },
  { code: "invalid_response_from_gateway", section: "gateway", description: "Invalid response received from the gateway." },
  { code: "issuer_technical_error", section: "gateway", description: "Technical error occurred at the card issuer." },
  { code: "mandate_creation_declined", section: "gateway", description: "Mandate creation has been declined." },
  { code: "mandate_creation_expired", section: "gateway", description: "Mandate creation has expired." },
  { code: "mandate_creation_failed", section: "gateway", description: "Mandate creation has failed." },
  { code: "mandate_creation_timeout", section: "gateway", description: "Mandate creation has timed out." },
  { code: "mcc_amount_limit_exceeded", section: "gateway", description: "The amount limit for this MCC has been exceeded." },
  { code: "payment_amount_tampered", section: "gateway", description: "The payment amount has been tampered." },
  { code: "payment_collect_request_expired", section: "gateway", description: "The payment collect request has expired." },
  { code: "payment_declined", section: "gateway", description: "The payment has been declined." },
  { code: "payment_declined_due_to_high_traffic", section: "gateway", description: "Payment declined due to high traffic at the gateway." },
  { code: "payment_pending", section: "gateway", description: "The payment is pending and has not been completed yet." },
  { code: "payment_session_expired", section: "gateway", description: "The payment session has expired." },
  { code: "psp_app_not_available", section: "gateway", description: "PSP app is not available." },
  { code: "psp_app_not_supported", section: "gateway", description: "UPI App is not supported (blacklisted)." },
  { code: "psp_not_available", section: "gateway", description: "PSP is not available." },
  { code: "psp_not_registered", section: "gateway", description: "PSP is not registered." },
  { code: "reqauth_mandate_not_acknowledged", section: "gateway", description: "Request authentication mandate is not acknowledged." },
  { code: "request_timed_out", section: "gateway", description: "The request has timed out." },
  { code: "transaction_daily_count_exceeded", section: "gateway", description: "The daily transaction count has been exceeded." },
  { code: "vpa_resolution_failed", section: "gateway", description: "The UPI network failed to validate the VPA." },
];

// Merchant-configuration-shaped reasons (nothing the customer can fix by
// retrying) map to error_source "business", matching the doc's own source
// table ("Your integration sent an invalid request... Fix the request
// parameters"). Bad-request reasons a customer caused (wrong OTP, cancelled,
// low balance, bad card entry) map to "customer". Everything in the Gateway
// Errors table maps to "gateway", matching Razorpay's own section split.
export const BUSINESS_FAULT_CODES = new Set([
  "amount_less_than_minimum_amount",
  "bank_not_enabled",
  "card_network_not_enabled",
  "invalid_currency",
  "invalid_order_id",
  "invalid_request",
  "live_mode_not_enabled",
  "merchant_not_activated",
  "order_payment_method_mismatch",
  "order_amount_mismatch",
  "payment_method_not_enabled",
  "recurring_payment_not_enabled",
  "upi_collect_not_enabled",
  "upi_intent_not_enabled",
  "invalid_amount",
]);

export function errorSourceFor(doc: RazorpayErrorDoc): string {
  if (doc.section === "gateway") return "gateway";
  if (BUSINESS_FAULT_CODES.has(doc.code)) return "business";
  return "customer";
}

export function buildFailedPaymentEvent(doc: RazorpayErrorDoc, amountMinor: number) {
  return {
    id: `payment.failed:pay_${doc.code}:1`,
    type: "payment.failed",
    raw: {
      entity: "event" as const,
      account_id: "acc_bench",
      event: "payment.failed",
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: `pay_${doc.code}`,
            amount: amountMinor,
            currency: "INR",
            email: "customer@example.com",
            contact: "+919999999999",
            error_code: "BAD_REQUEST_ERROR",
            error_reason: doc.code,
            error_description: doc.description,
            error_source: errorSourceFor(doc),
            error_step: doc.section === "gateway" ? "payment_authorization" : "payment_initiation",
            created_at: Math.floor(Date.now() / 1000),
            notes: {},
          },
        },
      },
    },
  };
}
