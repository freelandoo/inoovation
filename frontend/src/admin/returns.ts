// Devolução de embalagens (área admin): o admin lê o QR do pote com a câmera e a
// API registra a devolução. Só admins logados; cada pote conta uma vez.

import { requestCamera } from '../scanner/camera.ts';
import type { ScannedUnit } from '../scanner/decode.ts';
import { adminGet, adminPost } from './session.ts';
import { fmtInt } from './stats.ts';

interface ReturnInfo {
  unit: { productId: string; lotId: string; unitId: string };
  returnedAt: string;
  returnedBy: string;
  crew: number | null;
}
type ReturnResponse = Partial<ReturnInfo> & { ok?: boolean; total?: number; error?: string; code?: string };

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR');
const crewLabel = (n: number | null) => (n == null ? '—' : `Nº ${String(n).padStart(4, '0')}`);

function show(kind: 'ok' | 'warn' | 'error', title: string, lines: string[]) {
  const box = $('#ad-ret-result');
  box.dataset.kind = kind;
  box.replaceChildren();
  const b = document.createElement('b');
  b.textContent = title;
  box.appendChild(b);
  for (const l of lines) {
    const span = document.createElement('span');
    span.textContent = l;
    box.appendChild(span);
  }
  box.hidden = false;
}

export async function refreshReturns() {
  const r = await adminGet<{ total: number; recent: ReturnInfo[] }>('/api/admin/returns');
  if (!r) return;
  $('#ad-ret-total').textContent = fmtInt(r.total);
  const body = $('#ad-ret-list');
  body.replaceChildren();
  for (const x of r.recent.slice(0, 10)) {
    const tr = document.createElement('tr');
    for (const v of [x.unit.unitId, x.unit.lotId, crewLabel(x.crew), `@${x.returnedBy}`, when(x.returnedAt)]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if (!r.recent.length) body.innerHTML = '<tr><td colspan="5">Nenhuma devolução ainda.</td></tr>';
}

async function register(unit: ScannedUnit) {
  const res = await adminPost<ReturnResponse>('/api/admin/returns', unit);
  const id = `SERIAL ${unit.unitId}${unit.lotId ? ` · LOTE ${unit.lotId}` : ''}`;
  if (!res) return show('error', 'SEM CONEXÃO', [id, 'A devolução não foi registrada. Leia de novo.']);
  const j = res.body;
  if (res.status === 200 && j.ok) {
    show('ok', 'DEVOLUÇÃO REGISTRADA', [id, j.crew != null ? `Tripulante ${crewLabel(j.crew)}` : 'Pote sem tripulante cadastrado']);
  } else if (j.code === 'already_returned') {
    show('warn', 'JÁ DEVOLVIDA', [id, `Registrada em ${when(j.returnedAt!)} por @${j.returnedBy}. Não somou de novo.`]);
  } else if (j.code === 'not_registered') {
    show('error', 'FORA DA LISTA OFICIAL', [id, 'Este pote não está na lista da campanha. Não foi contado.']);
  } else if (res.status === 401) {
    show('error', 'SESSÃO EXPIRADA', ['Entre de novo para registrar devoluções.']);
    window.setTimeout(() => location.reload(), 1500);
    return;
  } else {
    show('error', 'NÃO REGISTRADA', [id, j.error ?? 'Erro na API. Tente de novo.']);
  }
  await refreshReturns();
}

export function initReturns() {
  const btn = $<HTMLButtonElement>('#ad-ret-scan');
  btn.onclick = () => {
    // Câmera pedida dentro do clique (exigência do iPhone), antes do import do leitor.
    const stream = requestCamera();
    stream.catch(() => {});
    btn.disabled = true;
    import('../scanner/UnitScanner.ts')
      .then(({ openUnitScanner }) => {
        let scanned: ScannedUnit | null = null;
        const scanner = openUnitScanner({
          stream,
          labels: {
            chip: 'DEVOLUÇÃO',
            title: 'Aponte para o QR do pote devolvido',
            locked: (u) => `SERIAL ${u.unitId}. Registrando devolução…`,
          },
          onUnit: (u) => {
            scanned = u;
            window.setTimeout(() => scanner.close(), 600);
          },
          onInvalid: () => {},
          onError: () => {},
          onClose: () => {
            btn.disabled = false;
            btn.focus();
            if (scanned) register(scanned);
          },
        });
      })
      .catch(() => {
        stream.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
        btn.disabled = false;
        show('error', 'LEITOR INDISPONÍVEL', ['Recarregue a página e tente de novo.']);
      });
  };
}
