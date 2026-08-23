import { describe, expect, it, vi, afterEach } from "vitest";
import { ageLabelFromDate } from "./use-cases.js";

const NOW = new Date("2026-08-23T12:00:00Z").getTime();

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("ageLabelFromDate", () => {
  afterEach(() => vi.useRealTimers());

  function freeze() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  it("reports minutes below an hour instead of rounding up to 1h", () => {
    freeze();
    expect(ageLabelFromDate(ago(2 * 60_000))).toBe("2m");
    expect(ageLabelFromDate(ago(45 * 60_000))).toBe("45m");
  });

  it("reports 'now' for something that just happened", () => {
    freeze();
    expect(ageLabelFromDate(ago(5_000))).toBe("now");
  });

  it("reports hours between one hour and a day", () => {
    freeze();
    expect(ageLabelFromDate(ago(60 * 60_000))).toBe("1h");
    expect(ageLabelFromDate(ago(23 * 60 * 60_000))).toBe("23h");
  });

  it("reports days beyond 24 hours", () => {
    freeze();
    expect(ageLabelFromDate(ago(50 * 60 * 60_000))).toBe("2d");
  });

  it("does not render a negative age for a future timestamp", () => {
    freeze();
    expect(ageLabelFromDate(new Date(NOW + 60_000).toISOString())).toBe("now");
  });
});
