// Números do GET /api/stats, usados pelo painel admin e pelo slide de tracking.

import { adminGet } from './session.ts';

export interface Stats {
  totals: {
    units: number;
    scans: number;
    verified: number;
    registered: number;
    signups: number;
    sessions: number;
    with_unit: number;
  };
  funnel: { name: string; total: number; sessions: number }[];
  lots: { product_id: string; lot_id: string; units: number; scans: number }[];
  recentUnits: {
    product_id: string | null;
    lot_id: string | null;
    unit_id: string | null;
    status: string;
    scan_count: number;
    first_seen_at: string;
    last_seen_at: string;
  }[];
}

/** Jornada do consumidor, na ordem; conta sessões únicas de cada evento. */
export const FUNNEL: { event: string; label: string }[] = [
  { event: 'innovation_page_view', label: 'Abriu a página' },
  { event: 'label_viewed', label: 'Viu o rótulo 3D' },
  { event: 'digital_id_viewed', label: 'Viu a identidade digital' },
  { event: 'ar_cta_clicked', label: 'Tocou em Iniciar RA' },
  { event: 'ar_experience_started', label: 'Entrou na RA' },
  { event: 'signup_submitted', label: 'Virou tripulante' },
  { event: 'character_collected', label: 'Coletou o personagem' },
];

export const fetchStats = () => adminGet<Stats>('/api/stats');

export function funnelRows(s: Stats) {
  const by = new Map(s.funnel.map((f) => [f.name, f.sessions]));
  const rows = FUNNEL.map((f) => ({ ...f, value: by.get(f.event) ?? 0 }));
  const top = Math.max(1, ...rows.map((r) => r.value));
  return rows.map((r) => ({ ...r, pct: r.value / top }));
}

export const fmtInt = (n: number) => n.toLocaleString('pt-BR');
