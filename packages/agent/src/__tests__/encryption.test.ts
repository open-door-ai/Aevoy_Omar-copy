import { describe, it, expect, beforeAll } from "vitest";

// Set ENCRYPTION_KEY before importing the module
beforeAll(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64); // 32 bytes in hex
});

describe("memory encryption (encrypt/decrypt)", () => {
  it("round-trips correctly", async () => {
    const { encrypt, decrypt } = await import("../services/memory.js");
    const plaintext = "Hello, this is a secret message!";
    const encrypted = await encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":");
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const { encrypt } = await import("../services/memory.js");
    const plaintext = "same message";
    const enc1 = await encrypt(plaintext);
    const enc2 = await encrypt(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it("handles empty string", async () => {
    const { encrypt, decrypt } = await import("../services/memory.js");
    const encrypted = await encrypt("");
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles unicode text", async () => {
    const { encrypt, decrypt } = await import("../services/memory.js");
    const plaintext = "Hello 🌍 Bonjour 日本語 مرحبا";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("fails to decrypt with wrong data", async () => {
    const { decrypt } = await import("../services/memory.js");
    await expect(decrypt("bad:data:here")).rejects.toThrow();
  });
});

describe("user-derived encryption", () => {
  it("derives consistent keys for same user", async () => {
    const { deriveUserKey } = await import("../security/encryption.js");
    const key1 = await deriveUserKey("user-123");
    const key2 = await deriveUserKey("user-123");
    expect(key1.toString("hex")).toBe(key2.toString("hex"));
  });

  it("derives different keys for different users", async () => {
    const { deriveUserKey } = await import("../security/encryption.js");
    const key1 = await deriveUserKey("user-123");
    const key2 = await deriveUserKey("user-456");
    expect(key1.toString("hex")).not.toBe(key2.toString("hex"));
  });

  it("encrypts and decrypts for a user", async () => {
    const { deriveUserKey, encryptForUser, decryptForUser } = await import("../security/encryption.js");
    const key = await deriveUserKey("test-user");
    const plaintext = "sensitive user data";
    const encrypted = await encryptForUser(plaintext, key);
    const decrypted = await decryptForUser(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("cannot decrypt with wrong key", async () => {
    const { deriveUserKey, encryptForUser, decryptForUser } = await import("../security/encryption.js");
    const key1 = await deriveUserKey("user-A");
    const key2 = await deriveUserKey("user-B");
    const encrypted = await encryptForUser("secret", key1);
    await expect(decryptForUser(encrypted, key2)).rejects.toThrow();
  });

  it("handles credentials encryption", async () => {
    const { deriveUserKey, encryptCredentials, decryptCredentials } = await import("../security/encryption.js");
    const key = await deriveUserKey("cred-test-user");
    const creds = { site: "example.com", username: "admin", password: "s3cret" };
    const encrypted = await encryptCredentials(creds, key);
    const decrypted = await decryptCredentials(encrypted, key);
    expect(decrypted).toEqual(creds);
  });
});
