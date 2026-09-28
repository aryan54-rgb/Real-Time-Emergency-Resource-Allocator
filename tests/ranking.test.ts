import { describe, expect, it } from 'vitest';
import { estimateEtaMin, haversineKm, rankHospitals } from '@/lib/ranking';
import type { Hospital, Resource } from '@/lib/types';

const now = new Date('2026-01-01T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();
const res = (type: Resource['type'], available: number, ageMin = 0): Resource =>
  ({ type, total: 10, available, updated_at: ago(ageMin) });
const hosp = (id: string, lat: number, lng: number, resources: Resource[]): Hospital =>
  ({ id, name: id, address: '', lat, lng, resources });

const patient = { lat: 18.6, lng: 73.8 };

describe('geo helpers', () => {
  it('haversine is ~111 km per degree of latitude', () => {
    expect(haversineKm(18, 73, 19, 73)).toBeCloseTo(111.2, 0);
  });
  it('ETA grows with distance', () => {
    expect(estimateEtaMin(10)).toBeGreaterThan(estimateEtaMin(5));
  });
});

describe('rankHospitals', () => {
  it('prefers a nearer hospital when everything else is equal', () => {
    const near = hosp('near', 18.605, 73.8, [res('icu_bed', 2)]);
    const far = hosp('far', 18.7, 73.8, [res('icu_bed', 2)]);
    expect(rankHospitals([far, near], { ...patient, needs: ['icu_bed'] }, now).map((r) => r.hospital.id))
      .toEqual(['near', 'far']);
  });

  it('never ranks a hospital missing a needed resource above one that has it', () => {
    const nearFull = hosp('nearFull', 18.601, 73.8, [res('icu_bed', 0)]);
    const farFree = hosp('farFree', 18.75, 73.8, [res('icu_bed', 1)]);
    const [first, second] = rankHospitals([nearFull, farFree], { ...patient, needs: ['icu_bed'] }, now);
    expect(first.hospital.id).toBe('farFree');
    expect(second.reservable).toBe(false);
    expect(second.missing).toEqual(['icu_bed']);
  });

  it('partial matches score by the share of needs available', () => {
    const h = hosp('h', 18.6, 73.8, [res('icu_bed', 1), res('ventilator', 0)]);
    const [r] = rankHospitals([h], { ...patient, needs: ['icu_bed', 'ventilator'] }, now);
    expect(r.match).toBe(0.5);
    expect(r.reservable).toBe(false);
  });

  it('fresher data wins between otherwise identical hospitals, and old data is flagged stale', () => {
    const fresh = hosp('fresh', 18.61, 73.8, [res('icu_bed', 1, 1)]);
    const old = hosp('old', 18.61, 73.8, [res('icu_bed', 1, 90)]);
    const ranked = rankHospitals([old, fresh], { ...patient, needs: ['icu_bed'] }, now);
    expect(ranked[0].hospital.id).toBe('fresh');
    expect(ranked[1].stale).toBe(true);
    expect(ranked[1].freshness).toBeCloseTo(0.5 ** 6, 5);
  });

  it('excludes hospitals that already rejected the request from being reservable', () => {
    const a = hosp('a', 18.6, 73.8, [res('icu_bed', 3)]);
    const b = hosp('b', 18.7, 73.8, [res('icu_bed', 3)]);
    const ranked = rankHospitals([a, b], { ...patient, needs: ['icu_bed'], rejected_by: ['a'] }, now);
    expect(ranked[0].hospital.id).toBe('b');
    expect(ranked[1]).toMatchObject({ rejected: true, reservable: false });
  });

  it('scores stay within 0..1', () => {
    const h = hosp('h', 25, 80, [res('icu_bed', 1, 1000)]);
    const [r] = rankHospitals([h], { ...patient, needs: ['icu_bed'] }, now);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.travel).toBe(0);
  });
});
