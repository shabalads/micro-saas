import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNLOCK_TOKEN_TTL_MS, signUnlockToken, verifyUnlockToken } from "./unlock-token";

const SECRET = "test-secret-test-secret-test-secret-0123";
const GRANT = { sessionId: "cs_test_abc123", jobId: "11111111-1111-4111-8111-111111111111", fingerprint: "sha256:abc" };

describe("unlock tokens (HMAC)", () => {
  beforeEach(() => {
    vi.stubEnv("UNLOCK_TOKEN_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("round-trips the claims", () => {
    const now = 1_000_000;
    const signed = signUnlockToken(GRANT, now);
    expect(signed?.expiresAt).toBe(now + UNLOCK_TOKEN_TTL_MS);
    expect(verifyUnlockToken(signed!.token, now + 1000)).toMatchObject({ sid: GRANT.sessionId, job: GRANT.jobId, fp: GRANT.fingerprint, exp: now + UNLOCK_TOKEN_TTL_MS });
  });

  it("is short-lived: valid just before expiry, rejected at and after it", () => {
    const now = 5_000_000;
    const { token } = signUnlockToken(GRANT, now)!;
    expect(verifyUnlockToken(token, now + UNLOCK_TOKEN_TTL_MS - 1)).not.toBeNull();
    expect(verifyUnlockToken(token, now + UNLOCK_TOKEN_TTL_MS)).toBeNull();
    expect(verifyUnlockToken(token, now + 24 * 3600 * 1000)).toBeNull();
    expect(UNLOCK_TOKEN_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("rejects a token whose payload was edited (e.g. a later expiry or another session)", () => {
    const { token } = signUnlockToken(GRANT, 1000)!;
    const [payload, signature] = token.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString());
    edited.exp = edited.exp + 10 * 3600 * 1000;
    const forgedPayload = Buffer.from(JSON.stringify(edited)).toString("base64url");
    expect(verifyUnlockToken(`${forgedPayload}.${signature}`, 2000)).toBeNull();
    edited.sid = "cs_test_someoneelse";
    expect(verifyUnlockToken(`${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`, 2000)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = signUnlockToken(GRANT, 1000)!;
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "another-secret-another-secret-another-0123");
    expect(verifyUnlockToken(token, 2000)).toBeNull();
  });

  it.each([undefined, null, 42, "", "garbage", "a.b.c", "a.", ".b", "x".repeat(5000)])("rejects malformed input %j", (input) => {
    expect(verifyUnlockToken(input, 1)).toBeNull();
  });

  it("refuses to sign or verify when the secret is missing or too short", () => {
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "short");
    expect(signUnlockToken(GRANT)).toBeNull();
    vi.stubEnv("UNLOCK_TOKEN_SECRET", "");
    expect(signUnlockToken(GRANT)).toBeNull();
    expect(verifyUnlockToken("a.b")).toBeNull();
  });
});
