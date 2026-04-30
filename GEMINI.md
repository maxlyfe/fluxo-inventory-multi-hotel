# Fluxo — Regras e Pontos Importantes do Projeto

## 1. Visao Geral

**Sistema**: Fluxo — Ecossistema de gestao operacional para rede hoteleira
**Stack**: React 18 + TypeScript + Vite + Tailwind CSS + Supabase (PostgreSQL + Auth + Edge Functions)
**Deploy**: Netlify
**Supabase Project ID**: `bnmyflgyrlskhljrbyfc`

### Estrutura de Pastas

```
src/
├── App.tsx                    # Rotas e providers
├── main.tsx                   # Entry point
├── context/                   # React Contexts (Auth, Hotel, Theme, Notification)
├── hooks/                     # Custom hooks (usePermissions, useFormatters, etc.)
├── lib/                       # Services e utilitarios (supabase, erbon, whatsapp, navigation)
├── pages/                     # Paginas organizadas por modulo
│   ├── admin/                 # Painel admin (roles, setores, integracao)
│   ├── commercial/            # Comercial (clientes corp, grupos, metas)
│   ├── directors/             # Dashboard diretoria
│   ├── diretoria/             # Alternativa/Extra para diretoria
│   ├── dp/                    # Departamento Pessoal (funcionarios, escalas, NR-1)
│   ├── erbon/                 # Integracao Erbon PMS (check-in, rack, reservas)
│   ├── management/            # Gerencia (documentos, licencas)
│   ├── pdv/                   # Ponto de Venda (consumos, vendas)
│   ├── portal/                # Portal do colaborador
│   ├── reception/             # Recepção e Rack
│   ├── rh/                    # RH (vagas, candidatos, analytics)
│   ├── webcheckin/            # Módulo de Web Check-in
│   └── ...                    # Diversas páginas na raiz de /pages (Inventory, SectorStock, etc.)
├── components/                # Componentes reutilizaveis
├── types/                     # Interfaces TypeScript
├── utils/                     # Funcoes utilitarias
└── data/                      # Dados estaticos
```

---

## 2. Principio Fundamental

> **NADA hardcoded ou mockado. Tudo editavel, criavel e deletavel por admins.**

- Tipos de evento, categorias de documento, tipos de ocorrencia, setores — tudo vem de tabelas CRUD
- Opcoes de select/dropdown sao dinamicas, carregadas do Supabase
- Admins gerenciam via UI (painel admin), nao via codigo

---

## 3. Arquitetura Multi-Hotel

### Contexto (`src/context/HotelContext.tsx`)
- Todo dado e scopado por `hotel_id`
- `useHotel()` fornece `{ selectedHotel, setSelectedHotel }`
- Hotel salvo em `localStorage` e verificado contra o banco

### Regra de Ouro
- **Toda tabela** que contem dados operacionais tem coluna `hotel_id UUID REFERENCES hotels(id)`
- **Toda query** filtra por `hotel_id` do hotel selecionado
- Excecoes: tabelas de rede (`hotel_id NULL` = aplica a todos)

---

## 4. Sistema de Permissoes

### Arquivo: `src/hooks/usePermissions.ts`

**Estrutura**:
- `custom_roles` tabela: `{ id, name, permissions: string[], color }`
- `profiles` tabela: `{ custom_role_id }` → join com `custom_roles`
- `MODULES[]`: array de modulos disponiveis (key, label, description, group)

**Modulos atuais** (20+ core):
`inventory`, `purchases`, `reports`, `authorizations`, `stock`, `finances`, `management`,
`personnel_department`, `maintenance`, `reservations`, `reception`, `employee_portal`,
`recruitment`, `cpf_registry`, `nr1_compliance`, `hr_analytics`, `hotel_documents`,
`commercial`, `pdv`, `diretoria`

**Admin**: `roles_management`, `sectors_management`, `hotels_management`, `users_management`

**Modulos dinamicos**: `sector_stock:UUID`, `contacts:UUID`

**Uso**:
```tsx
const { can, canAny, canAll, isAdmin, isDev } = usePermissions();
if (can('inventory')) { /* mostrar */ }
if (canAny(['purchases', 'inventory'])) { /* mostrar */ }
```

**Roles admin/dev**: bypass total de permissoes

### PrivateRoute (`src/components/PrivateRoute.tsx`)
```tsx
<Route path="/rota" element={
  <PrivateRoute module="nome_modulo">
    <Pagina />
  </PrivateRoute>
} />
```
Props: `module`, `modules` (OR), `adminOnly`, `customCheck`

---

## 5. Navegacao

### Arquivo: `src/lib/navigationConfig.ts`

