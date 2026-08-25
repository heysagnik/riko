import { describe, expect, it } from "vitest";
import { extractPromise, MIN_PROMISE_CONFIDENCE } from "./extract.js";

const NOW = new Date("2026-08-19T09:00:00Z");

function days(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

describe("extractPromise", () => {
  it("reads a plain commitment with a named day", () => {
    const promise = extractPromise("Hi, sorry for the delay. I will pay this on Friday.", NOW);
    expect(promise).not.toBeNull();
    expect(days(NOW, promise!.promisedFor)).toBe(2);
    expect(promise!.confidence).toBeGreaterThanOrEqual(MIN_PROMISE_CONFIDENCE);
  });

  it("reads tomorrow", () => {
    const promise = extractPromise("We'll pay tomorrow, apologies.", NOW);
    expect(days(NOW, promise!.promisedFor)).toBe(1);
  });

  it("reads a day of the month and rolls into next month when it has passed", () => {
    const promise = extractPromise("Payment will be made by the 5th.", NOW);
    expect(promise!.promisedFor.getUTCMonth()).toBe(8);
    expect(promise!.promisedFor.getUTCDate()).toBe(5);
  });

  it("picks up a stated amount and trusts the reading slightly more", () => {
    const withAmount = extractPromise("I will pay INR 4,150.00 on Friday.", NOW);
    const without = extractPromise("I will pay on Friday.", NOW);
    expect(withAmount!.amountMinor).toBe(415000);
    expect(withAmount!.confidence).toBeGreaterThan(without!.confidence);
  });

  it("refuses a refusal", () => {
    expect(extractPromise("I cannot pay this until next month.", NOW)).toBeNull();
  });

  it("refuses a dispute", () => {
    expect(extractPromise("We already paid this invoice on Monday.", NOW)).toBeNull();
  });

  it("refuses intent with no date", () => {
    expect(extractPromise("Yes, I will pay. Thanks.", NOW)).toBeNull();
  });

  it("refuses a date with no intent", () => {
    expect(extractPromise("I am out of office until Friday.", NOW)).toBeNull();
  });

  it("refuses a commitment too far out to be one", () => {
    expect(extractPromise("I will pay in 20 weeks.", NOW)).toBeNull();
  });

  it("scores a vague horizon below a named date", () => {
    const vague = extractPromise("We will settle this next month.", NOW);
    const named = extractPromise("We will settle this on 3 September.", NOW);
    expect(vague!.confidence).toBeLessThan(named!.confidence);
  });
});

describe("hour-scale promises", () => {
  it("captures 'in 1 hr' rather than dropping the fastest promise there is", () => {
    const p = extractPromise("I will pay you in 1 hr. Thanks for your patience.");
    expect(p).not.toBeNull();
    expect(p!.confidence).toBeGreaterThanOrEqual(MIN_PROMISE_CONFIDENCE);
    const hours = (p!.promisedFor.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(0.5);
    expect(hours).toBeLessThan(2);
  });

  it("captures 'in an hour'", () => {
    expect(extractPromise("will pay in an hour")).not.toBeNull();
  });

  it("captures 'tonight'", () => {
    expect(extractPromise("I will pay tonight")).not.toBeNull();
  });

  it("still ignores a request for more time", () => {
    expect(extractPromise("I have no money give me 2 days of time")).toBeNull();
  });
});
