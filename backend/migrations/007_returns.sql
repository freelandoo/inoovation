-- Embalagens devolvidas, lidas por um admin no leitor da área admin.
-- Uma devolução por pote (mesma chave da lista oficial: GTIN-14|lote|serial).
create table returns (
  unit_code    text primary key,
  product_id   text not null,
  lot_id       text not null,
  unit_id      text not null,
  returned_by  text not null,
  returned_at  timestamptz not null default now()
);
create index returns_at_idx on returns (returned_at desc);
