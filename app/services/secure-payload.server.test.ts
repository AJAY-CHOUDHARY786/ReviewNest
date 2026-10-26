import { afterEach, describe, expect, it } from "vitest";
import { decryptPayload, encryptPayload } from "./secure-payload.server";

afterEach(() => {
  delete process.env.DATA_ENCRYPTION_KEY;
});

describe("encrypted import payloads", () => {
  it("round trips JSON without exposing plaintext", () => {
    process.env.DATA_ENCRYPTION_KEY = "test-only-key-for-payload-tests";
    const value = [
      { reviewerEmail: "private@example.test", body: "Review text" },
    ];
    const ciphertext = encryptPayload(value);
    expect(ciphertext).not.toContain("private@example.test");
    expect(decryptPayload(ciphertext)).toEqual(value);
  });

  it("requires an encryption key", () => {
    expect(() => encryptPayload({ body: "private" })).toThrow(
      /DATA_ENCRYPTION_KEY/,
    );
  });

  it("rejects a tampered encrypted payload", () => {
    process.env.DATA_ENCRYPTION_KEY = "test-only-key-for-payload-tests";
    const ciphertext = encryptPayload({ body: "private" });
    const [iv, tag, payload] = ciphertext.split(".");
    expect(() => decryptPayload(`${iv}.${tag}.${payload}x`)).toThrow();
  });
});
