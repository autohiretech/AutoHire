import { assert, assertEquals } from 'jsr:@std/assert@^1.0.0';
import { canonicalJson, signConfirmToken, tokenAuthorizes, verifyConfirmToken } from '../confirm.ts';

const SECRET = 'test-secret';

Deno.test('canonicalJson is stable regardless of key order', () => {
  assertEquals(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assertEquals(canonicalJson({ a: { y: 1, x: 2 } }), '{"a":{"x":2,"y":1}}');
});

Deno.test('a signed token verifies and round-trips its claims', async () => {
  const { token, jti } = await signConfirmToken({ userId: 'u1', tool: 'cancel_trip', input: { bookingId: 'b1' } }, SECRET);
  const result = await verifyConfirmToken(token, SECRET);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.claims.sub, 'u1');
    assertEquals(result.claims.tool, 'cancel_trip');
    assertEquals(result.claims.jti, jti);
    assert(tokenAuthorizes(result.claims, { userId: 'u1', tool: 'cancel_trip', input: { bookingId: 'b1' } }));
  }
});

Deno.test('a token does not authorize a different tool or a different input', async () => {
  const { token } = await signConfirmToken({ userId: 'u1', tool: 'cancel_trip', input: { bookingId: 'b1' } }, SECRET);
  const result = await verifyConfirmToken(token, SECRET);
  assert(result.ok);
  if (!result.ok) return;
  assert(!tokenAuthorizes(result.claims, { userId: 'u1', tool: 'start_booking', input: { bookingId: 'b1' } }));
  assert(!tokenAuthorizes(result.claims, { userId: 'u1', tool: 'cancel_trip', input: { bookingId: 'b2' } }));
  assert(!tokenAuthorizes(result.claims, { userId: 'u2', tool: 'cancel_trip', input: { bookingId: 'b1' } }));
});

Deno.test('a tampered token is rejected', async () => {
  const { token } = await signConfirmToken({ userId: 'u1', tool: 'cancel_trip', input: { bookingId: 'b1' } }, SECRET);
  const [payload] = token.split('.');
  const tamperedClaims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  tamperedClaims.tool = 'start_booking';
  const tamperedPayload = btoa(JSON.stringify(tamperedClaims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const [, sig] = token.split('.');
  const result = await verifyConfirmToken(`${tamperedPayload}.${sig}`, SECRET);
  assertEquals(result.ok, false);
});

Deno.test('a token signed with a different secret is rejected', async () => {
  const { token } = await signConfirmToken({ userId: 'u1', tool: 'cancel_trip', input: { bookingId: 'b1' } }, SECRET);
  const result = await verifyConfirmToken(token, 'a-different-secret');
  assertEquals(result.ok, false);
});

Deno.test('an expired token is rejected with reason "expired"', async () => {
  const { token } = await signConfirmToken({ userId: 'u1', tool: 'cancel_trip', input: {}, ttlSeconds: -5 }, SECRET);
  const result = await verifyConfirmToken(token, SECRET);
  assertEquals(result, { ok: false, reason: 'expired' });
});

Deno.test('a confirm token TTL is capped at 5 minutes even if a longer one is requested', async () => {
  const { exp } = await signConfirmToken({ userId: 'u1', tool: 'cancel_trip', input: {}, ttlSeconds: 3600 }, SECRET);
  const maxExp = Math.floor(Date.now() / 1000) + 5 * 60 + 2; // +2s slack for test execution time
  assert(exp <= maxExp);
});
