import { afterAll, describe, expect, it } from 'vitest';
import { createS3, detectProvider, PROVIDER_PRESETS, S3Error } from '../src/index.js';

// Présignature locale : aucun appel réseau.
const credentials = { accessKeyId: 'AKIDEXAMPLE1234567890', secretAccessKey: 'wJalrXUtnFEMI-example-secret', sessionToken: 'session-token-example' };

describe('présignature', () => {
  const s3 = createS3({ endpoint: 'https://s3.eu-central-1.amazonaws.com', region: 'eu-central-1', addressing: 'virtual', credentials });
  afterAll(() => s3.destroy());

  it('PUT : content-length et content-type signés et renvoyés', async () => {
    const signed = await s3.presignPut({ bucket: 'my-bucket', key: 'a b/é.txt', expiresIn: 900, contentLength: 42, contentType: 'text/plain' });
    const url = new URL(signed.url);
    expect(url.host).toBe('my-bucket.s3.eu-central-1.amazonaws.com');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('session-token-example');
    expect(signed.headers).toEqual({ 'content-length': '42', 'content-type': 'text/plain' });
    expect(signed.url).not.toContain(credentials.secretAccessKey);
    expect(signed.url).not.toContain('x-amz-checksum');
    expect(Date.parse(signed.expiresAt!) - Date.now()).toBeGreaterThan(890_000);
  });

  it('UploadPart : content-length signé, sans content-type', async () => {
    const signed = await s3.presignPart({ bucket: 'my-bucket', key: 'k', uploadId: 'U1', partNumber: 3, contentLength: 5_242_880, expiresIn: 3600 });
    const url = new URL(signed.url);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host');
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('uploadId')).toBe('U1');
    expect(signed.headers).toEqual({ 'content-length': '5242880' });
  });

  it('GET : réponse forcée et version', async () => {
    const signed = await s3.presignGet({
      bucket: 'my-bucket',
      key: 'doc.pdf',
      versionId: 'v1',
      expiresIn: 60,
      disposition: 'inline',
      filename: 'doc.pdf',
      contentType: 'application/pdf',
    });
    const url = new URL(signed.url);
    expect(url.searchParams.get('response-content-disposition')).toBe('inline; filename="doc.pdf"');
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(url.searchParams.get('versionId')).toBe('v1');
    expect(signed.headers).toEqual({});
  });

  it('bucket à point : adressage par chemin', async () => {
    const signed = await s3.presignGet({ bucket: 'my.dotted.bucket', key: 'k', expiresIn: 60 });
    const url = new URL(signed.url);
    expect(url.host).toBe('s3.eu-central-1.amazonaws.com');
    expect(url.pathname).toBe('/my.dotted.bucket/k');
  });

  it('validations avant signature', async () => {
    const expectCode = async (promise: Promise<unknown>, code: string, reason: string) => {
      const error = (await promise.catch((e: unknown) => e)) as S3Error;
      expect(error).toBeInstanceOf(S3Error);
      expect(error.code).toBe(code);
      expect(error.reason).toBe(reason);
    };
    await expectCode(s3.presignPut({ bucket: 'b', key: 'k', expiresIn: 60, contentLength: -1 }), 'validation', 'size_invalid');
    await expectCode(s3.presignPut({ bucket: 'b', key: 'k', expiresIn: 60, contentLength: 6 * 1024 ** 3 }), 'entity_too_large', 'provider_max');
    await expectCode(s3.presignPart({ bucket: 'b', key: 'k', uploadId: 'u', partNumber: 0, contentLength: 1, expiresIn: 60 }), 'validation', 'part_number');
    await expectCode(s3.presignGet({ bucket: 'b', key: '', expiresIn: 60 }), 'validation', 'key_empty');
    await expectCode(s3.presignGet({ bucket: 'b', key: 'x'.repeat(1025), expiresIn: 60 }), 'validation', 'key_too_long');
    await expectCode(s3.presignGet({ bucket: 'b', key: 'k', expiresIn: 1.5 }), 'validation', 'expires_out_of_range');
  });
});

describe('préréglages fournisseurs', () => {
  it('détection par l’hôte', () => {
    expect(detectProvider('https://s3.eu-west-1.amazonaws.com').id).toBe('aws');
    expect(detectProvider('https://fsn1.your-objectstorage.com').id).toBe('hetzner');
    expect(detectProvider('https://abc.r2.cloudflarestorage.com').id).toBe('r2');
    expect(detectProvider('http://127.0.0.1:9000').id).toBe('generic');
  });

  it('adressage et région par préréglage', () => {
    expect(PROVIDER_PRESETS.aws.defaultAddressing).toBe('virtual');
    expect(PROVIDER_PRESETS.hetzner.defaultAddressing).toBe('virtual');
    expect(PROVIDER_PRESETS.r2.defaultRegion).toBe('auto');
    expect(PROVIDER_PRESETS.rustfs.defaultAddressing).toBe('path');
    expect(PROVIDER_PRESETS.generic.quirks).toEqual([]);
  });
});
