-- ============================================================================
-- Por que a cobrança não saiu?
--
-- Cada tentativa de envio grava uma linha em ar_billing_dispatch_attempts com o
-- provider usado e o erro do servidor SMTP. É esse histórico que diz se o e-mail
-- saiu de verdade, se o Gmail recusou, ou se o ambiente estava em modo de teste.
--
-- Somente leitura. Troque o número da reserva no PARAMETROS.
-- ============================================================================

WITH parametros AS (
  SELECT '7385' AS booking_ref     -- <<< TROCAR
),

alvo AS (
  SELECT d.*, t.booking_ref, t.billing_status, t.expected_date, t.net_amount,
         nf.numero_nf
    FROM ar_billing_dispatches d
    JOIN ar_titles t ON t.id = d.ar_title_id
    LEFT JOIN nf_invoices nf ON nf.id = d.nf_invoice_id
   WHERE lower(btrim(t.booking_ref)) = lower(btrim((SELECT booking_ref FROM parametros)))
   ORDER BY d.created_at DESC
   LIMIT 1
),

cfg AS (
  SELECT c.* FROM hotel_email_config c, alvo WHERE c.hotel_id = alvo.hotel_id
),

-- Toda coluna qualificada com "a.": ar_billing_dispatches (dentro de `alvo`)
-- também tem provider, status e error, e o cross join deixaria os nomes ambíguos.
tentativas AS (
  SELECT count(*)::int AS n,
         max(a.attempt_no) AS ultima,
         (array_agg(a.provider           ORDER BY a.attempt_no DESC))[1] AS ultimo_provider,
         (array_agg(a.status             ORDER BY a.attempt_no DESC))[1] AS ultimo_status,
         (array_agg(a.error              ORDER BY a.attempt_no DESC))[1] AS ultimo_erro,
         (array_agg(a.provider_message_id ORDER BY a.attempt_no DESC))[1] AS ultimo_message_id
    FROM ar_billing_dispatch_attempts a
    JOIN alvo ON alvo.id = a.dispatch_id
)

