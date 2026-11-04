import { describe, expect, it } from 'vitest';
import { ERROR_HTTP_STATUS, isApiError } from '@ud/contracts';
import { S3Error, parseRetryAfter, sanitizeText, toS3Error } from '../src/index.js';

/** Fabrique une exception à la forme du SDK v3. */
function sdkError(name: string, status: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error((extra.message as string) ?? `${name} message`), {
    name,
    $fault: status >= 500 ? 'server' : 'client',
    $metadata: { httpStatusCode: status, requestId: 'REQ123' },
    ...extra,
  });
}

describe('toS3Error — table de l’annexe B', () => {
  const cases: Array<[string, number, string, string | undefined]> = [
    ['NoSuchKey', 404, 'key_not_found', undefined],
    ['NoSuchBucket', 404, 'bucket_not_found', undefined],
    ['NoSuchVersion', 404, 'version_not_found', undefined],
    ['NoSuchUpload', 404, 'not_found', 'upload_gone'],
    ['AccessDenied', 403, 'access_denied', 'iam'],
    ['InvalidAccessKeyId', 403, 'invalid_credentials', 'access_key'],
    ['SignatureDoesNotMatch', 403, 'signature_mismatch', 'secret'],
    ['RequestTimeTooSkewed', 403, 'clock_skew', 'skew_too_large'],
    ['ExpiredToken', 400, 'token_expired', 'session_token_expired'],
    ['AuthorizationHeaderMalformed', 400, 'wrong_region', 'authorization_header'],
    ['PermanentRedirect', 301, 'wrong_region', 'permanent_redirect'],
    ['BucketAlreadyExists', 409, 'already_exists', 'global_name'],
    ['BucketNotEmpty', 409, 'bucket_not_empty', undefined],
    ['EntityTooLarge', 400, 'entity_too_large', 'provider_max'],
    ['EntityTooSmall', 400, 'invalid_request', 'part_too_small'],
    ['InvalidPart', 400, 'invalid_request', 'parts_mismatch'],
    ['PreconditionFailed', 412, 'precondition_failed', 'etag_mismatch'],
    ['SlowDown', 503, 'slow_down', 'provider_throttled'],
    ['InternalError', 500, 'upstream_error', 'provider_error'],
    ['BadDigest', 400, 'checksum_mismatch', 'bad_digest'],
    ['NotImplemented', 501, 'not_implemented', 'provider'],
    ['InvalidObjectState', 403, 'invalid_object_state', 'archived'],
    ['AccessControlListNotSupported', 400, 'acl_not_supported', 'ownership_enforced'],
    ['InvalidArgument', 400, 'validation', 'argument'],
    ['MalformedXML', 400, 'validation', 'xml'],
    ['QuotaExceeded', 403, 'quota_exceeded', 'provider_quota'],
    ['XMinioStorageFull', 507, 'quota_exceeded', 'storage_full'],
    ['OperationAborted', 409, 'conflict', 'operation_aborted'],
    ['SomethingNobodyKnows', 400, 'upstream_error', 'unknown_code'],
  ];

  it.each(cases)('%s (%i) → %s', (name, status, code, reason) => {
    const error = toS3Error(sdkError(name, status));
    expect(error).toBeInstanceOf(S3Error);
    expect(error.code).toBe(code);
    expect(error.status).toBe(ERROR_HTTP_STATUS[error.code]);
    expect(error.reason).toBe(reason);
    expect(error.s3).toEqual({ code: name, requestId: 'REQ123' });
  });

  it('HEAD sans corps : correspondance par statut et par opération', () => {
    expect(toS3Error(sdkError('NotFound', 404), { operation: 'HeadObject' }).code).toBe('key_not_found');
    expect(toS3Error(sdkError('NotFound', 404), { operation: 'HeadObject', versionId: true }).code).toBe('version_not_found');
    expect(toS3Error(sdkError('NotFound', 404), { operation: 'HeadBucket' }).code).toBe('bucket_not_found');
    expect(toS3Error(sdkError('Forbidden', 403), { operation: 'HeadBucket' }).code).toBe('access_denied');
    const deleteMarker = sdkError('MethodNotAllowed', 405, { $response: { statusCode: 405, headers: { 'x-amz-delete-marker': 'true' } } });
    const mapped = toS3Error(deleteMarker, { operation: 'HeadObject' });
    expect(mapped.code).toBe('key_not_found');
    expect(mapped.reason).toBe('delete_marker');
  });

  it('affine par message et contexte', () => {
    expect(toS3Error(sdkError('AccessDenied', 403, { message: 'Request has expired' })).reason).toBe('presign_expired');
    expect(toS3Error(sdkError('AccessDenied', 403, { message: 'Request is not yet valid' })).code).toBe('clock_skew');
    expect(toS3Error(sdkError('PreconditionFailed', 412), { ifNoneMatch: true }).code).toBe('already_exists');
    expect(toS3Error(sdkError('ConditionalRequestConflict', 409), { operation: 'CompleteMultipartUpload' }).reason).toBe('restart_required');
    expect(toS3Error(sdkError('InvalidArgument', 400, { message: "Unsupported header 'x-amz-checksum-crc32'" })).reason).toBe(
      'checksum_unsupported',
    );
  });

  it('rejouable : SlowDown oui, AccessDenied non, Retry-After lu', () => {
    const slow = toS3Error(sdkError('SlowDown', 503, { $response: { statusCode: 503, headers: { 'retry-after': '7' } } }));
    expect(slow.retryable).toBe(true);
    expect(slow.details.retryable).toBe(true);
    expect(slow.details.retryAfter).toBe(7);
    const denied = toS3Error(sdkError('AccessDenied', 403));
    expect(denied.retryable).toBe(false);
    expect(denied.details.retryable).toBe(false);
  });

  it('statut seul quand le code manque', () => {
    expect(toS3Error(sdkError('Unknown', 503)).code).toBe('slow_down');
    expect(toS3Error(sdkError('Unknown', 502)).code).toBe('upstream_error');
    expect(toS3Error(sdkError('Unknown', 200, { message: 'Deserialization error: char < not expected' })).reason).toBe('not_s3');
  });

  it('erreurs réseau et TLS', () => {
    const net = (code: string) => Object.assign(new Error(`connect ${code}`), { code });
    expect(toS3Error(net('ECONNREFUSED'))).toMatchObject({ code: 'endpoint_unreachable', retryable: false });
    expect(toS3Error(net('ECONNREFUSED')).reason).toBe('refused');
    expect(toS3Error(net('ENOTFOUND')).reason).toBe('dns');
    expect(toS3Error(net('ECONNRESET')).retryable).toBe(true);
    expect(toS3Error(net('CERT_HAS_EXPIRED'))).toMatchObject({ code: 'tls_error' });
    expect(toS3Error(net('ERR_TLS_CERT_ALTNAME_INVALID')).reason).toBe('hostname_mismatch');
    expect(toS3Error(net('ERR_SSL_WRONG_VERSION_NUMBER')).code).toBe('tls_error');
    expect(toS3Error(Object.assign(new Error('x'), { name: 'TimeoutError' })).reason).toBe('timeout');
    const nested = Object.assign(new Error('fetch failed'), { cause: net('EAI_AGAIN') });
    expect(toS3Error(nested).reason).toBe('dns');
  });

  it('une S3Error passe telle quelle ; une erreur quelconque devient internal', () => {
    const original = new S3Error({ code: 'endpoint_not_allowed', reason: 'private_address' });
    expect(toS3Error(original)).toBe(original);
    expect(toS3Error('boom').code).toBe('internal');
    expect(toS3Error(new TypeError('bad')).code).toBe('internal');
  });

  it('aucun secret, signature ni URL dans le message ou la cause', () => {
    const leaky = sdkError('SignatureDoesNotMatch', 403, {
      message:
        'Bad signature for https://b.s3.amazonaws.com/k?X-Amz-Credential=AKIAABCDEFGHIJKLMNOP%2F20261103&X-Amz-Signature=deadbeef ' +
        'secret=Sup3rS3cretValue Authorization: AWS4-HMAC-SHA256 Credential=AKIAABCDEFGHIJKLMNOP',
      StringToSign: 'AWS4-HMAC-SHA256\n…',
      SignatureProvided: 'deadbeef',
    });
    const mapped = toS3Error(leaky, { secrets: ['Sup3rS3cretValue'] });
    const serialized = JSON.stringify(mapped.toApiError()) + mapped.message;
    for (const needle of ['AKIAABCDEFGHIJKLMNOP', 'deadbeef', 'X-Amz-Signature', 'X-Amz-Credential', 'Sup3rS3cretValue', 'https://', 'StringToSign']) {
      expect(serialized).not.toContain(needle);
    }
    expect(isApiError(mapped.toApiError())).toBe(true);
  });

  it('sanitizeText tronque à 500 caractères', () => {
    expect(sanitizeText('a'.repeat(900)).length).toBeLessThanOrEqual(500);
  });

  it('parseRetryAfter : secondes, date HTTP, borne de 60 s', () => {
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter('3600')).toBe(60);
    const now = Date.parse('2026-11-03T10:00:00Z');
    expect(parseRetryAfter('Tue, 03 Nov 2026 10:00:10 GMT', now)).toBe(10);
    expect(parseRetryAfter('n/a')).toBeUndefined();
  });
});
