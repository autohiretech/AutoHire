// AutoHire — ai-agent confirm-token guard.
//
// `money` and `destructive` tools never run on the request that first asks
// for them. Instead the loop signs a short-lived HMAC token binding exactly
// {caller, tool, canonical input}; the client shows the renter/host a
// confirmation and, if they accept, resends the same message with
// `confirmToken` set. `verifyConfirmToken` checks the signature, the expiry,
// and that the token still names the same tool + input the caller is now
// asking to run — a token minted for `cancel_trip({bookingId:"a"})` can't be
// replayed against `cancel_trip({bookingId:"b"})` or any other tool.
//
// Replay (the same token used twice) is NOT handled here — signature +
// expiry alone can't detect reuse, since a valid token is valid every time
// you check it. That's `TokenLedger` in loop.ts: a one-time-use record kept
// per `jti`, backed by `ai_turns.confirm_jti` in production (see the
// migration) and an in-memory Set in tests.

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Deterministic JSON — sorted keys — so the same logical input always hashes/signs the same way regardless of property order. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sort((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export interface ConfirmClaims {
  /** The caller this token is good for — a token minted for one user can never be redeemed by another. */
  sub: string;
  tool: string;
  /** Canonical JSON of the exact input this token authorizes. */
  input: string;
  /** Random, single-use id — what TokenLedger tracks to refuse a replay. */
  jti: string;
  /** Unix seconds. */
  exp: number;
}

const DEFAULT_TTL_SECONDS = 5 * 60; // "expiry ≤ 5 min" per spec

export async function signConfirmToken(
  params: { userId: string; tool: string; input: unknown; ttlSeconds?: number },
  secret: string,
): Promise<{ token: string; jti: string; exp: number }> {
  const jti = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + Math.min(params.ttlSeconds ?? DEFAULT_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const claims: ConfirmClaims = {
    sub: params.userId,
    tool: params.tool,
    input: canonicalJson(params.input),
    jti,
    exp,
  };
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  const token = `${payload}.${base64url(new Uint8Array(sig))}`;
  return { token, jti, exp };
}

/**
 * Returns the verified claims, or a string reason it's rejected
 * (`'invalid' | 'expired'`) — never throws, so a malformed/tampered token
 * from a client is just another rejection reason, not a 500.
 */
export async function verifyConfirmToken(
  token: string,
  secret: string,
): Promise<{ ok: true; claims: ConfirmClaims } | { ok: false; reason: 'invalid' | 'expired' }> {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'invalid' };
  const [payload, sig] = parts;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64urlToBytes(sig) as BufferSource,
      encoder.encode(payload),
    );
    if (!valid) return { ok: false, reason: 'invalid' };
    const claims = JSON.parse(new TextDecoder().decode(base64urlToBytes(payload))) as ConfirmClaims;
    if (
      typeof claims.sub !== 'string' || typeof claims.tool !== 'string' ||
      typeof claims.input !== 'string' || typeof claims.jti !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      return { ok: false, reason: 'invalid' };
    }
    if (claims.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Does this verified token actually authorize running `tool` with `input`, for `userId`? */
export function tokenAuthorizes(
  claims: ConfirmClaims,
  params: { userId: string; tool: string; input: unknown },
): boolean {
  return (
    claims.sub === params.userId &&
    claims.tool === params.tool &&
    claims.input === canonicalJson(params.input)
  );
}

/** One-time-use ledger for confirm-token `jti`s. See the file comment for why this exists separately from verification. */
export interface TokenLedger {
  wasConsumed(jti: string): Promise<boolean>;
  consume(jti: string): Promise<void>;
}

/** Test/dev ledger — process-local, gone on restart. Production uses `SupabaseTokenLedger` in index.ts, backed by `ai_turns.confirm_jti`. */
export class InMemoryTokenLedger implements TokenLedger {
  private used = new Set<string>();
  wasConsumed(jti: string): Promise<boolean> {
    return Promise.resolve(this.used.has(jti));
  }
  consume(jti: string): Promise<void> {
    this.used.add(jti);
    return Promise.resolve();
  }
}
