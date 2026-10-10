import { describe, expect, it } from "vitest";
import { ADMIN_SESSION_MS, MIN_ADMIN_PASSWORD_LENGTH, adminConfigured, createSessionValue, passwordMatches, verifySessionValue } from "./admin-auth";

const ENV = { ADMIN_PASSWORD: "correct horse battery staple" };

describe("admin password", () => {
  it("is switched off unless ADMIN_PASSWORD is set and long enough", () => {
    expect(adminConfigured({})).toBe(false);
    expect(adminConfigured({ ADMIN_PASSWORD: "" })).toBe(false);
    expect(adminConfigured({ ADMIN_PASSWORD: "a".repeat(MIN_ADMIN_PASSWORD_LENGTH - 1) })).toBe(false);
    expect(adminConfigured({ ADMIN_PASSWORD: "a".repeat(MIN_ADMIN_PASSWORD_LENGTH) })).toBe(true);
  });

  it("accepts only the exact password", () => {
    expect(passwordMatches("correct horse battery staple", ENV)).toBe(true);
    for (const wrong of ["", "wrong", "correct horse battery stapl", "correct horse battery staple ", "CORRECT HORSE BATTERY STAPLE", "x".repeat(5000)]) {
      expect(passwordMatches(wrong, ENV), JSON.stringify(wrong.slice(0, 20))).toBe(false);
    }
  });

  it("never matches when unconfigured, not even the empty password", () => {
    expect(passwordMatches("", {})).toBe(false);
    expect(passwordMatches("anything at all here", { ADMIN_PASSWORD: "short" })).toBe(false);
  });
});

describe("admin session cookie", () => {
  const now = 1_000_000_000_000;

  it("is valid for 8 hours and not a moment longer", () => {
    const value = createSessionValue(now, ENV)!;
    expect(verifySessionValue(value, now + 1000, ENV)).toBe(true);
    expect(verifySessionValue(value, now + ADMIN_SESSION_MS - 1, ENV)).toBe(true);
    expect(verifySessionValue(value, now + ADMIN_SESSION_MS, ENV)).toBe(false);
    expect(verifySessionValue(value, now + 2 * ADMIN_SESSION_MS, ENV)).toBe(false);
  });

  it("cannot be forged or extended", () => {
    const value = createSessionValue(now, ENV)!;
    const [expires, signature] = value.split(".");
    expect(verifySessionValue(`${Number(expires) + 3_600_000}.${signature}`, now, ENV)).toBe(false);   // later expiry, same signature
    expect(verifySessionValue(`${expires}.${signature.slice(0, -2)}xx`, now, ENV)).toBe(false);
    expect(verifySessionValue(`${expires}.`, now, ENV)).toBe(false);
    expect(verifySessionValue(`${now + 9e9}.${"A".repeat(43)}`, now, ENV)).toBe(false);
  });

  it("signs everyone out when the password changes", () => {
    const value = createSessionValue(now, ENV)!;
    expect(verifySessionValue(value, now, { ADMIN_PASSWORD: "a completely different password" })).toBe(false);
  });

  it.each([undefined, "", "garbage", "1.2.3", "abc.def", `NaN.${"x".repeat(43)}`])("rejects malformed value %j", (value) => {
    expect(verifySessionValue(value, now, ENV)).toBe(false);
  });

  it("does not exist at all when the admin area is not configured", () => {
    expect(createSessionValue(now, {})).toBeNull();
    expect(verifySessionValue("123.abc", now, {})).toBe(false);
  });
});
