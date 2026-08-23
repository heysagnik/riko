import { describe, expect, it } from "vitest";
import { caseIdFromRecipient, taggedReplyTo } from "./address-tag.js";

const CASE_ID = "6b7f2848-6da8-4e6d-99f8-71a726f56686";

describe("taggedReplyTo", () => {
  it("tags the local part", () => {
    expect(taggedReplyTo("billing@acme.com", CASE_ID)).toBe(`billing+${CASE_ID}@acme.com`);
  });

  it("leaves an already-tagged address alone", () => {
    const tagged = `billing+${CASE_ID}@acme.com`;
    expect(taggedReplyTo(tagged, "other")).toBe(tagged);
  });

  it("does not mangle something that is not an address", () => {
    expect(taggedReplyTo("not-an-address", CASE_ID)).toBe("not-an-address");
  });
});

describe("caseIdFromRecipient", () => {
  it("recovers the case id", () => {
    expect(caseIdFromRecipient([`billing+${CASE_ID}@acme.com`])).toBe(CASE_ID);
  });

  it("reads through a display name and angle brackets", () => {
    expect(caseIdFromRecipient([`Acme Billing <billing+${CASE_ID}@acme.com>`])).toBe(CASE_ID);
  });

  it("scans every recipient, since replies often land via Cc", () => {
    expect(caseIdFromRecipient(["someone@else.com", null, `b+${CASE_ID}@acme.com`])).toBe(CASE_ID);
  });

  it("ignores a plus tag that is not a case id", () => {
    expect(caseIdFromRecipient(["billing+newsletter@acme.com"])).toBeNull();
  });

  it("returns null when nothing is tagged", () => {
    expect(caseIdFromRecipient(["billing@acme.com", undefined])).toBeNull();
  });
});
