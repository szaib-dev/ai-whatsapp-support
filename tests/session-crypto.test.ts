import { it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { SessionCipher } from "../apps/api/src/session-crypto.js";
it("encrypts and restores credentials without exposing plaintext", () => {
  const cipher = new SessionCipher(randomBytes(32).toString("base64"));
  const encrypted = cipher.seal("revive/session/creds", "private credentials");
  expect(encrypted).not.toContain("private credentials");
  expect(cipher.open("revive/session/creds", encrypted)).toBe("private credentials");
  expect(cipher.seal("revive/session/creds", "private credentials")).not.toBe(encrypted);
});
it("rejects credentials moved across clinics, accounts, or Signal key identifiers", () => {
  const cipher = new SessionCipher(randomBytes(32).toString("base64"));
  const encrypted = cipher.seal("revive/session/creds", "private credentials");
  for (const context of ["zorro/session/creds", "revive/other-session/creds", "revive/session/other-key"]) expect(() => cipher.open(context, encrypted)).toThrow();
});
it("rejects tampering, truncation, invalid keys and a different encryption key", () => {
  expect(() => new SessionCipher("short")).toThrow();
  const cipher = new SessionCipher(randomBytes(32).toString("base64"));
  const encrypted = cipher.seal("context", "private credentials");
  const damaged = Buffer.from(encrypted, "base64"); damaged[15] ^= 1;
  expect(() => cipher.open("context", damaged.toString("base64"))).toThrow();
  expect(() => cipher.open("context", "short")).toThrow();
  expect(() => new SessionCipher(randomBytes(32).toString("base64")).open("context", encrypted)).toThrow();
});
