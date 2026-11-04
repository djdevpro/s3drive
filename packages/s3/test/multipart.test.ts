import { describe, expect, it } from 'vitest';
import { MULTIPART, PART_SIZE_PREFERENCE, S3Error, planParts } from '../src/index.js';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const TIB = 1024 * GIB;

describe('MULTIPART et planParts', () => {
  it('expose les bornes S3', () => {
    expect(MULTIPART.minPartSize).toBe(5 * MIB);
    expect(MULTIPART.maxPartSize).toBe(5 * GIB);
    expect(MULTIPART.maxParts).toBe(10_000);
  });

  it('petits fichiers : préférence navigateur de 8 Mio', () => {
    expect(MULTIPART.choosePartSize(0)).toBe(8 * MIB);
    expect(MULTIPART.choosePartSize(5 * MIB)).toBe(8 * MIB);
    expect(MULTIPART.choosePartSize(100 * MIB)).toBe(8 * MIB);
    expect(planParts(100 * MIB)).toEqual({ partSize: 8 * MIB, partCount: 13 });
  });

  it('grands fichiers : au plus 10 000 parties, arrondi au Mio', () => {
    const size = Math.floor(4.9 * TIB);
    const partSize = MULTIPART.choosePartSize(size);
    expect(partSize % MIB).toBe(0);
    expect(Math.ceil(size / partSize)).toBeLessThanOrEqual(10_000);
    expect(partSize).toBeGreaterThanOrEqual(5 * MIB);
  });

  it('50 To (AWS) : parties ≤ 5 Gio, ≤ 10 000 parties', () => {
    const plan = planParts(50 * 1_000_000_000_000);
    expect(plan.partSize).toBeLessThanOrEqual(5 * GIB);
    expect(plan.partCount).toBeLessThanOrEqual(10_000);
  });

  it('au-delà de 10 000 × 5 Gio : entity_too_large', () => {
    expect(() => planParts(10_000 * 5 * GIB + 1)).toThrow(S3Error);
    try {
      planParts(10_000 * 5 * GIB + 1);
    } catch (error) {
      expect((error as S3Error).code).toBe('entity_too_large');
    }
  });

  it('préférence de copie et bornes du profil', () => {
    expect(planParts(10 * GIB, PART_SIZE_PREFERENCE.copy).partSize).toBe(512 * MIB);
    expect(planParts(10 * MIB, 1).partSize).toBe(5 * MIB);
  });

  it('taille invalide : validation', () => {
    expect(() => planParts(-1)).toThrow(S3Error);
    expect(() => planParts(1.5)).toThrow(S3Error);
  });
});