Toda navegacao e centralizada no array `NAV_GROUPS`:
```ts
{
  key: 'grupo_unico',
  label: 'Nome Exibido',
  icon: LucideIcon,
  module: 'permissao_necessaria',
  activePrefixes: ['/rota1', '/rota2'],
  items: [
    { module: 'permissao', label: 'Item', href: '/rota', icon: Icon, color: '#hex' }
  ]
}
```

**Setores dinamicos**: `dynamicKey: 'stockSectors'` injeta setores do usuario no menu

---

## 6. Padroes de Codigo

### Naming
- **Componentes**: PascalCase (`NewProductModal.tsx`)
- **Hooks**: `use` prefix (`usePermissions.ts`)
- **Funcoes**: camelCase (`handleSubmit`, `loadData`)
- **Constantes**: SCREAMING_SNAKE (`MODULES`, `NAV_GROUPS`)
- **Tipos**: PascalCase (`AppUser`, `NavGroup`)

### Inputs Decimais (Formato Brasileiro)
**CRITICO**: Usuarios digitam `3,5` (virgula) no Brasil.

**Regras**:
1. Usar `type="text" inputMode="decimal"` — NUNCA `type="number"` para campos que aceitam decimal
2. `type="number"` rejeita virgula no browser
3. O valor no input deve ser uma **string** durante a digitacao
4. Converter para numero somente no **submit/blur**, nunca no `onChange`
5. Se o state e numerico, adicionar campo `_display` string para o input
6. Toda conversao: `useFormatters().parseNumber(value)` — NUNCA `parseFloat` manual ou `parseInt`

**Exemplo correto**:
```tsx
// State como string
const [quantity, setQuantity] = useState('0');
const { parseNumber } = useFormatters();

// Input
<input type="text" inputMode="decimal" value={quantity}
  onChange={(e) => setQuantity(e.target.value)} />

// No submit
const num = parseNumber(quantity);
```

**Exemplo com state numerico + display**:
```tsx
interface Item { quantity: number; quantity_display?: string; }
const { parseNumber } = useFormatters();

// onChange
updatedItem.quantity = parseNumber(v);
updatedItem.quantity_display = v;
```
// Input
value={item.quantity_display ?? String(item.quantity)}
```

### Formatacao de Dados
- **Moeda**: `useFormatters().formatCurrency(value)` → `R$ 1.234,56`
- **Data**: Formato `dd/mm/yyyy` (pt-BR)
- **Porcentagem**: `10,00%` com virgula

### Padrao de Queries Supabase
```ts
const { data, error } = await supabase
  .from('tabela')
  .select('campos')
  .eq('hotel_id', selectedHotel.id)
  .order('nome');
if (error) throw error;
```

### Padrao de CRUD
- Modal generico `<Modal>` para formularios
- Toast notification via `addNotification('Mensagem', 'success' | 'error')`
- Loading state com spinner durante operacoes
- Sempre try/catch com mensagem de erro para o usuario

---

## 7. Banco de Dados (Supabase)

### Convencoes de Tabelas
- UUID primary key: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- Multi-hotel: `hotel_id UUID REFERENCES hotels(id)`
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`
- Soft delete quando necessario: `is_active BOOLEAN DEFAULT true`
- Status como TEXT (nao enum): facilita extensao

### Tipos de Colunas
- **Quantidades**: `NUMERIC` (nao integer) — suporta decimais como 3.5kg
- **Precos/valores**: `NUMERIC`
- **Datas**: `DATE` para data, `TIMESTAMPTZ` para data+hora
- **Arrays**: `TEXT[]` para listas simples, `JSONB` para estruturas complexas

### RLS (Row-Level Security)
Padrao para todas as tabelas:
```sql
ALTER TABLE tabela ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON tabela FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert" ON tabela FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update" ON tabela FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete" ON tabela FOR DELETE TO authenticated USING (true);
```

### Indices
- Sempre criar indice em `hotel_id`
- Indices em campos de filtro frequente (status, dates)

---

## 8. Dark Mode

### Implementacao
- **Tailwind**: `darkMode: 'class'` no `tailwind.config.js`
- **Toggle**: `ThemeContext.tsx` → `localStorage('theme')` → classe `dark` no `<html>`
- **Uso**: Toda classe visual precisa de variante `dark:`

### Cores Padrao
```
Fundo:       bg-gray-50     dark:bg-gray-900
Card:        bg-white       dark:bg-gray-800
Borda:       border-gray-200 dark:border-gray-700
Texto:       text-gray-900  dark:text-white
Texto sec:   text-gray-500  dark:text-gray-400
Input:       bg-white       dark:bg-gray-700
Input borda: border-gray-300 dark:border-gray-600
```

---

## 9. Integracoes

### Erbon PMS (`src/lib/erbonService.ts`)
- Config por hotel em `erbon_hotel_config`
- Proxy: Dev → Vite proxy, Prod → Netlify Function
- Mapeamentos: `erbon_product_mappings`, `erbon_sector_mappings`
- Dados: reservas, check-in/out, in-house, rack, receita