SELECT ord, verificacao, status, detalhe FROM (
  SELECT 1 AS ord, 'Disparo encontrado' AS verificacao,
         CASE WHEN EXISTS (SELECT 1 FROM alvo) THEN 'OK' ELSE 'FALHA' END AS status,
         COALESCE((SELECT 'status ' || status || ' · NF ' || COALESCE(numero_nf, '—')
                        || ' · destino ' || COALESCE(to_email, '(VAZIO)')
                        || ' · tentativas ' || COALESCE(attempts, 0)::text FROM alvo),
                  'Nenhum disparo para esta reserva. Rode "Buscar NFs emitidas" antes.') AS detalhe

  UNION ALL
  SELECT 2, 'Destino preenchido',
         CASE WHEN NOT EXISTS (SELECT 1 FROM alvo) THEN 'N/A'
              WHEN NULLIF(btrim((SELECT COALESCE(to_email,'') FROM alvo)), '') IS NOT NULL THEN 'OK'
              ELSE 'FALHA' END,
         COALESCE((SELECT to_email FROM alvo),
                  'Sem e-mail: preencha o e-mail de cobranca na regra do parceiro '
                  || 'ou o e-mail no cadastro do fornecedor.')

  UNION ALL
  SELECT 3, 'Remetente da unidade configurado e ATIVO',
         CASE WHEN NOT EXISTS (SELECT 1 FROM alvo) THEN 'N/A'
              WHEN NOT EXISTS (SELECT 1 FROM cfg) THEN 'FALHA'
              WHEN (SELECT active FROM cfg)
               AND (SELECT smtp_password_enc IS NOT NULL FROM cfg)
               AND (SELECT NULLIF(btrim(from_email), '') IS NOT NULL FROM cfg) THEN 'OK'
              ELSE 'FALHA' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM cfg)
              THEN 'A unidade NAO tem registro em hotel_email_config. Configure em '
                   || 'Regras de Recebimento > Remetente de E-mail.'
              ELSE (SELECT 'de ' || COALESCE(from_email, '(sem from)')
                         || ' · host ' || COALESCE(smtp_host, '?') || ':' || COALESCE(smtp_port, 0)::text
                         || ' · ativo: ' || active::text
                         || ' · senha gravada: ' || (smtp_password_enc IS NOT NULL)::text
                         || CASE WHEN last_test_ok IS NOT NULL
                                 THEN ' · ultimo teste: ' || CASE WHEN last_test_ok THEN 'OK' ELSE 'FALHOU' END
                                   || COALESCE(' (' || last_test_error || ')', '')
                                 ELSE ' · nunca testado' END
                      FROM cfg)
         END

  UNION ALL
  SELECT 4, 'Houve tentativa de envio?',
         CASE WHEN NOT EXISTS (SELECT 1 FROM alvo) THEN 'N/A'
              WHEN (SELECT n FROM tentativas) > 0 THEN 'OK' ELSE 'FALHA' END,
         CASE WHEN (SELECT n FROM tentativas) = 0
              THEN 'NENHUMA tentativa registrada. O envio nao chegou ao SMTP: ou o '
                   || 'disparo foi ignorado antes (veja itens 2 e 3), ou a function '
                   || 'nao existe no ambiente (deploy pendente), ou faltou a '
                   || 'permissao finances.billing.send.'
              ELSE (SELECT n::text || ' tentativa(s) · ultima #' || ultima::text
                         || ' · provider ' || COALESCE(ultimo_provider, '?')
                         || ' · ' || COALESCE(ultimo_status, '?')
                         || COALESCE(' · erro: ' || ultimo_erro, '')
                      FROM tentativas)
         END

  UNION ALL
  SELECT 5, 'Modo de teste (EMAIL_PROVIDER=log)?',
         CASE WHEN (SELECT ultimo_provider FROM tentativas) = 'log' THEN 'FALHA'
              WHEN (SELECT ultimo_provider FROM tentativas) = 'smtp' THEN 'OK'
              ELSE 'N/A' END,
         CASE WHEN (SELECT ultimo_provider FROM tentativas) = 'log'
              THEN 'ESTA A CAUSA: o ambiente rodou com EMAIL_PROVIDER=log, que '
                   || 'registra e NAO envia. Troque para smtp nas variaveis da '
                   || 'Netlify e faca um novo deploy.'
              WHEN (SELECT ultimo_provider FROM tentativas) = 'smtp'
              THEN 'Provider correto: o e-mail foi entregue ao servidor SMTP.'
              ELSE 'Sem tentativa para avaliar.'
         END

  UNION ALL
  SELECT 6, 'O SMTP aceitou a mensagem?',
         CASE WHEN (SELECT ultimo_status FROM tentativas) = 'enviado' THEN 'OK'
              WHEN (SELECT ultimo_status FROM tentativas) = 'falha'   THEN 'FALHA'
              ELSE 'N/A' END,
         CASE WHEN (SELECT ultimo_status FROM tentativas) = 'enviado'
              THEN 'Aceito, message-id ' || COALESCE((SELECT ultimo_message_id FROM tentativas), '(sem id)')
                   || '. Se o parceiro nao recebeu, o problema e ENTREGA, nao envio: '
                   || 'confira a caixa de spam e se SPF/DKIM do dominio estao publicados.'
              WHEN (SELECT ultimo_status FROM tentativas) = 'falha'
              THEN 'Recusado: ' || COALESCE((SELECT ultimo_erro FROM tentativas), '(sem detalhe)')
              ELSE 'Sem tentativa para avaliar.'
         END

  UNION ALL
  SELECT 7, 'Estado final do recebivel',
         'INFO',
         COALESCE((SELECT 'billing_status ' || billing_status
                        || ' · previsao ' || COALESCE(expected_date::text, '(sem data firme)')
                        || ' · liquido R$ ' || net_amount::text FROM alvo), '—')
) t
ORDER BY ord;

-- ============================================================================
-- Histórico completo das tentativas desta cobrança
-- ============================================================================
-- SELECT a.attempt_no, a.status, a.provider, a.provider_message_id, a.error,
--        a.http_status, a.created_at
--   FROM ar_billing_dispatch_attempts a
--   JOIN ar_billing_dispatches d ON d.id = a.dispatch_id
--   JOIN ar_titles t ON t.id = d.ar_title_id
--  WHERE lower(btrim(t.booking_ref)) = '7385'      -- <<< TROCAR
--  ORDER BY a.attempt_no DESC;

-- ============================================================================
-- Se o item 3 acusou falha, veja a config crua da unidade
-- (smtp_password_enc aparece cifrado: nem o service_role le a senha)
-- ============================================================================
-- SELECT hotel_id, from_name, from_email, smtp_host, smtp_port, smtp_secure,
--        smtp_user, (smtp_password_enc IS NOT NULL) AS tem_senha, reply_to,
--        active, last_test_ok, last_test_error, last_test_at
--   FROM hotel_email_config;
