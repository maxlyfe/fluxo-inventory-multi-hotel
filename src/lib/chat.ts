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
  reply_to_id: string | null;
  edited_at: string | null;
  sender?: ChatProfile;
  reply_to?: Message | null;
}

export interface MessageEdit {
  id: string;
  message_id: string;
  old_content: string;
  edited_by: string;
  edited_at: string;
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

// Busca perfis em batch — evita joins embutidos que exigem FK para public.profiles
export async function fetchProfilesBatch(userIds: string[]): Promise<Map<string, ChatProfile>> {
  if (!userIds.length) return new Map();

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, photo_url')
    .in('id', userIds);

  const map = new Map<string, ChatProfile>();
  for (const p of data || []) {
    map.set(p.id, p as ChatProfile);
  }
  return map;
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
    console.error('[chat] getGroupUsers error');
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
    console.error('[chat] getOrCreateDirectConversation error');
    throw new Error(error.message);
  }
  return data as string;
}

export async function createGroupConversation(
  name: string,
  memberIds: string[]
): Promise<Conversation | null> {
  const { data: convId, error } = await supabase.rpc('create_group_conversation', {
    p_name: name,
    p_members: memberIds,
  });

  if (error || !convId) {
    console.error('[chat] createGroupConversation error');
    return null;
  }

  // Busca os dados da conversa criada para retornar o objeto completo
  const { data: conv } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', convId)
    .single();

  return (conv as Conversation) || null;
}

export async function getMyConversations(): Promise<ConversationWithMeta[]> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return [];

  // 1. Conversas onde o usuário é membro
  const { data: memberRows, error: memErr } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', me.user.id);

  if (memErr || !memberRows?.length) return [];

  const convIds = memberRows.map(r => r.conversation_id);
  const myLastReadMap = new Map(memberRows.map(r => [r.conversation_id, r.last_read_at]));

  // 2. Dados das conversas
  const { data: convs, error: convErr } = await supabase
    .from('conversations')
    .select('*')
    .in('id', convIds)
    .order('updated_at', { ascending: false });

  if (convErr || !convs) {
    console.error('[chat] getMyConversations error');
    return [];
  }

  // 3. Membros de todas as conversas
  const { data: allMembers } = await supabase
    .from('conversation_members')
    .select('id, conversation_id, user_id, joined_at, last_read_at')
    .in('conversation_id', convIds);

  // 4. Perfis de todos os usuários envolvidos (1 query)
  const allUserIds = Array.from(new Set((allMembers || []).map((m: any) => m.user_id)));
  const profileMap = await fetchProfilesBatch(allUserIds);

  // Adicionar emails via RPC para fallback de nome
  const { data: rpcUsers } = await supabase.rpc('get_all_users_with_profile');
  const emailMap = new Map<string, string>((rpcUsers || []).map((u: any) => [u.id, u.email]));
  for (const [id, profile] of profileMap) {
    if (!profile.full_name && emailMap.has(id)) {
      profile.email = emailMap.get(id);
    }
  }

  // 5. Última mensagem e não-lidas por conversa
  const result: ConversationWithMeta[] = await Promise.all(
    convs.map(async (c: any) => {
      const members: ConversationMember[] = (allMembers || [])
        .filter((m: any) => m.conversation_id === c.id)
        .map((m: any) => ({
          ...m,
          profile: profileMap.get(m.user_id),
        }));

      // Última mensagem
      const { data: lastMsgs } = await supabase
        .from('messages')
        .select(await getMsgColumns())
        .eq('conversation_id', c.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);

      const lastMsgRaw = lastMsgs?.[0] || null;
      const last_message: Message | null = lastMsgRaw
        ? { ...lastMsgRaw, sender: profileMap.get(lastMsgRaw.sender_id) }
        : null;

      // Não-lidas
      const since = myLastReadMap.get(c.id) || '1970-01-01';
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', c.id)
        .is('deleted_at', null)
        .neq('sender_id', me.user!.id)
        .gt('created_at', since);
      const unread_count = count || 0;

      // Nome e avatar para exibição
      let display_name = c.name || '';
      let display_avatar: string | null = null;

      if (c.type === 'direct') {
        const other = members.find(m => m.user_id !== me.user!.id);
        const otherProfile = other?.profile;
        display_name = profileDisplayName(otherProfile);
        display_avatar = otherProfile?.photo_url || null;
      } else {
        display_name = c.name || 'Grupo';
      }

      return { ...c, members, last_message, unread_count, display_name, display_avatar } as ConversationWithMeta;
    })
  );

  return result;
}

