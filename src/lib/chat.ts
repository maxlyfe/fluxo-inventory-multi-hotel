import { supabase } from './supabase';
import { createNotification } from './notifications';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatProfile {
  id: string;
  email?: string;
  full_name?: string | null;
  photo_url?: string | null;
}

export interface Conversation {
  id: string;
  group_id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMember {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
  profile?: ChatProfile;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  type: 'text' | 'image' | 'audio';
  media_url: string | null;
  created_at: string;
  deleted_at: string | null;
  sender?: ChatProfile;
}

export interface ConversationWithMeta extends Conversation {
  members: ConversationMember[];
  last_message: Message | null;
  unread_count: number;
  display_name: string;
  display_avatar: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function profileDisplayName(p?: ChatProfile | null): string {
  if (!p) return 'Usuário';
  return p.full_name?.trim() || p.email || 'Usuário';
}

// ─── Users do mesmo grupo ────────────────────────────────────────────────────

export async function getGroupUsers(): Promise<ChatProfile[]> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return [];

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('group_id')
    .eq('id', me.user.id)
    .single();

  if (!myProfile?.group_id) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, photo_url')
    .eq('group_id', myProfile.group_id)
    .neq('id', me.user.id)
    .order('full_name', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[chat] getGroupUsers:', error);
    return [];
  }

  // Busca emails via RPC para usar como fallback no nome de exibição
  const { data: rpcUsers } = await supabase.rpc('get_all_users_with_profile');
  const emailMap = new Map<string, string>((rpcUsers || []).map((u: any) => [u.id, u.email]));

  return (data || []).map((p: any) => ({
    id: p.id,
    full_name: p.full_name || null,
    photo_url: p.photo_url || null,
    email: emailMap.get(p.id),
  }));
}

// ─── Conversas ───────────────────────────────────────────────────────────────

export async function getOrCreateDirectConversation(otherUserId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', {
    other_user_id: otherUserId,
  });
  if (error) {
    console.error('[chat] getOrCreateDirectConversation:', error);
    throw new Error(error.message);
  }
  return data as string;
}

export async function createGroupConversation(
  name: string,
  memberIds: string[]
): Promise<Conversation | null> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return null;

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('group_id')
    .eq('id', me.user.id)
    .single();

  if (!myProfile?.group_id) return null;

  // Criar conversa
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({ group_id: myProfile.group_id, type: 'group', name, created_by: me.user.id })
    .select()
    .single();

  if (convErr || !conv) {
    console.error('[chat] createGroupConversation:', convErr);
    return null;
  }

  // Inserir membros (criador + selecionados)
  const allMembers = Array.from(new Set([me.user.id, ...memberIds]));
  await supabase.from('conversation_members').insert(
    allMembers.map(uid => ({ conversation_id: conv.id, user_id: uid }))
  );

  return conv as Conversation;
}

export async function getMyConversations(): Promise<ConversationWithMeta[]> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return [];

  // Busca conversas onde o usuário é membro
  const { data: memberRows, error: memErr } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', me.user.id);

  if (memErr || !memberRows?.length) return [];

  const convIds = memberRows.map(r => r.conversation_id);

  // Conversas com todos os membros e seus perfis
  const { data: convs, error: convErr } = await supabase
    .from('conversations')
    .select(`
      *,
      members:conversation_members(
        id, user_id, joined_at, last_read_at,
        profile:profiles(id, email, full_name, photo_url)
      )
    `)
    .in('id', convIds)
    .order('updated_at', { ascending: false });

  if (convErr || !convs) {
    console.error('[chat] getMyConversations:', convErr);
    return [];
  }

  // Buscar última mensagem e contagem de não lidas por conversa
  const result: ConversationWithMeta[] = await Promise.all(
    convs.map(async (c: any) => {
      const members = (c.members || []) as ConversationMember[];

      // Última mensagem
      const { data: lastMsgs } = await supabase
        .from('messages')
        .select('id, content, type, created_at, sender_id, sender:profiles(id, full_name, email, photo_url)')
        .eq('conversation_id', c.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      const last_message = (lastMsgs?.[0] as Message) || null;

      // Contagem de não lidas (mensagens sem read receipt do usuário atual)
      const myMember = members.find(m => m.user_id === me.user!.id);
      let unread_count = 0;
      if (myMember) {
        const since = myMember.last_read_at || '1970-01-01';
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', c.id)
          .is('deleted_at', null)
          .neq('sender_id', me.user.id)
          .gt('created_at', since);
        unread_count = count || 0;
      }

      // Nome e avatar para exibição
      let display_name = c.name || '';
      let display_avatar: string | null = null;

      if (c.type === 'direct') {
        const other = members.find((m: any) => m.user_id !== me.user!.id);
        const otherProfile = other?.profile as ChatProfile | undefined;
        display_name = profileDisplayName(otherProfile);
        display_avatar = otherProfile?.photo_url || null;
      } else {
        display_name = c.name || 'Grupo';
      }

      return {
        ...c,
        members,
        last_message,
        unread_count,
        display_name,
        display_avatar,
      } as ConversationWithMeta;
    })
  );

  return result;
}

