-- ============================================================================
-- Adiciona tipos de notificação para contratos de experiência a vencer
-- Necessário para que a Edge Function daily-notifications envie alertas
-- ============================================================================

INSERT INTO notification_types (event_key, description, default_message_template, target_path_template, icon)
VALUES
  (
    'EXP_CONTRACT_ENDING_SOON',
    'Contrato de experiência vencendo em breve',
    'O contrato de experiência de {employee_name} vence em {days} dias',
    '/personnel-department',
    '⏳'
  ),
  (
    'EXP_CONTRACT_ENDS_TODAY',
    'Contrato de experiência vence hoje',
    'O contrato de experiência de {employee_name} vence hoje!',
    '/personnel-department',
    '🚨'
  )
ON CONFLICT (event_key) DO UPDATE
  SET description              = EXCLUDED.description,
      default_message_template = EXCLUDED.default_message_template,
      target_path_template     = EXCLUDED.target_path_template,
      icon                     = EXCLUDED.icon;

-- Confirmar
SELECT id, event_key, description, icon FROM notification_types
WHERE event_key IN ('EXP_CONTRACT_ENDING_SOON', 'EXP_CONTRACT_ENDS_TODAY', 'EMPLOYEE_BIRTHDAY');
