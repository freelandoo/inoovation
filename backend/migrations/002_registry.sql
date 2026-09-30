-- Lista oficial de unidades da campanha, importada dos links GS1 que a Realizse
-- envia (npm run registry:import). Uma unidade de `units` passa a `verified`
-- quando aparece aqui.
--
-- unit_id é o serial GS1 (AI 21) e diferencia maiúsculas de minúsculas:
-- `7Hk` e `7hk` são unidades diferentes. Não normalizar a caixa.
-- product_id é guardado como GTIN-14 (com zeros à esquerda).
create table registry_units (
  product_id  text not null,
  lot_id      text not null,
  unit_id     text not null,
  batch       text not null,
  imported_at timestamptz not null default now(),
  primary key (product_id, lot_id, unit_id)
);
