// InnovationLanding: composição da página de destino do QR.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { config } from './config.ts';
import { detectPerf } from './perf/tier.ts';
import { initIdentity } from './identity/session.ts';
import { hasIds } from './identity/resolver.ts';
import { setAnalyticsIdentity, track } from './analytics/analytics.ts';
import { connectAnalytics, registerScan } from './api/client.ts';
import { renderIdentity, renderVerification } from './ui/identityView.ts';
import { runBoot } from './ui/boot.ts';
import { initHud } from './ui/hud.ts';
import { initSections } from './ui/sections.ts';
import { initLabelFallback } from './ui/labelFallback.ts';
import { initArCta } from './ui/arCta.ts';
import { initUnitScanCta } from './ui/unitScanCta.ts';
import { initActivation } from './ui/activation.ts';
import { Stage } from './scene/Stage.ts';
import { EnergyPortal } from './scene/EnergyPortal.ts';
import { ParticleField } from './scene/ParticleField.ts';
import { Astronaut } from './scene/Astronaut.ts';
import { DigitalLabelTwin } from './label/DigitalLabelTwin.ts';
import { Director } from './story/Director.ts';

const perf = detectPerf();
const identity = initIdentity();
setAnalyticsIdentity(identity);
connectAnalytics();
const scan = registerScan(identity, perf.tier);
renderIdentity(identity);
// A API confere o serial na lista oficial; sem API a página não afirma nada.
if (identity.unitId) {
  renderVerification('pending');
  scan.then((unit) => {
    renderVerification(
      !unit ? 'offline' : unit.status === 'verified' ? 'verified' : unit.status === 'blocked' ? 'blocked' : 'unregistered',
    );
    // Unidade oficial: modal de ativação com cadastro.
    if (unit?.status === 'verified') initActivation({ identity, unit, reduced: perf.reducedMotion, pauseLanding, resumeLanding });
  });
}
track('innovation_page_view', { tier: perf.tier });
if (hasIds(identity)) track('identity_detected', { origin: identity.origin });

const domUpdaters: (() => void)[] = [initHud(perf.reducedMotion)];

let stage: Stage | null = null;
let portal: EnergyPortal | null = null;
let director: Director | null = null;

if (perf.tier !== 'low') {
  try {
    stage = new Stage(document.getElementById('stage') as HTMLCanvasElement, perf);
  } catch {
    stage = null;
    document.documentElement.dataset.tier = 'low';
  }
}

if (stage) {
  const s = stage;
  const pmrem = new THREE.PMREMGenerator(s.renderer);
  s.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  portal = new EnergyPortal(perf.tier === 'high' ? 5 : 3);
  s.scene.add(portal.mesh);

  const particles = new ParticleField(perf.particles || 1, Math.min(window.devicePixelRatio, perf.maxDpr), perf.reducedMotion ? 0.15 : 1);
  if (perf.particles) s.scene.add(particles.points);

  const astro = new Astronaut(s.scene);
  s.scene.add(astro.group);

  const label = new DigitalLabelTwin(s.renderer, { autoLight: perf.mobile });
  s.scene.add(label.group);

  director = new Director(s, label, portal, particles, astro, perf.reducedMotion);
  s.add(director);
  s.add(label);
  s.add(portal);
  s.add(particles);
  s.add(astro);
  s.onResize = () => director?.measure();

  domUpdaters.push(initSections({ identity, label, camera: s.camera, reduced: perf.reducedMotion }));

  // Prioridade: 1) arte base do rótulo  2) máscaras  3) astronauta.
  label
    .load(!perf.mobile)
    .then(() => {
      track('label_viewed', {}, { once: true });
      return label.loadMasks();
    })
    .catch((e) => console.warn('[label]', e))
    .finally(() => {
      astro.load(config.hero.modelGlb).catch((e) => console.warn('[astronaut]', e));
    });

  runBoot({ identity, target: director, fast: perf.tier !== 'high', reduced: perf.reducedMotion });
  s.start();
} else {
  domUpdaters.push(initSections({ identity, label: null, camera: null, reduced: perf.reducedMotion }));
  domUpdaters.push(initLabelFallback(perf.reducedMotion));
  runBoot({ identity, target: null, fast: true, reduced: perf.reducedMotion });
}

const pauseLanding = () => stage?.stop();
const resumeLanding = () => {
  if (!stage) return;
  stage.renderer.setPixelRatio(Math.min(window.devicePixelRatio, perf.maxDpr));
  stage.resize();
  stage.start();
};

initArCta({ renderer: stage?.renderer ?? null, portal, reduced: perf.reducedMotion, pauseLanding, resumeLanding });
// Chegou sem serial: oferece ler o QR do pote aqui mesmo.
initUnitScanCta({ identity, pauseLanding, resumeLanding });

// Loop do DOM (leve): só roda quando algo muda (scroll/resize) ou para a scanline.
let pending = false;
const runDom = () => {
  pending = false;
  for (const u of domUpdaters) u();
};
const schedule = () => {
  if (!pending) {
    pending = true;
    requestAnimationFrame(runDom);
  }
};
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('resize', () => {
  director?.measure();
  schedule();
});
setInterval(schedule, 50);
document.fonts?.ready.then(() => {
  director?.measure();
  schedule();
});
runDom();
