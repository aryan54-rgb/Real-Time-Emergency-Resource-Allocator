'use client';
import 'leaflet/dist/leaflet.css';
import { Fragment } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMapEvents } from 'react-leaflet';
import type { EmergencyRequest, Hospital } from '@/lib/types';

export interface MapViewProps {
  hospitals: Hospital[];
  requests: EmergencyRequest[];
  selectedRequestId?: string | null;
  draft?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  onSelectRequest?: (id: string) => void;
}

function ClickHandler({ onPick }: { onPick?: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

const icuColor = (h: Hospital) => {
  const icu = h.resources.find((r) => r.type === 'icu_bed');
  if (!icu || icu.available === 0) return '#a31111';
  return icu.available === 1 ? '#c77c0e' : '#2e7d5b';
};

export default function MapView({ hospitals, requests, selectedRequestId, draft, onPick, onSelectRequest }: MapViewProps) {
  const active = requests.filter((r) => r.status !== 'cancelled' && r.status !== 'handed_over');
  const byId = new Map(hospitals.map((h) => [h.id, h]));
  return (
    <MapContainer center={[18.62, 73.785]} zoom={12} className="map" scrollWheelZoom>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClickHandler onPick={onPick} />
      {hospitals.map((h) => {
        const icu = h.resources.find((r) => r.type === 'icu_bed');
        return (
          <CircleMarker key={h.id} center={[h.lat, h.lng]} radius={11}
            pathOptions={{ color: '#fff', weight: 2, fillColor: icuColor(h), fillOpacity: 0.95 }}>
            <Tooltip direction="right" offset={[10, 0]} permanent className="map-label">
              {h.id} · ICU {icu?.available ?? 0}/{icu?.total ?? 0}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {active.map((r) => {
        const h = r.hospital_id ? byId.get(r.hospital_id) : undefined;
        const selected = r.id === selectedRequestId;
        return (
          <Fragment key={r.id}>
            {h && <Polyline positions={[[r.lat, r.lng], [h.lat, h.lng]]}
              pathOptions={{ color: r.status === 'accepted' ? '#2e7d5b' : '#c77c0e', dashArray: r.status === 'reserved' ? '6 6' : undefined, weight: 3 }} />}
            <CircleMarker center={[r.lat, r.lng]} radius={selected ? 9 : 7}
              eventHandlers={{ click: () => onSelectRequest?.(r.id) }}
              pathOptions={{ color: selected ? '#111' : '#fff', weight: 2, fillColor: '#1f262a', fillOpacity: 0.9 }}>
              <Tooltip>{r.patient_label} · {r.status}</Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}
      {draft && (
        <CircleMarker center={[draft.lat, draft.lng]} radius={8}
          pathOptions={{ color: '#1f262a', weight: 2, dashArray: '3 3', fillColor: '#fff', fillOpacity: 1 }}>
          <Tooltip permanent direction="right">New case</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
