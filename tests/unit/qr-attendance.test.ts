import assert from "node:assert/strict";
import { test } from "node:test";
import { QR_SLOT_MS, scanPath, signQr, slotAt, verifyQr } from "../../src/lib/qr-attendance";

// The secret is read when a code is signed, so setting it here (after the imports) is early enough.
process.env.SESSION_SECRET = "unit-test-secret-unit-test-secret-1234";

const date = "2026-11-13";
const period = "slot123";
const t0 = Date.UTC(2026, 10, 13, 4, 0, 5); // any moment; slots are 20 s long
const slot = slotAt(t0);

test("a fresh code is accepted", () => {
  assert.equal(verifyQr(date, period, slot, signQr(date, period, slot), t0), "ok");
});

test("the next 20-second slot still accepts it (grace), the one after does not", () => {
  const sig = signQr(date, period, slot);
  assert.equal(verifyQr(date, period, slot, sig, t0 + QR_SLOT_MS), "ok");
  assert.equal(verifyQr(date, period, slot, sig, t0 + 2 * QR_SLOT_MS), "expired");
});

test("a tampered signature, date or period is invalid", () => {
  const sig = signQr(date, period, slot);
  assert.equal(verifyQr(date, period, slot, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"), t0), "invalid");
  assert.equal(verifyQr("2026-11-14", period, slot, sig, t0), "invalid");
  assert.equal(verifyQr(date, "other", slot, sig, t0), "invalid");
  assert.equal(verifyQr(date, period, slot, "", t0), "invalid");
});

test("a code made for a future slot is invalid", () => {
  assert.equal(verifyQr(date, period, slot + 5, signQr(date, period, slot + 5), t0), "invalid");
});

test("the scan link carries a verifiable code", () => {
  const url = new URL(scanPath(date, "x:abc", slot), "https://example.test");
  assert.equal(url.pathname, "/student/scan");
  assert.equal(url.searchParams.get("p"), "x:abc");
  assert.equal(verifyQr(url.searchParams.get("d")!, url.searchParams.get("p")!, Number(url.searchParams.get("s")), url.searchParams.get("k")!, t0), "ok");
});
