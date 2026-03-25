// src/pages/LegalPages.tsx
// Páginas legais exigidas pela Meta para WhatsApp Business API

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, FileText, Trash2 } from 'lucide-react';

const COMPANY = 'LyFe Hoteles';
const DOMAIN = 'meridiana.netlify.app';
const EMAIL = 'contato@lyfehoteles.com.br';

function LegalLayout({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link to="/" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Icon className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h1>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 md:p-8 text-gray-700 dark:text-gray-300 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-gray-900 [&_h2]:dark:text-white [&_h2]:mb-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-800 [&_h3]:dark:text-gray-100 [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_a]:text-blue-600 [&_a]:underline">
          {children}
        </div>
        <p className="text-center text-xs text-gray-400 mt-8">
          {COMPANY} &middot; {DOMAIN} &middot; Última atualização: Março 2026
        </p>
      </main>
    </div>
  );
}

// ── Política de Privacidade ──────────────────────────────────────────────────

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Política de Privacidade" icon={Shield}>
      <h2>Política de Privacidade</h2>
      <p><strong>{COMPANY}</strong> (&quot;nós&quot;, &quot;nosso&quot;) opera o sistema de gestão hoteleira disponível em <strong>{DOMAIN}</strong>. Esta política descreve como coletamos, usamos e protegemos suas informações.</p>

      <h3>1. Informações Coletadas</h3>
      <ul>
        <li><strong>Dados de conta:</strong> nome, e-mail, telefone fornecidos no cadastro.</li>
        <li><strong>Dados de uso:</strong> páginas acessadas, ações realizadas no sistema, logs de atividade.</li>
        <li><strong>Dados de comunicação:</strong> mensagens enviadas e recebidas via integração WhatsApp Business API, incluindo número de telefone, conteúdo de templates e status de entrega.</li>
        <li><strong>Dados de fornecedores:</strong> nome da empresa, nome do contato, número WhatsApp, e-mail.</li>
      </ul>

      <h3>2. Uso das Informações</h3>
      <ul>
        <li>Gerenciar operações hoteleiras (inventário, compras, manutenção, governança).</li>
        <li>Enviar notificações operacionais via WhatsApp Business API (cotações, aprovações de compras).</li>
        <li>Gerar relatórios internos de gestão.</li>
        <li>Melhorar a experiência e funcionalidade do sistema.</li>
      </ul>

      <h3>3. Compartilhamento de Dados</h3>
      <p>Não vendemos, alugamos ou compartilhamos dados pessoais com terceiros, exceto:</p>
      <ul>
        <li><strong>Meta (WhatsApp Business API):</strong> para envio e recebimento de mensagens conforme nossa integração.</li>
        <li><strong>Supabase:</strong> provedor de infraestrutura e banco de dados.</li>
        <li><strong>Google (Firebase):</strong> para notificações push.</li>
        <li><strong>Obrigação legal:</strong> quando exigido por lei ou ordem judicial.</li>
      </ul>

      <h3>4. Armazenamento e Segurança</h3>
      <p>Os dados são armazenados em servidores seguros (Supabase, região sa-east-1) com criptografia em trânsito (TLS) e em repouso. O acesso é controlado por autenticação e permissões baseadas em perfis (RBAC).</p>

      <h3>5. Retenção de Dados</h3>
      <p>Mantemos os dados enquanto sua conta estiver ativa ou pelo tempo necessário para cumprir obrigações legais. Logs de mensagens WhatsApp são mantidos para fins de auditoria.</p>

      <h3>6. Seus Direitos (LGPD)</h3>
      <p>Conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018), você tem direito a:</p>
      <ul>
        <li>Acessar, corrigir ou excluir seus dados pessoais.</li>
        <li>Revogar consentimento a qualquer momento.</li>
        <li>Solicitar portabilidade dos dados.</li>
      </ul>
      <p>Para exercer seus direitos, entre em contato: <strong>{EMAIL}</strong></p>

      <h3>7. Contato</h3>
      <p>Para dúvidas sobre esta política: <strong>{EMAIL}</strong></p>
    </LegalLayout>
  );
}

// ── Termos de Serviço ────────────────────────────────────────────────────────

