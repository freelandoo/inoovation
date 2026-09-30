// Pedido da câmera traseira para o leitor de QR. Fica fora do módulo do leitor
// para poder ser chamado direto no clique, antes do import dinâmico.

export function requestCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('getUserMedia indisponível');
    err.name = 'NotSupportedError';
    return Promise.reject(err);
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
}
