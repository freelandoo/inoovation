-- Um QR code (produto + lote + serial) só pode ser ativado uma vez: um tripulante
-- por pote. A chave usa o GTIN-14, para o mesmo pote lido com 13 ou 14 dígitos
-- (duas linhas em `units`) continuar sendo uma unidade só.
alter table signups add column unit_code text;
update signups s set unit_code = lpad(u.product_id, 14, '0') || '|' || u.lot_id || '|' || u.unit_id
  from units u where u.id = s.unit_ref;
-- Se o mesmo pote já tiver mais de um cadastro, fica o primeiro.
delete from signups s using signups f where f.unit_code = s.unit_code and f.id < s.id;
alter table signups alter column unit_code set not null;
create unique index signups_unit_code_idx on signups (unit_code);
