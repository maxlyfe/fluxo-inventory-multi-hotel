// src/components/financial/EmailSenderTab.tsx
// Aba "Remetente de E-mail" de /finances/regras-recebimento.
//
// Cada unidade configura a própria conta de envio. O seletor de hotel do topo do
// sistema já escopa a tela, então não precisa de rota nova.
//
// O passo a passo fica ao lado do formulário porque gerar senha de app no Google
// Workspace tem três pré-requisitos não óbvios (verificação em duas etapas,
// senha de app liberada pelo administrador, alias autorizado) e cada um deles
// falha com uma mensagem diferente do Google.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, Loader2, CheckCircle2, AlertTriangle, Send, Eye, EyeOff,
  ChevronDown, ChevronUp, ShieldCheck, HelpCircle,
} from 'lucide-react';
import {
  emailConfigService, defaultEmailConfig, type HotelEmailConfig,
} from '../../lib/emailConfigService';
import { SectionTitle } from './Fornecedores';
import { ErrorBanner, InfoBanner, isValidEmail } from './shared';

type Preset = 'google' | 'outro';

const PASSOS: { titulo: string; texto: string }[] = [
  {
    titulo: 'Escolha a conta que vai enviar',
    texto: 'Pode ser a caixa da própria unidade (por exemplo reservas@...) ou uma caixa de financeiro. ' +
      'Precisa ser uma conta real do Google Workspace, não um alias sozinho.',
  },
  {
    titulo: 'Ative a verificação em duas etapas nessa conta',
    texto: 'Em myaccount.google.com, seção Segurança. Sem isso o Google não gera senha de app.',
  },
  {
    titulo: 'Gere a senha de app',
    texto: 'Em myaccount.google.com/apppasswords, com o nome "Fluxo Cobranças". ' +
      'A senha de 16 caracteres aparece UMA única vez: copie antes de fechar.',
  },
  {
    titulo: 'Preencha aqui',
    texto: 'Escolha o preset "Google Workspace ou Gmail", informe o nome de exibição, o e-mail remetente, ' +
      'o usuário SMTP (é o mesmo e-mail da conta) e cole a senha de app.',
  },
  {
    titulo: 'Clique em "Enviar teste"',
    texto: 'O teste vai para o e-mail da sua própria conta de acesso ao sistema. Se chegar, ative o remetente.',
  },
  {
    titulo: 'Se o remetente for alias ou grupo',
    texto: 'Ele precisa estar autorizado como "Enviar e-mail como" dentro da conta do passo 1, ' +
      'senão o Google recusa com "Sender address rejected".',
  },
  {
    titulo: 'Peça SPF e DKIM ao administrador',
    texto: 'Em admin.google.com, Apps › Google Workspace › Gmail › Autenticar e-mail. ' +
      'Sem isso a cobrança tende a cair no spam do parceiro mesmo com o envio funcionando.',
  },
];

const PROBLEMAS: { erro: string; causa: string }[] = [
  {
    erro: '535 Username and Password not accepted',
    causa: 'Quase sempre a senha de app foi colada com espaços. Cole os 16 caracteres sem espaço. ' +
      'Se persistir, a senha pode ter sido revogada: gere outra.',
  },
  {
    erro: 'Não consigo gerar senha de app',
    causa: 'Falta a verificação em duas etapas na conta (passo 2), ou o administrador da organização ' +
      'desativou senhas de app em admin.google.com › Segurança.',
  },
  {
    erro: '553 Sender address rejected',
    causa: 'O e-mail remetente não está autorizado na conta que autentica. Ver o passo 6.',
  },
  {
    erro: 'A cobrança chega na caixa de spam do parceiro',
    causa: 'Falta SPF e DKIM no domínio (passo 7). O envio funciona, a entrega não.',
  },
  {
    erro: 'Preciso enviar mais de 2 mil e-mails por dia',
    causa: 'É o limite prático de uma conta do Workspace. Nesse volume, use smtp-relay.gmail.com ' +
      'configurado pelo administrador, no preset "Outro servidor SMTP".',
  },
];

