# LyFe Hoteles (Fluxo) — Gestão Hoteleira Multi-Tenant

Ecossistema SaaS completo de gestão operacional para **grupos hoteleiros**: da cozinha à diretoria, em uma única plataforma — web e Android.

> 🌐 Produção: [lyfehoteles.com.br](https://lyfehoteles.com.br)

---

## 📖 Sobre o Projeto

O LyFe Hoteles centraliza toda a operação de uma rede de hotéis: estoque, compras, pessoas, manutenção, recepção/PMS, ponto de venda, eventos e indicadores de diretoria. O sistema é **multi-tenant**: cada cliente é um *grupo hoteleiro* isolado, com seus próprios hotéis e usuários, acessado por um link privado (`/grupo/<slug>`). Um painel exclusivo do desenvolvedor permite criar grupos, vender/adicionar unidades e gerenciar o ciclo de vida de cada cliente.

## 🏢 Arquitetura Multi-Tenant (Grupos)

- **Grupos hoteleiros isolados** — cada cliente tem seus hotéis e usuários; um grupo nunca vê (nem interconecta com) outro.
- **Login por grupo** — `lyfehoteles.com.br/grupo/<slug>/login` (e-mail/senha ou Google); a conta é validada contra o grupo da URL.
- **Acesso por hotel** — dentro do grupo, cada usuário recebe acesso a hotéis individualmente; admins do grupo veem todas as unidades ativas.
- **Roteamento prefixado** — toda a navegação vive sob `/grupo/<slug>/...` via basename dinâmico do React Router.
- **Landing pública** — a raiz do domínio é uma página de marketing; nenhum dado de cliente é exposto a visitantes.
- **Painel do dev** (`/lyfe-dev`) — CRUD de grupos, atribuição de unidades, ocultar/reativar (preserva histórico) e exclusão com confirmação.

## ✨ Módulos Principais

| Módulo | Destaques |
|---|---|
| 📦 **Estoque & Inventário** | Contagem física **offline-first** (autosave local + sincronização ao voltar a internet), rascunhos acumulativos, contagem delegada por link, porcionamento, importação Excel, transferências entre hotéis do grupo com valor |
| 🛒 **Compras & Orçamentos** | Listas automáticas, cotação pública para fornecedores, aprovação/autorização, compra multi-hotel, integração WhatsApp |
| 👥 **Departamento Pessoal** | Funcionários, escalas (com edição pública por link), NR-1, exames, aniversariantes, contratos de experiência com alertas automáticos |
| 🧑‍💼 **RH** | Vagas com candidatura pública, candidatos, analytics |
| 🔧 **Manutenção** | Chamados por QR Code (acesso anônimo), equipamentos, checklists integrados à governança |
| 🛏️ **Recepção & PMS** | Integração Erbon (reservas, rack, in-house, receita), web check-in para hóspedes (totem/celular, multilíngue) com FNRH assinada |
| 💳 **PDV & Financeiro** | Vendas, consumos, livro-razão integrado às movimentações de estoque |
| 📅 **Eventos & Agenda** | Calendário corporativo com convites (aceitar/recusar), audiência por rede/hotel/setor/pessoa e lembretes automáticos (criação, 24h, manhã, ~1h antes) |
| 📊 **Diretoria & BI** | KPIs com metas mensais, comparativo entre unidades, relatórios de performance |
| 🔔 **Notificações** | Sino in-app + **push nativo** (chega com o app fechado), preferências por tipo/hotel/setor, crons diários (aniversários, contratos) |

## 🚀 Stack

**Frontend** — React 18 · TypeScript · Vite · Tailwind CSS · React Router · Recharts · Lucide

**Backend (BaaS)** — Supabase: PostgreSQL (RLS), Auth (e-mail + Google OAuth/PKCE), Edge Functions (Deno), Realtime, Storage · pg_cron + pg_net para automações

**Mobile** — Capacitor (Android): 2 APKs (`LyFe Hoteles` e `LyFe Web Check-in`), push via FCM nativo, auto-update por manifest

**Integrações** — Erbon PMS · WhatsApp (Meta Cloud API) · Firebase Cloud Messaging · Google Generative AI

## 🔐 Segurança

- Row-Level Security no Postgres controla a visibilidade de hotéis por grupo e por concessão individual de acesso.
- Gestão de unidades (criar/ocultar/excluir hotéis e grupos) restrita ao perfil de desenvolvedor, com proteção por trigger no banco.
- Edge Functions com service role sempre validam o chamador (JWT) antes de agir; segredos só em variáveis de ambiente/secrets.
- Links sensíveis (redefinição de senha) expiram em 5 minutos e são de uso único.
- RBAC granular por módulos via perfis customizáveis (`custom_roles`), gerenciados pela UI.

## 🛠️ Executando Localmente

**Pré-requisitos:** Node.js 18+, conta Supabase.

```bash
git clone https://github.com/maxlyfe/fluxo-inventory-multi-hotel.git
cd fluxo-inventory-multi-hotel
npm install
```

Crie um `.env` com as chaves do seu projeto Supabase:

```env
VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=<chave-anon>
# Firebase (push notifications)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...
```

### Comandos

```bash
npm run dev        # Servidor de desenvolvimento (Vite)
npm run build      # Build de produção (tsc + vite) — é o que o CI/Netlify roda
npm run lint       # ESLint
npm run test       # Vitest
npx tsc --noEmit   # Type-check
npm run build:apk  # Build do APK Android (LyFe Hoteles)
```

### Backend (Supabase)

1. **Migrações** — aplique os arquivos de `supabase/migrations/` (em ordem) no SQL Editor.
2. **Edge Functions** — deploy das funções em `supabase/functions/` (`admin-user-actions`, `send-fcm-notification`, `password-reset` com `--no-verify-jwt`, `daily-notifications`, `event-reminders`, etc.).
3. **Crons** — agende `daily-notifications` (diário) e `event-reminders` (horário) com os scripts de `docs/sql-scripts/` (a service role key é colada no SQL Editor — nunca commitada).
4. **Auth** — em *URL Configuration*, cadastre `https://<seu-dominio>/**` e o deep link do APK.

## 📱 Android

O APK é um wrapper Capacitor que carrega o site em produção — mudanças de UI/lógica web **não exigem rebuild**. Rebuild apenas para nova versão, plugins nativos ou config do Capacitor (`npm run build:apk`; release: bump em `android/app/build.gradle` + `public/update-manifest.json`).

## 📄 Licença

Este projeto está sob a licença MIT.
