import { describe, expect, it } from "vitest";
import { classifyInbound, extractMessageIds, type InboundMessage } from "./classify.js";

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    from: "priya@example.com",
    subject: "Re: Your card expired",
    text: "I already paid this yesterday, please check.",
    ...overrides,
  };
}

describe("classifyInbound", () => {
  it("treats a normal human response as a reply", () => {
    expect(classifyInbound(message()).kind).toBe("reply");
  });

  it("detects a hard bounce from a daemon sender", () => {
    const result = classifyInbound(
      message({
        from: "MAILER-DAEMON@mx.example.com",
        subject: "Undeliverable: Your card expired",
        text: "550 5.1.1 user unknown",
      }),
    );
    expect(result.kind).toBe("hard_bounce");
  });

  it("separates a soft bounce so the address is not suppressed forever", () => {
    const result = classifyInbound(
      message({
        from: "postmaster@mx.example.com",
        subject: "Delivery Status Notification (Delay)",
        text: "452 4.2.2 mailbox full, will retry",
      }),
    );
    expect(result.kind).toBe("soft_bounce");
  });

  it("detects a bounce from the report content type alone", () => {
    const result = classifyInbound(
      message({
        from: "someone@mx.example.com",
        subject: "failure",
        text: "no useful body",
        headers: { "Content-Type": "multipart/report; report-type=delivery-status" },
      }),
    );
    expect(result.kind).toBe("hard_bounce");
  });

  it("does not escalate an out-of-office autoresponder", () => {
    const result = classifyInbound(message({ subject: "Automatic reply: Your card expired" }));
    expect(result.kind).toBe("auto_reply");
  });

  it("recognises an auto-submitted header even without a telltale subject", () => {
    const result = classifyInbound(message({ headers: { "Auto-Submitted": "auto-replied" } }));
    expect(result.kind).toBe("auto_reply");
  });

  it("treats an explicit opt-out as an unsubscribe request", () => {
    const result = classifyInbound(message({ text: "Please stop emailing me about this." }));
    expect(result.kind).toBe("unsubscribe_request");
  });

  it("prefers a bounce reading over an unsubscribe phrase inside a daemon report", () => {
    const result = classifyInbound(
      message({
        from: "mailer-daemon@mx.example.com",
        subject: "Undeliverable",
        text: "550 user unknown. To unsubscribe click here.",
      }),
    );
    expect(result.kind).toBe("hard_bounce");
  });
});

describe("extractMessageIds", () => {
  it("pulls ids from both In-Reply-To and References", () => {
    const ids = extractMessageIds(
      message({ inReplyTo: "<a@riko>", references: "<b@riko> <a@riko>" }),
    );
    expect(ids).toContain("<a@riko>");
    expect(ids).toContain("<b@riko>");
    expect(ids).toHaveLength(2);
  });

  it("returns nothing when there are no references", () => {
    expect(extractMessageIds(message())).toEqual([]);
  });
});
