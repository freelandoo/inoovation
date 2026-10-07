// "Ativar minha unidade": aparece só quando a página abriu sem o serial (ex.: o
// redirecionamento da Realizse perdeu os ids). Abre o leitor de QR da página;
// lida a unidade, recarrega no caminho GS1 dela, e daí em diante o fluxo é o
// mesmo de quem chegou com o link completo (verificação na API, passaporte, RA).

import { config } from '../config.ts';
import { track } from '../analytics/analytics.ts';
import type { ProductIdentity } from '../identity/resolver.ts';
import { requestCamera } from '../scanner/camera.ts';
import { unitPath, type ScannedUnit } from '../scanner/decode.ts';

export interface UnitScanCtaOptions {
  identity: ProductIdentity;
  pauseLanding: () => void;
  resumeLanding: () => void;
}

const loadScanner = () => import('../scanner/UnitScanner.ts');
const RELOADED_KEY = 'iw:scanner-reloaded';
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 120);

function unitUrl(unit: ScannedUnit, id: ProductIdentity): string {
  const q = new URLSearchParams({ [config.scanner.viaParam]: config.scanner.viaValue });
  if (id.source) q.set('source', id.source);
  if (id.campaign) q.set('campaign', id.campaign);
  return `${unitPath(unit)}?${q}`;
}

export function initUnitScanCta(opts: UnitScanCtaOptions) {
  if (opts.identity.unitId) return;
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-unit-scan]');
  if (!buttons.length) return;
  document.querySelectorAll<HTMLElement>('[data-unit-scan], [data-unit-scan-block]').forEach((e) => (e.hidden = false));
  document.documentElement.classList.add('unit-unlinked');

  // Baixa o leitor com a página já pronta, para o toque abrir na hora.
  window.setTimeout(() => loadScanner().catch(() => {}), 4000);

  let open = false;
  const onClick = () => {
    if (open) return;
    open = true;
    track('unit_scan_opened');
    // Pedido da câmera dentro do gesto, antes de qualquer await.
    const stream = requestCamera();
    // A recusa pode chegar antes do módulo do leitor carregar; ele trata o erro depois.
    stream.catch(() => {});
    opts.pauseLanding();
    const done = () => {
      open = false;
      opts.resumeLanding();
    };
    // Uma nova tentativa se o módulo não carregar (rede instável no evento).
    loadScanner()
      .catch(() => loadScanner())
      .then((m) =>
        m.openUnitScanner({
          stream,
          onUnit: (unit, detector) => {
            track('unit_scan_succeeded', { detector });
            window.setTimeout(() => window.location.replace(unitUrl(unit, opts.identity)), 700);
          },
          onInvalid: () => track('unit_scan_failed', { reason: 'invalid_qr' }),
          onError: (reason) => track('unit_scan_failed', { reason }),
          onClose: done,
        }),
      )
      .catch((e: unknown) => {
        stream.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
        track('unit_scan_failed', { reason: 'load_error', error: errText(e) });
        done();
        // Arquivo do leitor sumiu (página aberta antes de uma atualização do site):
        // recarrega uma vez para pegar a versão nova.
        const reloaded = (() => {
          try {
            const was = sessionStorage.getItem(RELOADED_KEY) === '1';
            sessionStorage.setItem(RELOADED_KEY, '1');
            return was;
          } catch {
            return true;
          }
        })();
        if (!reloaded) window.setTimeout(() => window.location.reload(), 300);
      });
  };
  buttons.forEach((b) => b.addEventListener('click', onClick));
}
