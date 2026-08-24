const IST_TIMEZONE = "Asia/Kolkata";

const IST_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function formatIstNow(now: Date): string {
  return `${IST_FORMATTER.format(now)} IST`;
}
