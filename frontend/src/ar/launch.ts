// Ponto de integração da experiência RA.
//
//   launchARExperience({ productId, lotId, unitId, source, campaign }, { renderer, ... })
//
// - Se config.ar.externalUrl existir, redireciona para lá propagando os ids.
// - Senão, abre o módulo RA embutido (carregado só neste momento): rastreamento do
//   rótulo pela câmera, com o astronauta ancorado nele.

import type * as THREE from 'three';
import { config } from '../config.ts';
import { identityQuery } from '../identity/session.ts';
import type { ProductIdentity } from '../identity/resolver.ts';
import { track } from '../analytics/analytics.ts';

export type ArIdentity = Pick<ProductIdentity, 'productId' | 'lotId' | 'unitId' | 'source' | 'campaign'>;

export interface LaunchOptions {
  renderer: THREE.WebGLRenderer | null;
  /** Pausa o palco da página enquanto a RA usa o renderer. */
  pauseLanding: () => void;
  resumeLanding: () => void;
  /**
   * Área do membro: mostra COLECIONAR (o holograma vira sólido) e depois PEGAR, que
   * fecha a RA e chama onTake (o personagem vai para a vitrine).
   */
  collect?: { onTake: () => void };
}

let modulePromise: Promise<typeof import('./ArExperience.ts')> | null = null;

/** Chamar cedo (ex.: quando a seção da RA se aproxima) para o clique ser instantâneo. */
export function prepareAR() {
  // Só o módulo pequeno da RA. A biblioteca de rastreamento e os alvos (~4 MB) baixam
  // ao tocar em INICIAR RA: pré-carregar na rolagem pesava demais no iPhone.
  modulePromise ??= import('./ArExperience.ts');
  return modulePromise;
}

export function arOverlayRoot(): HTMLElement {
  let el = document.getElementById('arx');
  if (!el) {
    el = document.createElement('div');
    el.id = 'arx';
    el.className = 'arx';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

export function launchARExperience(identity: ArIdentity, opts: LaunchOptions): Promise<void> {
  track('ar_cta_clicked');

  if (config.ar.externalUrl) {
    const q = identityQuery({ ...identity, origin: 'session', productChecksumValid: false });
    const sep = config.ar.externalUrl.includes('?') ? '&' : '?';
    window.location.href = config.ar.externalUrl + (q ? sep + q : '');
    return Promise.resolve();
  }

  const root = arOverlayRoot();
  return prepareAR()
    .then((m) => m.openArExperience({ identity, root, ...opts }))
    .then(() => track('ar_experience_started'))
    .catch((err: unknown) => {
      track('ar_experience_failed', { reason: err instanceof Error ? err.name : 'unknown' });
      throw err;
    });
}
