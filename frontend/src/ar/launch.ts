// Ponto de integração da experiência RA.
//
//   launchARExperience({ productId, lotId, unitId, source, campaign }, { renderer, ... })
//
// - Se config.ar.externalUrl existir, redireciona para lá propagando os ids.
// - Senão, abre o módulo RA embutido (carregado só neste momento).
//
// IMPORTANTE: precisa ser chamado DIRETO no clique. As permissões (sessão WebXR,
// giroscópio no iOS) exigem gesto do usuário e são pedidas aqui, antes de qualquer
// await; o carregamento do módulo acontece depois.

import type * as THREE from 'three';
import { config } from '../config.ts';
import { identityQuery } from '../identity/session.ts';
import type { ProductIdentity } from '../identity/resolver.ts';
import { track } from '../analytics/analytics.ts';
import { requestOrientationPermission } from './modes.ts';

export type ArIdentity = Pick<ProductIdentity, 'productId' | 'lotId' | 'unitId' | 'source' | 'campaign'>;

export interface LaunchOptions {
  renderer: THREE.WebGLRenderer | null;
  /** Pausa o palco da página enquanto a RA usa o renderer. */
  pauseLanding: () => void;
  resumeLanding: () => void;
}

let xrSupported: boolean | null = null;
let modulePromise: Promise<typeof import('./ArExperience.ts')> | null = null;

/** Chamar cedo (ex.: quando a seção da RA se aproxima) para o clique ser instantâneo. */
export function prepareAR() {
  if (xrSupported === null) {
    xrSupported = false;
    navigator.xr
      ?.isSessionSupported('immersive-ar')
      .then((v) => (xrSupported = v))
      .catch(() => {});
  }
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

  // --- tudo abaixo até o primeiro await roda dentro do gesto do usuário ---
  const root = arOverlayRoot();
  let sessionPromise: Promise<XRSession> | null = null;
  let orientationPromise: Promise<boolean> | null = null;
  if (xrSupported && navigator.xr && opts.renderer) {
    sessionPromise = navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root },
    } as XRSessionInit);
  } else {
    orientationPromise = requestOrientationPermission();
  }
  // ------------------------------------------------------------------------

  return prepareAR()
    .then((m) => m.openArExperience({ identity, root, sessionPromise, orientationPromise, ...opts }))
    .then(() => track('ar_experience_started'))
    .catch((err: unknown) => {
      track('ar_experience_failed', { reason: err instanceof Error ? err.name : 'unknown' });
      throw err;
    });
}
