import { supabase } from './supabase';
import { sendPushNotificationToUser } from './notifications';

// ─── Verifica se o usuário está dentro do turno agora ────────────────────────
// Retorna true se:
//   • O filtro está desativado (notify_work_hours_only = false)
//   • Não há escala cadastrada para hoje (folga, ausência etc.) → não bloqueia
//   • A hora atual está dentro do turno cadastrado
export async function isUserInWorkHours(userId: string): Promise<boolean> {
  // 1. Checar preferência
  // maybeSingle: se a linha não estiver visível (sessão sem JWT válido, RLS),
  // .single() devolvia 406 e poluía o console — aqui vira null e cai no default.
  const { data: profile } = await supabase
    .from('profiles')
    .select('notify_work_hours_only')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.notify_work_hours_only === false) return true; // filtro explicitamente desativado
  // Default: filtro ativado (true ou null/undefined)

  // 2. Buscar funcionário vinculado
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!employee) return true; // sem vínculo com funcionário → não bloqueia

  // 3. Buscar turno de hoje
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data: entry } = await supabase
    .from('schedule_entries')
    .select('shift_start, shift_end')
    .eq('employee_id', employee.id)
    .eq('day_date', today)
    .in('entry_type', ['shift', 'meia_dobra', 'transfer'])
    .maybeSingle();

  // Sem escala hoje → não bloqueia (folga, ausência, não cadastrado)
  if (!entry?.shift_start || !entry?.shift_end) return true;

  // 4. Comparar hora atual com o turno
  // Usar hora local (BRT = UTC-3). Supabase retorna horários como "HH:MM:SS"
  const now = new Date();
  const [startH, startM] = entry.shift_start.split(':').map(Number);
  const [endH, endM] = entry.shift_end.split(':').map(Number);

  // Minutos do dia baseados em horário LOCAL do dispositivo/servidor
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Turno normal (ex: 07:00 – 15:00) ou turno vira noite (ex: 23:00 – 07:00)
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  } else {
    // Turno cruza meia-noite (ex: 23:00 – 07:00)
    return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  }
}

// ─── Retorna o turno do dia atual para um employee ID ────────────────────────
export async function getTodayShift(
  employeeId: string
): Promise<{ shift_start: string; shift_end: string } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('schedule_entries')
    .select('shift_start, shift_end')
    .eq('employee_id', employeeId)
    .eq('day_date', today)
    .in('entry_type', ['shift', 'meia_dobra', 'transfer'])
    .maybeSingle();
  return data || null;
}

// ─── Entrega pushes diferidos ao usuário ────────────────────────────────────
// Chamado quando o turno começa. Envia pushes que foram represados.
export async function deliverDeferredNotifications(userId: string): Promise<void> {
  const { data: deferred } = await supabase
    .from('notifications')
    .select('id, title, message, target_path, notification_types(event_key)')
    .eq('user_id', userId)
    .eq('push_deferred', true)
    .eq('is_read', false)
    .order('created_at', { ascending: true });

  if (!deferred?.length) return;

  const count = deferred.length;

  if (count > 5) {
    // Resumo único
    await sendPushNotificationToUser(userId, 'Notificações pendentes', `Você tem ${count} notificações que chegaram fora do seu horário de trabalho.`, {
      url: '/notifications',
    });
  } else {
    // Enviar uma por uma
    for (const n of deferred) {
      const eventKey = (n.notification_types as any)?.event_key || '';
      await sendPushNotificationToUser(
        userId,
        n.title || 'Notificação',
        n.message || '',
        {
          notificationId: n.id,
          url: n.target_path || '/',
          targetPath: n.target_path || '/',
        }
      );
      // Pequena pausa para não sobrecarregar FCM
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Marcar todos como não-diferidos (push já entregue)
  await supabase
    .from('notifications')
    .update({ push_deferred: false })
    .eq('user_id', userId)
    .eq('push_deferred', true);
}
