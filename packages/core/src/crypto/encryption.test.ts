import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./encryption.js";

const key = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value", () => {
    const ciphertext = encryptSecret("hunter2", key);
    expect(ciphertext).not.toContain("hunter2");
    expect(decryptSecret(ciphertext, key)).toBe("hunter2");
  });

  it("produces different ciphertext for the same plaintext", () => {
    const a = encryptSecret("hunter2", key);
    const b = encryptSecret("hunter2", key);
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with the wrong key", () => {
    const ciphertext = encryptSecret("hunter2", key);
    const wrongKey = randomBytes(32).toString("base64");
    expect(() => decryptSecret(ciphertext, wrongKey)).toThrow();
  });
});
