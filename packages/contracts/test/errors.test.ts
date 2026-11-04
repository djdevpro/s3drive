import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  apiErrorSchema,
  httpStatusForError,
  isApiError,
  isErrorCode,
  type ErrorCode,
} from '../src/errors.js';

// Table des statuts HTTP, recopiée telle quelle pour détecter toute dérive.
const SPEC_TABLE: Record<number, ErrorCode[]> = {
  400: ['validation', 'invalid_request', 'checksum_mismatch'],
  401: ['unauthorized', 'share_password_required', 'share_otp_required'],
  403: ['forbidden', 'csrf', 'access_denied', 'endpoint_not_allowed', 'scope_denied', 'quota_exceeded'],
  404: ['not_found', 'bucket_not_found', 'key_not_found', 'version_not_found'],
  409: [
    'already_exists',
    'bucket_not_empty',
    'conflict',
    'wrong_region',
    'acl_not_supported',
    'invalid_object_state',
    'cors_missing',
    'delegation_required',
  ],
  410: ['share_expired', 'share_revoked', 'share_limit_reached'],
  412: ['precondition_failed'],
  413: ['entity_too_large'],
  423: ['object_locked'],
  429: ['rate_limited'],
  500: ['internal'],
  501: ['not_implemented'],
  502: ['upstream_error', 'endpoint_unreachable', 'tls_error', 'invalid_credentials', 'signature_mismatch', 'token_expired'],
  503: ['slow_down', 'clock_skew', 'share_suspended'],
};

describe('error codes', () => {
  it('has 42 unique codes', () => {
    expect(ERROR_CODES).toHaveLength(42);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('maps every code to exactly its HTTP status', () => {
    const fromSpec = Object.entries(SPEC_TABLE).flatMap(([status, codes]) =>
      codes.map((code) => [code, Number(status)] as const),
    );
    expect(fromSpec).toHaveLength(ERROR_CODES.length);
    for (const [code, status] of fromSpec) expect(ERROR_HTTP_STATUS[code]).toBe(status);
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('returns 400 for provider credential errors at /auth/connect only', () => {
    for (const code of ['invalid_credentials', 'signature_mismatch', 'token_expired'] as const) {
      expect(httpStatusForError(code, { atConnect: true })).toBe(400);
      expect(httpStatusForError(code)).toBe(502);
    }
    expect(httpStatusForError('forbidden', { atConnect: true })).toBe(403);
  });

  it('recognises codes', () => {
    expect(isErrorCode('csrf')).toBe(true);
    expect(isErrorCode('gate_expired')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe('error envelope', () => {
  it('accepts a full envelope and keeps extra details', () => {
    const body = {
      error: 'invalid_credentials',
      message: 'Delegation credentials rejected',
      details: { reason: 'delegation_broken', retryable: false, delegation: true, action: 'reconnect_in_web_app' },
      s3: { code: 'InvalidAccessKeyId', requestId: 'ABC123' },
    };
    const parsed = apiErrorSchema.parse(body);
    expect(parsed.details).toMatchObject({ reason: 'delegation_broken', delegation: true });
    expect(isApiError(body)).toBe(true);
  });

  it('accepts a minimal envelope', () => {
    expect(isApiError({ error: 'not_found', message: 'Not found' })).toBe(true);
  });

  it('rejects unknown codes and malformed details', () => {
    expect(isApiError({ error: 'teapot', message: 'x' })).toBe(false);
    expect(isApiError({ error: 'validation' })).toBe(false);
    expect(isApiError({ error: 'rate_limited', message: 'x', details: { retryAfter: -1 } })).toBe(false);
    expect(isApiError({ error: 'quota_exceeded', message: 'x', details: { attemptsLeft: 1.5 } })).toBe(false);
    expect(isApiError({ error: 'internal', message: 'x', s3: { requestId: 'r' } })).toBe(false);
    expect(isApiError('unauthorized')).toBe(false);
  });
});