### WhatsApp (`src/lib/whatsappService.ts`)
- Meta Cloud API via `whatsapp_configs`
- Templates: `budget_link_single`, `budget_link_group`, `purchase_approved`
- Contatos: `supplier_contacts` com categorias
- Proxy: Netlify Function
- Formato telefone BR: `55DDxxxxxxxxxx`

### Firebase Cloud Messaging (`src/lib/firebase.ts`)
- Push notifications via FCM
- Tokens em `fcm_tokens` tabela
- Edge Function `send-fcm-notification` para envio
- Hook: `usePushNotifications.ts`

### Notificacoes (`src/lib/notifications.ts`)
- Tabelas: `notification_types`, `notifications`, `user_notification_preferences`
- Triggers em `notificationTriggers.ts`
- Eventos: requisicao, entrega, rejeicao, contrato expirando, documento vencendo

---

## 10. Checklist para Novos Modulos

### 1. Banco de Dados
- [ ] Criar tabelas com `hotel_id`, timestamps, RLS
- [ ] Colunas de quantidade como `NUMERIC` (nao integer)
- [ ] Indices em `hotel_id` e campos de filtro
- [ ] Inserir `notification_types` se aplicavel

### 2. Permissoes (`src/hooks/usePermissions.ts`)
- [ ] Adicionar novo modulo em `MODULES[]` com key, label, description, group

### 3. Rotas (`src/App.tsx`)
- [ ] Import lazy/direto do componente
- [ ] `<Route>` com `<PrivateRoute module="key">`

### 4. Navegacao (`src/lib/navigationConfig.ts`)
- [ ] Novo grupo ou item em `NAV_GROUPS`
- [ ] Icons do Lucide React
- [ ] `activePrefixes` corretos

### 5. Pagina
- [ ] Dark mode completo (`dark:` em tudo)
- [ ] Responsivo (`sm:`, `md:`, `lg:`)
- [ ] Filtro por `hotel_id` em todas as queries
- [ ] Loading states e error handling
- [ ] Toast notifications para sucesso/erro
- [ ] Inputs decimais com `type="text" inputMode="decimal"`

### 6. Verificacao
- [ ] `npx tsc --noEmit` sem erros
- [ ] `npm run build` sem erros
- [ ] CRUD funcional (criar, ler, editar, deletar)
- [ ] Dark mode visual OK
- [ ] Filtro por hotel funcional
- [ ] Permissao bloqueando acesso corretamente

---

## 11. Modulos do Sistema (Estado Atual)

| Modulo | Paginas Principais | Permissao |
|--------|-------------------|-----------|
| Inventario | Inventory, SectorStock, PurchaseOrders | `inventory`, `purchases`, `stock` |
| DP | DPEmployees, DPSchedule, NR1Dashboard | `personnel_department`, `nr1_compliance` |
| RH | JobOpenings, Candidates, HRAnalytics | `recruitment`, `hr_analytics` |
| Manutencao | MaintenanceDashboard, Equipment | `maintenance` |
| Erbon/Recepcao | CheckIn, CheckOut, RoomRack, Planning | `reservations`, `reception` |
| Comercial | CorporateClients, GroupBookings, Revenue | `commercial` |
| Financeiro | FinancialManagement, BudgetAnalysis | `finances` |
| PDV | PDV, Historico de Vendas | `pdv` |
| Relatorios | ReportsPage (7 tipos) | `reports`, `management` |
| Gerencia | DocumentsLicenses, ManagementPanel | `hotel_documents`, `management` |
| Diretoria | DiretoriaDashboard, Comparison, KPIs | `diretoria` |
| Portal | EmployeePortal, MySchedule, Events | `employee_portal` |
| Admin | AdminPanel, UserMgmt, Roles, Sectors, WhatsApp, Erbon | `admin`, `users_management`, etc. |

---

## 12. Bibliotecas Principais

- **UI**: Tailwind CSS 3.4, Lucide React (icones), Headless UI
- **Graficos**: Recharts
- **Datas**: date-fns
- **Excel**: xlsx
- **Barcode**: @zxing/browser
- **QR Code**: qrcode
- **AI**: Google Generative AI (chatbot)
- **Push**: Firebase Cloud Messaging

---

## 13. Comandos

```bash
npm run dev      # Servidor de desenvolvimento (Vite)
npm run build    # Build de produção (TypeScript + Vite)
npm run lint     # Linting (ESLint)
npm run test     # Executar testes (Vitest)
npm run preview  # Preview do build local
npx tsc --noEmit # Apenas type checking
```

---

## 14. Hoteis da Rede

| Hotel | Codigo |
|-------|--------|
| Costa do Sol | CDS |
| Brava Club | BRV |
| Maria Maria | MMA |
| Villa Pitanga | VPT |
