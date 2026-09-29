-- Innovation Week — esquema inicial.
-- Nenhum dado pessoal: sem IP, sem user agent completo, sem nome/e-mail.

-- Uma linha por embalagem (produto + lote + unidade), criada no primeiro scan.
-- status: seen = apareceu numa URL; verified = confirmada pela lista/assinatura da Realizse.
create table units (
  id            bigserial primary key,
  product_id    text,
  lot_id        text,
  unit_id       text,
  unit_key      text not null unique,
  status        text not null default 'seen' check (status in ('seen', 'verified', 'blocked')),
  scan_count    integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index units_lot_idx on units (product_id, lot_id);
create index units_last_seen_idx on units (last_seen_at desc);

-- Cada abertura da página (id aleatório gerado no navegador).
create table sessions (
  id           uuid primary key,
  unit_ref     bigint references units (id) on delete set null,
  source       text,
  campaign     text,
  origin       text,
  tier         text,
  device       text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index sessions_unit_idx on sessions (unit_ref);
create index sessions_created_idx on sessions (created_at desc);

-- Eventos da jornada (page view, QR, RA...).
create table events (
  id         bigserial primary key,
  session_id uuid not null references sessions (id) on delete cascade,
  unit_ref   bigint references units (id) on delete set null,
  name       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_name_created_idx on events (name, created_at desc);
create index events_unit_idx on events (unit_ref);
create index events_session_idx on events (session_id);
