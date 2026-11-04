import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import {
  S3Error,
  classifyAddress,
  classifyHostname,
  createPinnedLookup,
  createS3,
  isAddressAllowed,
  parseAllowedEndpoints,
  validateEndpoint,
  type NetguardOptions,
} from '../src/index.js';

function refusal(endpoint: string, options: NetguardOptions = {}): S3Error {
  try {
    validateEndpoint(endpoint, options);
  } catch (error) {
    return error as S3Error;
  }
  throw new Error(`endpoint accepted: ${endpoint}`);
}

describe('classification des adresses (01 Annexe B)', () => {
  const blocked: Array<[string, 'private_address' | 'metadata_address', boolean]> = [
    ['10.1.2.3', 'private_address', true],
    ['172.16.0.1', 'private_address', true],
    ['192.168.1.1', 'private_address', true],
    ['127.0.0.1', 'private_address', true],
    ['100.64.0.1', 'private_address', true],
    ['0.0.0.0', 'private_address', false],
    ['169.254.169.254', 'metadata_address', false],
    ['169.254.170.23', 'metadata_address', false],
    ['100.100.100.200', 'metadata_address', false],
    ['168.63.129.16', 'metadata_address', false],
    ['192.0.2.1', 'private_address', false],
    ['198.18.0.1', 'private_address', false],
    ['224.0.0.1', 'private_address', false],
    ['255.255.255.255', 'private_address', false],
    ['::1', 'private_address', true],
    ['::', 'private_address', false],
    ['fe80::1', 'metadata_address', false],
    ['fc00::1', 'private_address', true],
    ['fd12:3456::1', 'private_address', true],
    ['fd00:ec2::254', 'metadata_address', false],
    ['fd00:ec2::23', 'metadata_address', false],
    ['fd20:ce::254', 'metadata_address', false],
    ['fd00:a9fe:a9fe::1', 'metadata_address', false],
    ['::ffff:169.254.169.254', 'metadata_address', false],
    ['::ffff:10.0.0.1', 'private_address', true],
    ['2002:a9fe:a9fe::', 'metadata_address', false],
    ['64:ff9b::808:808', 'private_address', false],
    ['2001:db8::1', 'private_address', false],
    ['ff02::1', 'private_address', false],
    ['5f00::1', 'private_address', false],
    ['4000::1', 'private_address', false],
  ];

  it.each(blocked)('%s refusée (%s, levable : %s)', (address, reason, liftable) => {
    expect(classifyAddress(address)).toEqual({ allowed: false, reason, liftable });
  });

  it.each(['8.8.8.8', '1.1.1.1', '2a01:4f8::1', '2606:4700::1111', '::ffff:8.8.8.8', '2002:808:808::'])('%s acceptée', (address) => {
    expect(classifyAddress(address)).toEqual({ allowed: true });
  });

  it('allowPrivate lève les privées, jamais le lien local ni les métadonnées', () => {
    expect(isAddressAllowed('10.0.0.1', true).allowed).toBe(true);
    expect(isAddressAllowed('127.0.0.1', true).allowed).toBe(true);
    expect(isAddressAllowed('169.254.169.254', true).allowed).toBe(false);
    expect(isAddressAllowed('fd00:ec2::254', true).allowed).toBe(false);
    expect(isAddressAllowed('0.0.0.0', true).allowed).toBe(false);
  });

  it('noms locaux et de métadonnées', () => {
    expect(classifyHostname('localhost')).toBe('local');
    expect(classifyHostname('s3')).toBe('local');
    expect(classifyHostname('nas.local')).toBe('local');
    expect(classifyHostname('x.internal')).toBe('local');
    expect(classifyHostname('metadata.google.internal')).toBe('metadata');
    expect(classifyHostname('metadata.goog')).toBe('metadata');
    expect(classifyHostname('fsn1.your-objectstorage.com')).toBe('public');
  });
});