export async function getConversationMembers(conversationId: string): Promise<ConversationMember[]> {
  const { data, error } = await supabase
    .from('conversation_members')
    .select('id, user_id, joined_at, last_read_at')
    .eq('conversation_id', conversationId);

  if (error) {
    console.error('[chat] getConversationMembers error');
    return [];
  }

  const userIds = (data || []).map((m: any) => m.user_id);
  const profileMap = await fetchProfilesBatch(userIds);

  return (data || []).map((m: any) => ({
    ...m,
    profile: profileMap.get(m.user_id),
  })) as ConversationMember[];
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

const MSG_COLUMNS_BASE = 'id, conversation_id, sender_id, content, type, media_url, created_at, deleted_at';
const MSG_COLUMNS_EXTENDED = 'id, conversation_id, sender_id, content, type, media_url, created_at, deleted_at, reply_to_id, edited_at';

let _hasNewColumns: boolean | null = null;
async function detectColumns(): Promise<boolean> {
  if (_hasNewColumns !== null) return _hasNewColumns;
  const { error } = await supabase
    .from('messages')
    .select('reply_to_id')
    .limit(1);
  _hasNewColumns = !error;
  return _hasNewColumns;
}

async function getMsgColumns() {
  return (await detectColumns()) ? MSG_COLUMNS_EXTENDED : MSG_COLUMNS_BASE;
}

export async function getMessages(
  conversationId: string,
  limit = 50,
  before?: string
): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select(await getMsgColumns())
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[chat] getMessages error');
    return [];
  }

  const msgs = (data || []).reverse();
  const senderIds = Array.from(new Set(msgs.map((m: any) => m.sender_id)));
  const profileMap = await fetchProfilesBatch(senderIds);

  // Resolve reply_to references
  const replyIds = msgs.map((m: any) => m.reply_to_id).filter(Boolean);
  let replyMap = new Map<string, Message>();
  if (replyIds.length > 0) {
    const { data: replies } = await supabase
      .from('messages')
      .select(await getMsgColumns())
      .in('id', replyIds);
    const replySenderIds = Array.from(new Set((replies || []).map((r: any) => r.sender_id)));
    const replyProfileMap = replySenderIds.length > 0
      ? await fetchProfilesBatch(replySenderIds.filter(id => !profileMap.has(id)))
      : new Map<string, ChatProfile>();
    const combinedProfiles = new Map([...profileMap, ...replyProfileMap]);
    for (const r of replies || []) {
      replyMap.set(r.id, { ...r, sender: combinedProfiles.get(r.sender_id) } as Message);
    }
  }

  return msgs.map((m: any) => ({
    ...m,
    sender: profileMap.get(m.sender_id),
    reply_to: m.reply_to_id ? replyMap.get(m.reply_to_id) || null : null,
  })) as Message[];
}

export async function sendMessage(
  conversationId: string,
  content: string,
  type: 'text' | 'image' | 'audio' = 'text',
  mediaUrl?: string,
  replyToId?: string
): Promise<Message | null> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return null;

  const hasNew = await detectColumns();
  const insertPayload: Record<string, unknown> = {
    conversation_id: conversationId,
    sender_id: me.user.id,
    content: content || null,
    type,
    media_url: mediaUrl || null,
  };
  if (hasNew) insertPayload.reply_to_id = replyToId || null;

  const { data, error } = await supabase
    .from('messages')
    .insert(insertPayload)
    .select(await getMsgColumns())
    .single();

  if (error) {
    console.error('[chat] sendMessage error');
    return null;
  }

  const profileMap = await fetchProfilesBatch([me.user.id]);
  const msg = { ...data, sender: profileMap.get(me.user.id) } as Message;

  void notifyOtherMembers(conversationId, me.user.id, content, msg);

  return msg;
}

export async function editMessage(
  messageId: string,
  newContent: string
): Promise<boolean> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return false;

  // Get current content for history
  const { data: current } = await supabase
    .from('messages')
    .select('content, sender_id')
    .eq('id', messageId)
    .single();

  if (!current || current.sender_id !== me.user.id) return false;

  const hasNew = await detectColumns();

  if (hasNew) {
    await supabase.from('message_edits').insert({
      message_id: messageId,
      old_content: current.content || '',
      edited_by: me.user.id,
    });
  }

  const updatePayload: Record<string, unknown> = { content: newContent };
  if (hasNew) updatePayload.edited_at = new Date().toISOString();

  const { error } = await supabase
    .from('messages')
    .update(updatePayload)
    .eq('id', messageId)
    .eq('sender_id', me.user.id);

  return !error;
}

export async function deleteMessage(messageId: string): Promise<boolean> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return false;

  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('sender_id', me.user.id);

  return !error;
}

export async function getMessageEditHistory(messageId: string): Promise<MessageEdit[]> {
  if (!(await detectColumns())) return [];
  const { data, error } = await supabase
    .from('message_edits')
    .select('*')
    .eq('message_id', messageId)
    .order('edited_at', { ascending: false });

  if (error) return [];
  return (data || []) as MessageEdit[];
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

    const profileMap = await fetchProfilesBatch([senderId]);
    const senderProfile = profileMap.get(senderId);
    const senderName = profileDisplayName(senderProfile);
    const preview = content?.length > 60 ? content.slice(0, 60) + '…' : content;

    for (const m of members) {
      await createNotification({
        user_id: m.user_id,
        title: senderName,
        message: preview || '📎 Mídia',
        event_key: 'NEW_INTERNAL_MESSAGE',
        target_path: `/chat`,
        related_entity_id: message.id,
        related_entity_type: 'message',
        sendPush: true,
      });
    }
  } catch {
    // falha silenciosa — não interrompe o envio da mensagem
  }
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function markMessagesRead(conversationId: string): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return;

  await supabase
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', me.user.id);

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
  const { error } = await supabase.rpc('add_conversation_members', {
    p_conversation_id: conversationId,
    p_user_ids: userIds,
  });
  if (error) {
    console.error('[chat] addMembersToConversation error');
    throw new Error(error.message);
  }
}

export async function removeMemberFromConversation(
  conversationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) {
    console.error('[chat] removeMemberFromConversation error');
    throw new Error(error.message);
  }
}
