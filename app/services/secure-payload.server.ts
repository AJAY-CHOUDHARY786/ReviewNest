import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function encryptionKey() {
  const configured = process.env.DATA_ENCRYPTION_KEY;
  if (!configured)
    throw new Error(
      "DATA_ENCRYPTION_KEY is required for queued personal data.",
    );
  return createHash("sha256").update(configured).digest();
}

export function encryptPayload(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptPayload<T>(payload: string): T {
  const [ivText, tagText, ciphertextText] = payload.split(".");
  if (!ivText || !tagText || !ciphertextText)
    throw new Error("Invalid encrypted payload.");
  const canonicalBase64Url = /^[A-Za-z0-9_-]+$/;
  if (
    !canonicalBase64Url.test(ivText) ||
    !canonicalBase64Url.test(tagText) ||
    !canonicalBase64Url.test(ciphertextText)
  ) {
    throw new Error("Invalid encrypted payload encoding.");
  }
  if (
    Buffer.from(ivText, "base64url").toString("base64url") !== ivText ||
    Buffer.from(tagText, "base64url").toString("base64url") !== tagText ||
    Buffer.from(ciphertextText, "base64url").toString("base64url") !==
      ciphertextText
  ) {
    throw new Error("Non-canonical encrypted payload encoding.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
