// Decodifica QR fora da thread principal (jsQR). Recebe um recorte em RGBA e
// devolve o texto lido, ou null. `attemptBoth` também lê QR claro sobre fundo escuro.

import jsQR from 'jsqr';

interface Job {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, width, height, data } = e.data;
  let text: string | null = null;
  try {
    text = jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: 'attemptBoth' })?.data || null;
  } catch {
    /* quadro inválido */
  }
  self.postMessage({ id, text });
};
