"use strict";

const { generate, verify } = require("../../lib/sessionverifier");

describe("sessionverifier (shipped)", () => {
  const secret = "test-secret-with-enough-entropy-012345";
  const session = "sess-abc-123";

  test("generate returns url-safe base64 without padding", () => {
    const token = generate(secret, session);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
    expect(token).not.toMatch(/[=+/]/);
  });

  test("verify accepts a correct attempt built from generate+nonce", () => {
    const verifier = generate(secret, session);
    const n = Buffer.alloc(16, 7).toString("base64");
    const attempt = generate(Buffer.from(n, "base64"), verifier);
    expect(verify(secret, session, attempt, n)).toBe(true);
  });

  test("verify rejects wrong attempt", () => {
    const n = Buffer.alloc(16, 7).toString("base64");
    expect(verify(secret, session, "nope", n)).toBe(false);
  });

  test("verify rejects short nonce", () => {
    expect(verify(secret, session, "x", Buffer.alloc(4).toString("base64"))).toBe(
      false,
    );
  });

  test("generate throws without secret", () => {
    expect(() => generate("", session)).toThrow(/secret/i);
  });
});
