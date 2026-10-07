-- Coleção de personagens da área do membro: o personagem é "pego" na RA e vai
-- para a vitrine. Um registro por membro e personagem.
create table collectibles (
  signup_ref    bigint not null references signups (id) on delete cascade,
  character     text not null,
  collected_at  timestamptz not null default now(),
  primary key (signup_ref, character)
);
