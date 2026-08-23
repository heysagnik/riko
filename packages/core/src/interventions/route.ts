import type { Intervention, InterventionInput } from "./types.js";
import { routePaymentFailure } from "./policy-payment.js";
import { routeAbandonment } from "./policy-abandonment.js";
import { routeReceivable } from "./policy-receivable.js";

export * from "./types.js";
export { isFraudSignal, nextSalaryWindow, routePaymentFailure } from "./policy-payment.js";
export { routeAbandonment, ABANDONMENT_FLOOR_MINOR, ABANDONMENT_SWEEP_MINUTES } from "./policy-abandonment.js";
export {
  routeReceivable,
  rungForDaysOverdue,
  RECEIVABLE_RUNGS,
  type ReceivableRung,
} from "./policy-receivable.js";

export function routeIntervention(input: InterventionInput): Intervention {
  switch (input.exposureKind) {
    case "checkout_abandonment":
      return routeAbandonment(input);
    case "overdue_receivable":
      return routeReceivable(input);
    case "payment_failure":
      return routePaymentFailure(input);
  }
}
