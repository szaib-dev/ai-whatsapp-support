import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export class SessionCipher {
  private key: Buffer;
  constructor(secret: string) {
    this.key = Buffer.from(secret, "base64");
    if (this.key.length !== 32) throw new Error("SESSION_ENCRYPTION_KEY must be 32 bytes in base64");
  }
  seal(context: string, value: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    return Buffer.concat([nonce, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  }
  open(context: string, encoded: string) {
    const value = Buffer.from(encoded, "base64");
    if (value.length < 28) throw new Error("Invalid encrypted session");
    const cipher = createDecipheriv("aes-256-gcm", this.key, value.subarray(0, 12));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString("utf8");
  }
}
