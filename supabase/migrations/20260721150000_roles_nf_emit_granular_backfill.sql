-- Compat: perfis que já tinham 'nf_integration' (acesso à NF) ganham as novas
-- sub-permissões de emissão (nfce/nfe/nfse), para não perderem a capacidade de
-- emitir após a granularização. 'nf.emit.devolucao' fica de fora (novo recurso).
UPDATE custom_roles
SET permissions = (
  SELECT jsonb_agg(DISTINCT elem)
  FROM jsonb_array_elements(
    permissions || '["nf.emit.nfce","nf.emit.nfe","nf.emit.nfse"]'::jsonb
  ) AS elem
)
WHERE permissions ? 'nf_integration'
  AND NOT (permissions ?& array['nf.emit.nfce','nf.emit.nfe','nf.emit.nfse']);
