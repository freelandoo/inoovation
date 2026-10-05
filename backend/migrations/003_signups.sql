-- Cadastro de quem ativou uma unidade verificada (modal "Unidade ativada").
-- Primeiro dado pessoal do sistema: nome, e-mail e WhatsApp (opcional), só com
-- consentimento explícito. Um cadastro por e-mail e unidade; repetir atualiza.
create table signups (
  id                bigserial primary key,
  unit_ref          bigint not null references units (id) on delete cascade,
  session_id        uuid references sessions (id) on delete set null,
  name              text not null,
  email             text not null,
  phone             text,
  consent_version   text not null,
  marketing_opt_in  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (unit_ref, email)
);
create index signups_created_idx on signups (created_at desc);