export function TermsOfService() {
  return (
    <LegalLayout title="Termos de Serviço" icon={FileText}>
      <h2>Termos de Serviço</h2>
      <p>Ao acessar e usar o sistema <strong>{COMPANY}</strong> disponível em <strong>{DOMAIN}</strong>, você concorda com os seguintes termos.</p>

      <h3>1. Descrição do Serviço</h3>
      <p>O sistema é uma plataforma de gestão hoteleira que inclui módulos de inventário, compras, governança, manutenção, departamento pessoal, recepção, reservas e integrações com WhatsApp Business API e Erbon PMS.</p>

      <h3>2. Acesso e Conta</h3>
      <ul>
        <li>O acesso é restrito a usuários autorizados pelo administrador do hotel.</li>
        <li>Cada usuário é responsável por manter suas credenciais seguras.</li>
        <li>Compartilhamento de contas não é permitido.</li>
      </ul>

      <h3>3. Uso Aceitável</h3>
      <p>Você concorda em:</p>
      <ul>
        <li>Usar o sistema apenas para fins operacionais legítimos do hotel.</li>
        <li>Não enviar spam ou mensagens não solicitadas via integração WhatsApp.</li>
        <li>Não tentar acessar dados de outros hotéis ou usuários sem autorização.</li>
        <li>Não realizar engenharia reversa ou tentativas de acesso não autorizado.</li>
      </ul>

      <h3>4. Integração WhatsApp</h3>
      <p>O uso da integração WhatsApp Business API está sujeito aos <a href="https://www.whatsapp.com/legal/business-terms" target="_blank" rel="noopener noreferrer">Termos Comerciais do WhatsApp</a> e à <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noopener noreferrer">Política Comercial do WhatsApp</a>. O envio de mensagens é limitado a comunicações operacionais com fornecedores e parceiros.</p>

      <h3>5. Propriedade Intelectual</h3>
      <p>O sistema, incluindo código, design e conteúdo, é propriedade de {COMPANY}. Os dados inseridos pelos usuários permanecem propriedade do respectivo hotel.</p>

      <h3>6. Limitação de Responsabilidade</h3>
      <p>O sistema é fornecido &quot;como está&quot;. Não nos responsabilizamos por perdas decorrentes de indisponibilidade temporária, erros de integração com serviços terceiros (Meta, Erbon, Firebase) ou uso inadequado do sistema.</p>

      <h3>7. Alterações</h3>
      <p>Reservamos o direito de modificar estes termos. Alterações significativas serão comunicadas via sistema.</p>

      <h3>8. Contato</h3>
      <p>Dúvidas: <strong>{EMAIL}</strong></p>
    </LegalLayout>
  );
}

// ── Exclusão de Dados ────────────────────────────────────────────────────────

export function DataDeletion() {
  return (
    <LegalLayout title="Exclusão de Dados" icon={Trash2}>
      <h2>Instruções para Exclusão de Dados</h2>
      <p>Conforme a LGPD e as políticas da Meta, você pode solicitar a exclusão dos seus dados pessoais do sistema <strong>{COMPANY}</strong>.</p>

      <h3>Como solicitar a exclusão</h3>
      <ol>
        <li>Envie um e-mail para <strong>{EMAIL}</strong> com o assunto &quot;Solicitação de Exclusão de Dados&quot;.</li>
        <li>Inclua no e-mail: seu nome completo, e-mail cadastrado e o hotel ao qual está associado.</li>
        <li>Receberá confirmação em até 48 horas úteis.</li>
        <li>A exclusão será concluída em até 15 dias úteis após a confirmação.</li>
      </ol>

      <h3>Dados que serão excluídos</h3>
      <ul>
        <li>Dados de perfil (nome, e-mail, foto).</li>
        <li>Histórico de ações no sistema.</li>
        <li>Tokens de notificação push.</li>
        <li>Registros de mensagens WhatsApp associados ao seu usuário.</li>
      </ul>

      <h3>Dados que podem ser retidos</h3>
      <p>Alguns dados podem ser retidos por obrigação legal ou contratual:</p>
      <ul>
        <li>Registros fiscais e financeiros (conforme legislação brasileira).</li>
        <li>Logs de auditoria necessários para compliance.</li>
      </ul>

      <h3>Contato</h3>
      <p>Para dúvidas sobre exclusão de dados: <strong>{EMAIL}</strong></p>
    </LegalLayout>
  );
}
