-- Partidas do jogo Astronaut Jetpack (/jogo). O servidor sorteia a seed e marca
-- o início; o fim é aceito uma vez só e apenas se a distância couber no tempo
-- decorrido. Partidas de quem não é membro também ficam (sem signup_ref), mas
-- só membros entram no ranking.
create table game_runs (
  id           uuid primary key,
  session_id   uuid not null,
  signup_ref   bigint references signups (id) on delete cascade,
  seed         bigint not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  distance     integer,
  fuel         integer,
  pickups      integer
);
create index game_runs_best_idx on game_runs (signup_ref, distance desc) where finished_at is not null;
create index game_runs_session_idx on game_runs (session_id, started_at desc);