export async function getConversationMembers(conversationId: string): Promise<ConversationMember[]> {
  const { data, error } = await supabase
    .from('conversation_members')
    .select('id, user_id, joined_at, last_read_at, profile:profiles(id, email, full_name, photo_url)')
    .eq('conversation_id', conversationId);

  if (error) {
    console.error('[chat] getConversationMembers:', error);
    return [];
  }
  return (data || []) as ConversationMember[];
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

export async function getMessages(
  conversationId: string,
  limit = 50,
  before?: string
): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select('*, sender:profiles(id, email, full_name, photo_url)')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[chat] getMessages:', error);
    return [];
  }
  return ((data || []) as Message[]).reverse();
}

export async function sendMessage(
  conversationId: string,
  content: string,
  type: 'text' | 'image' | 'audio' = 'text',
  mediaUrl?: string
): Promise<Message | null> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return null;

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: me.user.id,
      content: content || null,
      type,
      media_url: mediaUrl || null,
    })
    .select('*, sender:profiles(id, email, full_name, photo_url)')
    .single();

  if (error) {
    console.error('[chat] sendMessage:', error);
    return null;
  }

  // Notificar outros membros
  void notifyOtherMembers(conversationId, me.user.id, content, data as Message);

  return data as Message;
}

async function notifyOtherMembers(
  conversationId: string,
  senderId: string,
  content: string,
  message: Message
) {
  try {
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .neq('user_id', senderId);

    if (!members?.length) return;

    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', senderId)
      .single();

    const senderName = senderProfile?.full_name || senderProfile?.email || 'Alguém';
    const preview = content?.length > 60 ? content.slice(0, 60) + '…' : content;

    for (const m of members) {
      await createNotification({
        user_id: m.user_id,
        title: senderName,
        message: preview || '📎 Mídia',
        event_key: 'NEW_INTERNAL_MESSAGE',
        target_path: `/chat/${conversationId}`,
        related_entity_id: message.id,
        related_entity_type: 'message',
        sendPush: true,
      });
    }
  } catch (e) {
    console.error('[chat] notifyOtherMembers:', e);
  }
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function markMessagesRead(conversationId: string): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return;

  // Atualizar last_read_at do membro (cache de leitura)
  await supabase
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', me.user.id);

  // Inserir read receipts para mensagens não lidas do usuário
  const { data: unread } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .neq('sender_id', me.user.id);

  if (!unread?.length) return;

  const reads = unread.map(m => ({ message_id: m.id, user_id: me.user!.id }));
  await supabase.from('message_reads').upsert(reads, { onConflict: 'message_id,user_id' });
}

export async function getTotalUnreadCount(): Promise<number> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return 0;

  // Busca todas as conversas do usuário
  const { data: memberRows } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', me.user.id);

  if (!memberRows?.length) return 0;

  let total = 0;
  for (const row of memberRows) {
    const since = row.last_read_at || '1970-01-01';
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', row.conversation_id)
      .is('deleted_at', null)
      .neq('sender_id', me.user.id)
      .gt('created_at', since);
    total += count || 0;
  }
  return total;
}

export async function addMembersToConversation(
  conversationId: string,
  userIds: string[]
): Promise<void> {
  const inserts = userIds.map(uid => ({ conversation_id: conversationId, user_id: uid }));
  const { error } = await supabase
    .from('conversation_members')
    .upsert(inserts, { onConflict: 'conversation_id,user_id' });
  if (error) console.error('[chat] addMembersToConversation:', error);
}