export default function EmailSenderTab({ hotelId, hotelName }: { hotelId: string; hotelName?: string }) {
  const [cfg, setCfg] = useState<HotelEmailConfig>(defaultEmailConfig(hotelId));
  const [preset, setPreset] = useState<Preset>('google');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [guideOpen, setGuideOpen] = useState(true);
  const [troubleOpen, setTroubleOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const existing = await emailConfigService.get(hotelId);
      setCfg(existing ?? defaultEmailConfig(hotelId));
      if (existing && existing.smtp_host !== 'smtp.gmail.com') setPreset('outro');
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao carregar a configuração de e-mail');
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof HotelEmailConfig>(k: K, v: HotelEmailConfig[K]) =>
    setCfg(c => ({ ...c, [k]: v }));

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === 'google') {
      setCfg(c => ({ ...c, smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_secure: false }));
    }
  };

  const canSave =
    !!cfg.smtp_user && !!cfg.from_email && isValidEmail(cfg.from_email) &&
    (!!password || cfg.has_password || !cfg.active);

  const handleSave = async () => {
    if (!cfg.from_email || !isValidEmail(cfg.from_email)) {
      setError('Informe um e-mail remetente válido.'); return;
    }
    if (!cfg.smtp_user) { setError('Informe o usuário SMTP.'); return; }
    if (cfg.active && !password && !cfg.has_password) {
      setError('Informe a senha de app antes de ativar o remetente.'); return;
    }
    setSaving(true); setError(''); setInfo('');
    try {
      await emailConfigService.save({
        hotel_id: hotelId,
        smtp_host: cfg.smtp_host,
        smtp_port: cfg.smtp_port,
        smtp_secure: cfg.smtp_secure,
        smtp_user: cfg.smtp_user,
        // Senha vazia = manter a que já está gravada.
        smtp_password: password || undefined,
        from_name: cfg.from_name,
        from_email: cfg.from_email,
        reply_to: cfg.reply_to,
        active: cfg.active,
      });
      setPassword('');
      setInfo('Remetente salvo.');
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao salvar o remetente');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true); setError(''); setInfo('');
    try {
      const res = await emailConfigService.test(hotelId);
      if (res.ok) {
        setInfo(
          `Teste enviado para ${res.sent_to}. Confira a caixa de entrada e, nos detalhes da mensagem, ` +
          'se SPF e DKIM passaram antes de mandar cobrança para parceiro real.'
        );
      } else {
        setError(res.error ?? 'O teste não foi enviado.');
        if (res.auth_failure) setTroubleOpen(true);
      }
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao enviar o teste');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="py-20 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={`rounded-xl border p-4 ${
        cfg.active && cfg.has_password
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
      }`}>
        <div className="flex items-start gap-3">
          {cfg.active && cfg.has_password
            ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            {cfg.active && cfg.has_password ? (
              <>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  Remetente ativo: {cfg.from_email}
                </p>
                <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                  {cfg.last_test_at
                    ? `Último teste ${cfg.last_test_ok ? 'ok' : 'com falha'} em ${new Date(cfg.last_test_at).toLocaleString('pt-BR')}`
                    : 'Nenhum teste registrado ainda. Recomendado antes da primeira cobrança.'}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {hotelName ? `${hotelName} ainda não tem` : 'Esta unidade ainda não tem'} remetente ativo.
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  As cobranças continuam entrando na fila "Cobranças a Disparar" para envio manual.
                  Não usamos o remetente de outra unidade: são CNPJs diferentes falando com o mesmo parceiro.
                </p>
              </>
            )}
            {cfg.last_test_error && (
              <p className="text-xs text-red-700 dark:text-red-400 mt-1 break-words">
                Último erro: {cfg.last_test_error}
              </p>
            )}
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />
      <InfoBanner message={info} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Formulário */}
        <div className="lg:col-span-3 bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 p-4 space-y-4">
          <SectionTitle>Servidor de envio</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {([['google', 'Google Workspace ou Gmail'], ['outro', 'Outro servidor SMTP']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => applyPreset(k)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  preset === k
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
                    : 'dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}>
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label-sm">Servidor SMTP</label>
              <input className="input-field" value={cfg.smtp_host} disabled={preset === 'google'}
                onChange={e => set('smtp_host', e.target.value)} />
            </div>
            <div>
              <label className="label-sm">Porta</label>
              <input className="input-field" type="number" value={cfg.smtp_port} disabled={preset === 'google'}
                onChange={e => set('smtp_port', parseInt(e.target.value) || 587)} />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cfg.smtp_secure} disabled={preset === 'google'}
                  onChange={e => set('smtp_secure', e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  TLS direto (porta 465). Desmarcado usa STARTTLS na 587, que é o padrão do Workspace.
                </span>
              </label>
            </div>
          </div>

          <SectionTitle>Remetente</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-sm">Nome de exibição</label>
              <input className="input-field" value={cfg.from_name ?? ''}
                onChange={e => set('from_name', e.target.value || null)}
                placeholder={hotelName ?? 'Financeiro'} />
            </div>
            <div>
              <label className="label-sm">E-mail remetente *</label>
              <input className="input-field" type="email" value={cfg.from_email ?? ''}
                onChange={e => set('from_email', e.target.value || null)}
                placeholder="reservas@suaunidade.com.br" />
            </div>
            <div>
              <label className="label-sm">Usuário SMTP *</label>
              <input className="input-field" value={cfg.smtp_user ?? ''}
                onChange={e => set('smtp_user', e.target.value || null)}
                placeholder="a mesma conta do e-mail" />
            </div>
            <div>
              <label className="label-sm">Responder para (opcional)</label>
              <input className="input-field" type="email" value={cfg.reply_to ?? ''}
                onChange={e => set('reply_to', e.target.value || null)} />
            </div>
            <div className="col-span-2">
              <label className="label-sm">Senha de app {cfg.has_password ? '(já cadastrada)' : '*'}</label>
              <div className="flex gap-2">
                <input className="input-field flex-1" type={showPassword ? 'text' : 'password'}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={cfg.has_password ? '•••••••••••••••• (deixe vazio para manter)' : 'os 16 caracteres, sem espaços'} />
                <button type="button" onClick={() => setShowPassword(p => !p)}
                  className="px-3 py-2 border dark:border-gray-700 rounded-lg text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-start gap-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                A senha é cifrada no servidor antes de ser gravada e nunca volta para esta tela.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cfg.active} onChange={e => set('active', e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600" />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Remetente ativo (as cobranças automáticas passam a sair por aqui)
            </span>
          </label>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button onClick={handleTest} disabled={testing || !cfg.has_password}
              title={cfg.has_password ? undefined : 'Salve a senha de app antes de testar'}
              className="flex items-center gap-2 px-4 py-2 text-sm border dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar teste
            </button>
            <button onClick={handleSave} disabled={saving || !canSave}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar remetente
            </button>
          </div>
        </div>

        {/* Guia */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
            <button onClick={() => setGuideOpen(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                <Mail className="w-4 h-4 text-purple-500" /> Como liberar o envio, passo a passo
              </span>
              {guideOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {guideOpen && (
              <ol className="px-4 py-3 space-y-3">
                {PASSOS.map((p, i) => (
                  <li key={p.titulo} className="flex gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[11px] font-semibold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{p.titulo}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 overflow-hidden">
            <button onClick={() => setTroubleOpen(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                <HelpCircle className="w-4 h-4 text-amber-500" /> Quando dá erro
              </span>
              {troubleOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {troubleOpen && (
              <ul className="px-4 py-3 space-y-3">
                {PROBLEMAS.map(p => (
                  <li key={p.erro}>
                    <p className="text-xs font-mono text-gray-800 dark:text-gray-200">{p.erro}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.causa}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
