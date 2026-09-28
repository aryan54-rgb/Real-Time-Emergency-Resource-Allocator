import type { Hospital, ResourceType } from './types';

// Weights and constants are MVP defaults, chosen for the demo — not clinically validated.
export const WEIGHTS = { match: 0.5, travel: 0.35, freshness: 0.15 };
export const MAX_USEFUL_ETA_MIN = 60;      // ETA at or beyond this scores 0 for travel
export const FRESHNESS_HALF_LIFE_MIN = 15; // data this old counts half as trustworthy
export const STALE_AFTER_MIN = 30;         // flagged as stale in the UI
const ROAD_FACTOR = 1.35;                  // straight line -> approximate road distance
const AVG_SPEED_KMH = 30;                  // assumed urban ambulance speed

export interface RankedHospital {
  hospital: Hospital;
  score: number;
  match: number;        // 0..1 share of needed resources currently available
  missing: ResourceType[];
  distanceKm: number;
  etaMin: number;       // ESTIMATE from straight-line distance, not live traffic
  travel: number;       // 0..1
  dataAgeMin: number;   // age of the OLDEST needed resource update
  freshness: number;    // 0..1
  stale: boolean;
  reservable: boolean;  // all needs available and hospital has not already rejected
  rejected: boolean;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function estimateEtaMin(distanceKm: number): number {
  return ((distanceKm * ROAD_FACTOR) / AVG_SPEED_KMH) * 60;
}

export function rankHospitals(
  hospitals: Hospital[],
  req: { lat: number; lng: number; needs: ResourceType[]; rejected_by?: string[] },
  now: Date = new Date(),
): RankedHospital[] {
  const needs = [...new Set(req.needs)];
  const rejectedBy = new Set(req.rejected_by ?? []);

  const ranked = hospitals.map((hospital) => {
    const byType = new Map(hospital.resources.map((r) => [r.type, r]));
    const missing = needs.filter((n) => (byType.get(n)?.available ?? 0) < 1);
    const match = needs.length ? (needs.length - missing.length) / needs.length : 0;

    const distanceKm = haversineKm(req.lat, req.lng, hospital.lat, hospital.lng);
    const etaMin = estimateEtaMin(distanceKm);
    const travel = Math.max(0, 1 - etaMin / MAX_USEFUL_ETA_MIN);

    const ages = needs.map((n) => {
      const r = byType.get(n);
      return r ? (now.getTime() - new Date(r.updated_at).getTime()) / 60000 : Infinity;
    });
    const dataAgeMin = Math.max(0, ...ages);
    const freshness = Number.isFinite(dataAgeMin) ? Math.pow(0.5, dataAgeMin / FRESHNESS_HALF_LIFE_MIN) : 0;

    const rejected = rejectedBy.has(hospital.id);
    const score = WEIGHTS.match * match + WEIGHTS.travel * travel + WEIGHTS.freshness * freshness;
    return {
      hospital, score, match, missing, distanceKm, etaMin, travel, dataAgeMin, freshness,
      stale: dataAgeMin > STALE_AFTER_MIN,
      reservable: missing.length === 0 && !rejected,
      rejected,
    };
  });

  // Reservable hospitals always come first; within each group, highest score first.
  return ranked.sort((a, b) => Number(b.reservable) - Number(a.reservable) || b.score - a.score);
}
