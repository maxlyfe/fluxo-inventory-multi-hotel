-- ============================================================================
-- Por que ESTA nota não entrou na fila de cobranças?
--
-- Percorre, na mesma ordem, cada condição que rpc_ar_prepare_billing_for_nf
-- verifica, e diz em qual delas a nota parou. Somente leitura.
--
-- COMO USAR: troque os dois valores no bloco PARAMETROS abaixo (basta um dos
-- dois: o outro pode ficar como string vazia) e rode o arquivo inteiro.
--
-- Resultado: uma tabela com ordem / verificacao / status / detalhe. A PRIMEIRA
-- linha com status 'FALHA' é a causa; as seguintes são consequência dela.
-- ============================================================================

WITH parametros AS (
  SELECT
    '7385'      AS booking_ref,   -- número da reserva  (ou '')
    '202600876' AS numero_nf      -- número da NF        (ou '')
),

-- A nota. Casa por número de reserva OU por número de NF (prefixo, porque a
-- tela mostra '202600876/NFS' e o banco guarda só o número).
nf AS (
  SELECT i.*
    FROM nf_invoices i, parametros p
   WHERE (NULLIF(p.booking_ref, '') IS NOT NULL
          AND lower(btrim(i.booking_number)) = lower(btrim(p.booking_ref)))
      OR (NULLIF(p.numero_nf, '') IS NOT NULL
          AND btrim(i.numero_nf) LIKE btrim(p.numero_nf) || '%')
   ORDER BY i.created_at DESC
   LIMIT 1
),

cnpj AS (
  SELECT regexp_replace(COALESCE(tomador_cpf_cnpj, ''), '\D', '', 'g') AS limpo,
         tomador_cpf_cnpj AS cru
    FROM nf
),

-- Regra que casa pelo CNPJ, exatamente como fn_ar_partner_rule faz.
regra AS (
  SELECT r.*
    FROM channel_receiving_rules r, nf, cnpj
   WHERE r.hotel_id = nf.hotel_id
     AND r.active
     AND r.partner_cnpj = cnpj.limpo
   LIMIT 1
),

-- Alguma regra com ESTE CNPJ, mesmo inativa ou de outro hotel? É o que
-- distingue "não cadastrei" de "cadastrei errado".
regra_qualquer AS (
  SELECT count(*)::int AS n,
         count(*) FILTER (WHERE NOT r.active)::int AS inativas,
         count(*) FILTER (WHERE r.hotel_id <> (SELECT hotel_id FROM nf))::int AS outro_hotel,
         count(*) FILTER (WHERE r.trigger_event <> 'faturamento')::int AS outro_evento,
         array_agg(DISTINCT r.trigger_event) AS eventos
    FROM channel_receiving_rules r, cnpj
   WHERE r.partner_cnpj = cnpj.limpo
),

titulo AS (
  SELECT t.* FROM ar_titles t, nf
   WHERE t.hotel_id = nf.hotel_id
     AND lower(btrim(t.booking_ref)) = lower(btrim(COALESCE(nf.booking_number, '')))
     AND t.status <> 'cancelado'
   ORDER BY t.installment_number
   LIMIT 1
),

vinculo AS (
  SELECT count(*)::int AS n FROM ar_title_nf_invoices l, nf WHERE l.nf_invoice_id = nf.id
),

disparo AS (
  SELECT d.* FROM ar_billing_dispatches d, nf WHERE d.nf_invoice_id = nf.id LIMIT 1
)

