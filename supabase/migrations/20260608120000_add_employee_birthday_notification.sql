-- ============================================================================
-- Adiciona tipo de notificação para aniversário de colaborador
-- COMO USAR: Supabase Dashboard → SQL Editor → cole e rode
-- ============================================================================

INSERT INTO notification_types (event_key, description, default_message_template, target_path_template, icon)
VALUES (
  'EMPLOYEE_BIRTHDAY',
  'Aniversário de colaborador',
  '{employee_name} faz {age} anos hoje! 🎂',
  '/personnel-department/beneficios/aniversarios',
  '🎂'
)
ON CONFLICT (event_key) DO UPDATE
  SET description              = EXCLUDED.description,
      default_message_template = EXCLUDED.default_message_template,
      target_path_template     = EXCLUDED.target_path_template,
      icon                     = EXCLUDED.icon;

-- Confirmar inserção
SELECT id, event_key, description FROM notification_types WHERE event_key = 'EMPLOYEE_BIRTHDAY';
