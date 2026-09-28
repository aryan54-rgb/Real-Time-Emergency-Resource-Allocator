export const RESOURCE_TYPES = ['icu_bed', 'general_bed', 'ventilator', 'trauma_team', 'cardiac_unit'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  icu_bed: 'ICU bed',
  general_bed: 'General bed',
  ventilator: 'Ventilator',
  trauma_team: 'Trauma team',
  cardiac_unit: 'Cardiac unit',
};

export type Severity = 'critical' | 'serious' | 'stable';
export type RequestStatus = 'pending' | 'reserved' | 'accepted' | 'handed_over' | 'cancelled';

export interface Resource {
  type: ResourceType;
  total: number;
  available: number;
  updated_at: string;            // last confirmed by hospital staff (drives freshness)
  sim_changed_at: string | null; // last change made by the demo simulator, if any
  sim_delta: number | null;
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  resources: Resource[];
}

export interface EmergencyRequest {
  id: string;
  patient_label: string;
  severity: Severity;
  needs: ResourceType[];
  lat: number;
  lng: number;
  status: RequestStatus;
  hospital_id: string | null;
  rejected_by: string[];
  note: string;
  created_at: string;
  updated_at: string;
}

export interface LiveState {
  hospitals: Hospital[];
  requests: EmergencyRequest[];
  serverTime: string;
}
