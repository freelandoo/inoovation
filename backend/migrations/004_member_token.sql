-- Link secreto da área do membro (/membro/<token>). O token é gerado na API
-- (crypto.randomBytes); linhas antigas recebem um aleatório aqui.
alter table signups add column member_token text;
update signups set member_token = replace(gen_random_uuid()::text, '-', '') where member_token is null;
alter table signups alter column member_token set not null;
create unique index signups_member_token_idx on signups (member_token);
