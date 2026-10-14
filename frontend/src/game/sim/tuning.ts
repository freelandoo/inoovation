// Parâmetros do jogo num lugar só. 1 unidade = 1 metro. Eixo X: avanço do
// percurso; Y: altitude. Tudo aqui é ajustável sem mexer na lógica.

export interface Tuning {
  /** Passo fixo da física (s). A simulação nunca usa o tempo do quadro. */
  step: number;
  gravity: number;
  thrust: number;
  maxUp: number;
  maxFall: number;
  /** Faixa jogável: chão e teto são letais. */
  floor: number;
  ceiling: number;
  startY: number;
  /** Caixa de colisão do astronauta (pose de voo, deitado). */
  hitW: number;
  hitH: number;
  /** Raio de coleta das cápsulas. */
  pickupR: number;
  /** Raio de coleta do pote Evora Vulcan (maior que a cápsula). */
  vulcanR: number;
  /** Duração do poder Vulcan (s): bater numa pilastra quebra a peça em vez de matar. */
  powerTime: number;
  /** Multiplicador da velocidade horizontal durante o poder Vulcan. */
  powerSpeed: number;
  fuel: {
    max: number;
    start: number;
    burn: number;
    small: number;
    big: number;
    /** Combustível que o pote Evora Vulcan dá, além do poder. */
    vulcan: number;
    /** Fração do tanque abaixo da qual o alerta de combustível baixo aparece. */
    low: number;
  };
  /** Primeiro obstáculo (m) — fora da tela no início. */
  firstObstacleX: number;
  /** Quanto à frente do astronauta o percurso já fica gerado (m). */
  lookahead: number;
  /** Atraso de reação assumido pelo validador de trajetórias (s). */
  reaction: number;
}

export const TUNING: Tuning = {
  step: 1 / 120,
  gravity: 18,
  thrust: 30,
  maxUp: 7,
  maxFall: 9,
  floor: 0,
  ceiling: 13,
  startY: 6.5,
  hitW: 0.95,
  hitH: 0.48,
  pickupR: 0.42,
  vulcanR: 0.6,
  powerTime: 5,
  powerSpeed: 2,
  fuel: { max: 100, start: 100, burn: 12, small: 30, big: 60, vulcan: 50, low: 0.2 },
  firstObstacleX: 16,
  lookahead: 34,
  reaction: 0.15,
};
