// Personagens colecionáveis. Hoje só o astronauta existe; as outras posições da
// vitrine aparecem trancadas ("próxima missão"), o que convida a continuar a coleção.
// Ids aceitos pela API: backend/src/validate.ts → CHARACTERS.

export interface Character {
  id: string;
  number: string;
  name: string;
  /** Linha curta exibida no card e no visualizador. */
  title: string;
  rarity: string;
  model: string;
  card: string;
}

export const CHARACTERS: Character[] = [
  {
    id: 'astronauta',
    number: '001',
    name: 'O Pioneiro',
    title: 'Primeiro tripulante da Innovation Week',
    rarity: 'EDIÇÃO DE LANÇAMENTO',
    model: '/models/spacesuit.glb',
    card: '/innovation-week/collection/astronauta-card.webp',
  },
];

/** Total de posições na vitrine (as que ainda não têm personagem aparecem trancadas). */
export const COLLECTION_SLOTS = 6;

export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? null;

/** Personagem que a RA da área do membro mostra: o último registrado. */
export const latestCharacter = () => CHARACTERS[CHARACTERS.length - 1];

export const CHAMBER_BG = '/innovation-week/collection/chamber.webp';
export const CHAMBER_BG_SMALL = '/innovation-week/collection/chamber-1024.webp';