describe('validateEndpoint', () => {
  it('accepte un point de terminaison public en https et normalise l’origine', () => {
    const guarded = validateEndpoint('https://FSN1.your-objectstorage.com:443/');
    expect(guarded.origin).toBe('https://fsn1.your-objectstorage.com');
    expect(guarded.privateAllowed).toBe(false);
  });

  it('formes invalides : validation', () => {
    for (const [endpoint, reason] of [
      ['not a url', 'endpoint_invalid'],
      ['https://user:pass@s3.example.com', 'endpoint_credentials'],
      ['https://s3.example.com/?a=1', 'endpoint_query'],
      ['https://s3.example.com/path', 'endpoint_path'],
    ] as const) {
      const error = refusal(endpoint);
      expect(error.code).toBe('validation');
      expect(error.reason).toBe(reason);
    }
  });

  it('formes numériques normalisées puis refusées', () => {
    for (const endpoint of ['https://2130706433/', 'https://0x7f.1/', 'https://127.1/', 'https://0177.0.0.1/']) {
      expect(refusal(endpoint).reason).toBe('private_address');
    }
    expect(refusal('https://[::ffff:169.254.169.254]/').reason).toBe('metadata_address');
    expect(refusal('https://169.254.169.254/', { allowPrivate: true }).reason).toBe('metadata_address');
    expect(refusal('https://metadata.google.internal/', { allowPrivate: true }).reason).toBe('metadata_address');
    expect(refusal('https://localhost/').reason).toBe('private_address');
  });

  it('ports refusés, autres ports permis', () => {
    expect(refusal('https://s3.example.com:22').reason).toBe('port');
    expect(refusal('https://s3.example.com:6667').reason).toBe('port');
    expect(validateEndpoint('https://s3.example.com:9000').port).toBe(9000);
  });

  it('http : seulement avec allowPrivate vers un hôte privé', () => {
    expect(refusal('http://s3.example.com').reason).toBe('insecure_scheme');
    expect(refusal('http://127.0.0.1:9000').code).toBe('endpoint_not_allowed');
    expect(refusal('http://8.8.8.8', { allowPrivate: true }).reason).toBe('insecure_scheme');
    expect(validateEndpoint('http://127.0.0.1:9000', { allowPrivate: true }).origin).toBe('http://127.0.0.1:9000');
    expect(validateEndpoint('http://s3:9000', { allowPrivate: true }).host).toBe('s3');
    expect(refusal('ftp://s3.example.com').reason).toBe('insecure_scheme');
  });

  it('liste blanche UD_ALLOWED_ENDPOINTS', () => {
    const allowedEndpoints = parseAllowedEndpoints(' *.your-objectstorage.com , http://minio.lan:9000 ,https://10.0.0.5');
    expect(allowedEndpoints).toHaveLength(3);
    expect(validateEndpoint('https://fsn1.your-objectstorage.com', { allowedEndpoints }).host).toBe('fsn1.your-objectstorage.com');
    expect(refusal('https://s3.amazonaws.com', { allowedEndpoints }).reason).toBe('instance');
    expect(refusal('https://your-objectstorage.com', { allowedEndpoints }).reason).toBe('instance');
    // Une entrée explicite autorise ses adresses privées et son http.
    const lan = validateEndpoint('http://minio.lan:9000', { allowedEndpoints });
    expect(lan.privateAllowed).toBe(true);
    expect(lan.explicitHttp).toBe(true);
    expect(validateEndpoint('https://10.0.0.5', { allowedEndpoints }).privateAllowed).toBe(true);
    expect(refusal('http://10.0.0.5', { allowedEndpoints }).reason).toBe('insecure_scheme');
    expect(refusal('https://minio.lan:9001', { allowedEndpoints }).reason).toBe('instance');
  });
});

describe('résolution épinglée', () => {
  type Resolver = (name: string, cb: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

  function resolveWith(answers: LookupAddress[][]): Resolver {
    let call = 0;
    return (_name, cb) => cb(null, answers[Math.min(call++, answers.length - 1)]!);
  }

  function run(lookup: ReturnType<typeof createPinnedLookup>, host: string, all = false) {
    return new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((resolve) => {
      lookup(host, { all }, (error, address) => resolve({ error, address }));
    });
  }

  const endpoint = validateEndpoint('https://s3.example.com');

  it('renvoie les adresses validées, y compris pour <bucket>.<hôte>', async () => {
    const lookup = createPinnedLookup({ endpoint, resolve: resolveWith([[{ address: '93.184.216.34', family: 4 }]]) });
    expect(await run(lookup, 'bucket.s3.example.com')).toEqual({ error: null, address: '93.184.216.34' });
    expect((await run(lookup, 's3.example.com', true)).address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('refuse un nom résolu à la fois en public et en privé', async () => {
    const lookup = createPinnedLookup({
      endpoint,
      resolve: resolveWith([[{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]]),
    });
    const { error } = await run(lookup, 's3.example.com');
    expect(error).toBeInstanceOf(S3Error);
    expect((error as unknown as S3Error).code).toBe('endpoint_not_allowed');
  });

  it('rebinding : la seconde résolution privée est refusée', async () => {
    const lookup = createPinnedLookup({
      endpoint,
      resolve: resolveWith([[{ address: '93.184.216.34', family: 4 }], [{ address: '169.254.170.23', family: 4 }]]),
    });
    expect((await run(lookup, 's3.example.com')).error).toBeNull();
    const second = await run(lookup, 's3.example.com');
    expect((second.error as unknown as S3Error).reason).toBe('metadata_address');
  });

  it('refuse un hôte étranger au point de terminaison', async () => {
    const lookup = createPinnedLookup({ endpoint, resolve: resolveWith([[{ address: '93.184.216.34', family: 4 }]]) });
    expect(((await run(lookup, 'evil.example.org')).error as unknown as S3Error).reason).toBe('instance');
  });

  it('http + allowPrivate : un nom résolu en public est refusé', async () => {
    const local = validateEndpoint('http://s3:9000', { allowPrivate: true });
    const lookup = createPinnedLookup({ endpoint: local, requirePrivate: true, resolve: resolveWith([[{ address: '8.8.8.8', family: 4 }]]) });
    expect(((await run(lookup, 's3')).error as unknown as S3Error).reason).toBe('insecure_scheme');
    const ok = createPinnedLookup({ endpoint: local, requirePrivate: true, resolve: resolveWith([[{ address: '172.18.0.2', family: 4 }]]) });
    expect((await run(ok, 's3')).error).toBeNull();
  });
});

describe('createS3 et netguard', () => {
  const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example' };

  it('lève endpoint_not_allowed à la création', () => {
    for (const endpoint of ['https://169.254.169.254', 'https://10.0.0.1', 'http://s3.example.com']) {
      expect(() => createS3({ endpoint, region: 'us-east-1', addressing: 'path', credentials })).toThrow(
        expect.objectContaining({ code: 'endpoint_not_allowed' }),
      );
    }
  });

  it('accepte le S3 local avec allowPrivate', () => {
    const s3 = createS3({ endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', addressing: 'path', credentials, allowPrivate: true });
    s3.destroy();
  });

  it('refuse des identifiants manquants', () => {
    expect(() =>
      createS3({ endpoint: 'https://s3.example.com', region: 'us-east-1', addressing: 'path', credentials: { accessKeyId: '', secretAccessKey: '' } }),
    ).toThrow(expect.objectContaining({ code: 'validation' }));
  });
});
