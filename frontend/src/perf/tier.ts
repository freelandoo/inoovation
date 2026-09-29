// Estimativa da capacidade do aparelho. Nunca é comunicada ao usuário.
//
// high   -> WebGL2 completo, partículas cheias, astronauta 3D, DPR até 2
// medium -> WebGL2 simplificado, menos partículas, DPR até 1.5
// low    -> sem WebGL: rótulo em HTML/CSS, motion básico

export type Tier = 'high' | 'medium' | 'low';

export interface PerfProfile {
  tier: Tier;
  reducedMotion: boolean;
  webgl2: boolean;
  webgpu: boolean;
  mobile: boolean;
  maxDpr: number;
  particles: number;
}

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    const ok = !!gl;
    (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

export function detectPerf(): PerfProfile {
  const url = new URLSearchParams(location.search);
  const forced = url.get('tier') as Tier | null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || url.has('reduced');
  const webgl2 = forced === 'low' ? false : hasWebGL2();
  const webgpu = 'gpu' in navigator;
  const mobile = window.matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ?? false;

  let tier: Tier;
  if (!webgl2) tier = 'low';
  else if (saveData || cores <= 4 || mem <= 3) tier = 'medium';
  else tier = mobile ? 'medium' : 'high';
  if (forced === 'high' || forced === 'medium' || forced === 'low') tier = forced === 'low' || webgl2 ? forced : 'low';

  const profile: PerfProfile = {
    tier,
    reducedMotion,
    webgl2,
    webgpu,
    mobile,
    maxDpr: tier === 'high' ? 2 : 1.5,
    particles: tier === 'high' ? 2600 : tier === 'medium' ? 900 : 0,
  };
  if (reducedMotion) profile.particles = Math.round(profile.particles * 0.3);
  document.documentElement.dataset.tier = tier;
  document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  return profile;
}
