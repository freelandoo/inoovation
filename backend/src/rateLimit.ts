// Limite de requisições em memória (janela fixa por chave). O IP é usado só
// como chave aqui e nunca é gravado. Com várias instâncias, cada uma tem o seu
// limite — suficiente para este volume.

export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  return (key: string): boolean => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset <= now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    h.count++;
    return h.count <= limit;
  };
}
