const DEFAULT_TIMEZONE = process.env.DEFAULT_CUSTOMER_TIMEZONE ?? "Asia/Kolkata";

import { CONTACT_WINDOW_END_HOUR, CONTACT_WINDOW_START_HOUR } from "@riko/core";

function formatParts(instant: Date, timeZone: string): Map<string, string> {
  return new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
}

export function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = formatParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month"))! - 1,
    Number(parts.get("day")),
    Number(parts.get("hour")) % 24,
    Number(parts.get("minute")),
    Number(parts.get("second")),
  );
  return asUtc - instant.getTime();
}

export function defaultTimezone(): string {
  return DEFAULT_TIMEZONE;
}

export function startOfLocalDay(at: Date, timeZone?: string | null): Date {
  const tz = timeZone ?? DEFAULT_TIMEZONE;
  const parts = formatParts(at, tz);
  const midnightUtc = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month"))! - 1,
    Number(parts.get("day")),
  );

  let candidate = midnightUtc - timezoneOffsetMs(new Date(midnightUtc), tz);
  candidate = midnightUtc - timezoneOffsetMs(new Date(candidate), tz);
  return new Date(candidate);
}

export function localHourFor(timezone: string | null, at: Date = new Date()): number {
  try {
    return Number(formatParts(at, timezone ?? DEFAULT_TIMEZONE).get("hour")) % 24;
  } catch {
    return at.getHours();
  }
}

export function nextContactWindowOpen(timeZone?: string | null): Date {
  const tz = timeZone ?? DEFAULT_TIMEZONE;
  const now = new Date();

  const openToday = startOfLocalDay(now, tz).getTime() + CONTACT_WINDOW_START_HOUR * 60 * 60 * 1000;
  if (now.getTime() < openToday) return new Date(openToday);

  const openTomorrow =
    startOfLocalDay(new Date(now.getTime() + 24 * 60 * 60 * 1000), tz).getTime() +
    CONTACT_WINDOW_START_HOUR * 60 * 60 * 1000;
  if (now.getTime() < openTomorrow) {
    const closeToday =
      startOfLocalDay(now, tz).getTime() + CONTACT_WINDOW_END_HOUR * 60 * 60 * 1000;
    return now.getTime() < closeToday ? now : new Date(openTomorrow);
  }

  return new Date(openTomorrow);
}