SELECT ord, verificacao, status, detalhe FROM (
  SELECT 1 AS ord, 'Nota localizada' AS verificacao,
         CASE WHEN EXISTS (SELECT 1 FROM nf) THEN 'OK' ELSE 'FALHA' END AS status,
         COALESCE((SELECT 'NF ' || COALESCE(numero_nf, '(sem numero)')
                        || ' · reserva ' || COALESCE(booking_number, '(sem reserva)')
                        || ' · R$ ' || COALESCE(valor_total, 0)::text
                        || ' · emitida ' || created_at::date::text FROM nf),
                  'Nenhuma nota casou com os parametros. Confira o numero da reserva e o da NF.') AS detalhe

  UNION ALL
  SELECT 2, 'Hotel da nota',
         CASE WHEN EXISTS (SELECT 1 FROM nf) THEN 'INFO' ELSE 'N/A' END,
         COALESCE((SELECT COALESCE(h.name, nf.hotel_id::text) FROM nf LEFT JOIN hotels h ON h.id = nf.hotel_id), '—')

  UNION ALL
  SELECT 3, 'Status fiscal aceito (autorizada/emitida/contingencia)',
         CASE WHEN NOT EXISTS (SELECT 1 FROM nf) THEN 'N/A'
              WHEN (SELECT status FROM nf) IN ('autorizada','emitida','contingencia') THEN 'OK'
              ELSE 'FALHA' END,
         COALESCE((SELECT 'status = ' || status FROM nf), '—')

  UNION ALL
  SELECT 4, 'Tomador tem CNPJ de 14 digitos',
         CASE WHEN NOT EXISTS (SELECT 1 FROM nf) THEN 'N/A'
              WHEN (SELECT length(limpo) FROM cnpj) = 14 THEN 'OK'
              ELSE 'FALHA' END,
         COALESCE((SELECT 'tomador: ' || COALESCE(nf.tomador_nome, '(sem nome)')
                        || ' · doc gravado: ' || COALESCE(NULLIF(c.cru, ''), '(vazio)')
                        || ' · so digitos: ' || c.limpo
                        || ' (' || length(c.limpo)::text || ' digitos'
                        || CASE WHEN length(c.limpo) = 11 THEN ', e CPF: nota de pessoa fisica nao vira cobranca de parceiro'
                                WHEN length(c.limpo) = 0  THEN ', vazio: a NF foi emitida sem documento do tomador'
                                ELSE '' END || ')'
                     FROM nf, cnpj c), '—')

  UNION ALL
  SELECT 5, 'Existe regra ATIVA com este CNPJ neste hotel',
         CASE WHEN NOT EXISTS (SELECT 1 FROM nf) THEN 'N/A'
              WHEN EXISTS (SELECT 1 FROM regra) THEN 'OK'
              ELSE 'FALHA' END,
         CASE WHEN EXISTS (SELECT 1 FROM regra)
              THEN (SELECT 'regra "' || channel || '" · evento ' || trigger_event
                         || ' · ' || days_to_receive::text || ' dias' FROM regra)
              WHEN (SELECT n FROM regra_qualquer) = 0
              THEN 'Nenhuma regra com este CNPJ em nenhum hotel. O CNPJ da regra tem '
                   || 'que ser o MESMO do tomador da nota (compare com o item 4).'
              ELSE 'Existe(m) ' || (SELECT n FROM regra_qualquer)::text || ' regra(s) com este CNPJ, mas: '
                   || CASE WHEN (SELECT outro_hotel FROM regra_qualquer) > 0
                           THEN (SELECT outro_hotel FROM regra_qualquer)::text || ' em OUTRO hotel. ' ELSE '' END
                   || CASE WHEN (SELECT inativas FROM regra_qualquer) > 0
                           THEN (SELECT inativas FROM regra_qualquer)::text || ' INATIVA(S). ' ELSE '' END
         END

  UNION ALL
  SELECT 6, 'A regra usa evento Faturamento',
         CASE WHEN NOT EXISTS (SELECT 1 FROM regra) THEN 'N/A'
              WHEN (SELECT trigger_event FROM regra) = 'faturamento' THEN 'OK'
              ELSE 'FALHA' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM regra) THEN 'Depende do item 5'
              WHEN (SELECT trigger_event FROM regra) = 'faturamento' THEN 'faturamento'
              ELSE 'A regra esta como "' || (SELECT trigger_event FROM regra)
                   || '". Só evento Faturamento gera cobranca por e-mail. '
                   || 'Check-in e check-out apenas calculam a data de recebimento.'
         END

  UNION ALL
  SELECT 7, 'Titulo da reserva encontrado',
         CASE WHEN NOT EXISTS (SELECT 1 FROM nf) THEN 'N/A'
              WHEN EXISTS (SELECT 1 FROM titulo) THEN 'OK' ELSE 'INFO' END,
         CASE WHEN EXISTS (SELECT 1 FROM titulo)
              THEN (SELECT 'titulo ' || id::text || ' · billing_status ' || billing_status
                         || ' · R$ ' || net_amount::text FROM titulo)
              ELSE 'Sem titulo para esta reserva. Nao impede: a cobranca cria um '
                   || 'titulo origin=faturado. Se voce esperava reaproveitar o da '
                   || 'reserva, rode "Gerar das reservas" antes.'
         END

  UNION ALL
  SELECT 8, 'Ja esta na fila (vinculo + disparo)',
         CASE WHEN NOT EXISTS (SELECT 1 FROM nf) THEN 'N/A'
              WHEN EXISTS (SELECT 1 FROM disparo) THEN 'OK' ELSE 'INFO' END,
         CASE WHEN EXISTS (SELECT 1 FROM disparo)
              THEN (SELECT 'disparo ' || status || ' para ' || COALESCE(to_email, '(sem e-mail)')
                         || CASE WHEN sent_at IS NOT NULL THEN ' · enviado ' || sent_at::date::text ELSE '' END
                      FROM disparo)
              ELSE (SELECT n FROM vinculo)::text || ' vinculo(s) e nenhum disparo. '
                   || 'Se os itens 3 a 6 estao OK, rode "Buscar NFs emitidas" em '
                   || '/finances/cobrancas cobrindo a data de emissao do item 1.'
         END
) t
ORDER BY ord;

-- ============================================================================
-- Todas as regras de FATURAMENTO do hotel da nota, para comparar o CNPJ a olho.
-- Descomente e rode se o item 5 deu FALHA.
-- ============================================================================
-- SELECT r.channel, r.partner_cnpj, r.trigger_event, r.days_to_receive, r.active,
--        s.razao_social, s.nome_fantasia, r.billing_email
--   FROM channel_receiving_rules r
--   LEFT JOIN suppliers s ON s.id = r.supplier_id
--  WHERE r.hotel_id = (
--          SELECT i.hotel_id FROM nf_invoices i
--           WHERE lower(btrim(i.booking_number)) = '7385'   -- <<< sua reserva
--           ORDER BY i.created_at DESC LIMIT 1)
--    AND r.trigger_event = 'faturamento'
--  ORDER BY r.channel;
