# Análise de Arquitetura e Usabilidade — Fluxo Hotelaria

**Data da Análise**: 22 de Julho de 2026  
**Tipo**: Baseline Inicial de Avaliação  
**Projeto**: Fluxo — Ecossistema de Gestão Operacional Hoteleira (Multi-Hotel)

---

## 1. Análise Detalhada da Arquitetura de Arquivos

O projeto é uma aplicação **React 18 + TypeScript + Vite + Tailwind CSS**, integrada ao **Supabase (PostgreSQL/Auth)** e envelopada com **Capacitor** para APKs nativos Android.

### Principais Destaques Arquiteturais Encontrados nos Arquivos:
1. **Multi-Hotel Nativo (`src/context/HotelContext.tsx`)**:
   - O escopo de `hotel_id` é gerenciado de forma reativa. Cada query operacional filtra pelo hotel ativo no `localStorage`, que por sua vez passa por validação no banco via UUID.
2. **Sistema de Permissões Granular (`src/hooks/usePermissions.ts`)**:
   - Utiliza tabelas dinâmicas (`custom_roles`) vinculadas aos `profiles`. Módulos e permissões de estoque por setor (`sector_stock:UUID`) são avaliados dinamicamente em tempo de execução via `can()`, `canAny()` e `canAll()`.
3. **Navegação Centralizada e Declarativa (`src/lib/navigationConfig.ts`)**:
   - Todos os grupos de menu, categorias e itens com controle de permissão e ícones estão centralizados em `NAV_CATEGORIES`. Mudanças de navegação refletem automaticamente no Sidebar e no Navbar.
4. **Atomicidade em Operações de Estoque (`decrement_sector_stock` RPC)**:
   - Evita *race conditions* no frontend. As baixas de estoque não calculam saldos na UI, e sim enviam os deltas numéricos para serem processados via procedimento armazenado (`rpc`) no Postgres.
5. **Formatação e Entradas Decimais no Padrão BR (`useFormatters`)**:
   - Trata campos de número com `inputMode="decimal"` e `type="text"`, realizando o parser para float apenas no submit, prevenindo incompatibilidades nativas do navegador com a vírgula brasileira.
6. **Deploy Híbrido Web + Mobile Nativo (Capacitor + PKCE)**:
   - O app Android roda como WebView sincronizado via PKCE no Supabase Auth (`com.lyfe.fluxo://login-callback`), permitindo atualizações de UI em tempo real na web sem obrigatoriedade de re-build do APK a cada mudança.

---

## 2. Fluxo de Usabilidade do Sistema (Workflows Operacionais)

```
+-----------------------------------------------------------------------------------+
| 1. Módulos de Compras & Cotações                                                  |
| Setor solicita -> Almoxarifado/Compras centraliza -> Link Público (Fornecedor) -> |
| Aprovação de Alçada (AuthorizationsPage) -> Ordem de Compra                       |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 2. Módulos de Estoque & Transferências                                            |
| Recebimento -> Estoque Central -> Transferência Inter-setores ->                  |
| Consumo/Baixa via RPC -> Inventário Rotativo / QR Code                            |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 3. Módulos Operacionais, Recepção & PMS                                           |
| Reserva (Erbon/Omnibees) -> Web Check-in Hóspede (FNRH) -> Rack de UHs ->         |
| Consumos PDV -> Check-out & Fechamento Financeiro                                 |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 4. Manutenção & Governança                                                        |
| Abertura via QR Code na UH -> Rack de Manutenção -> Atribuição e Reparo          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| 5. Pessoas, DP & Portal do Colaborador                                            |
| Recrutamento -> Admissão -> Escala de Trabalho & NR-1 -> Portal do Colaborador    |
+-----------------------------------------------------------------------------------+
```

---

## 3. Pontos Fortes do Projeto

1. **Acessibilidade Sem Fricção (Links Públicos)**:
   - `PublicQuotePage`, `PublicSectorRequest` e `PublicStockCount` eliminam a necessidade de login para fornecedores ou operação no chão de fábrica.
2. **Proteção Contra Erros de Concorrência**:
   - Travas de submit (`isSaving`) para evitar duplo clique e funções RPC atômicas no banco para atualização de saldos de estoque.
3. **Padrão Estético e Suporte Completo a Dark Mode**:
   - Estruturado com Tailwind CSS utilizando classes `dark:` para garantir transição suave entre temas claro e escuro.
4. **Arquitetura Multi-Tenant Sólida**:
   - Isolamento lógico por `hotel_id` em tabelas e views do Supabase, viabilizando múltiplos hotéis na mesma infraestrutura com total segurança de dados.
5. **Integração Nível Enterprise**:
   - Conexão nativa com Erbon PMS, Omnibees, Meta WhatsApp Cloud API e notificações via Firebase FCM.

---

## 4. Debilidades e Oportunidades de Melhoria

1. **Componentes Monolíticos (Arquivos Extensos)**:
   - `NewPurchase.tsx` (~111 KB), `SectorStock.tsx` (~104 KB), `UserManagement.tsx` (~98 KB), `MenuTechSheet.tsx` (~85 KB), `Inventory.tsx` (~84 KB), e `App.tsx` (~55 KB, 1.077 linhas) acumulam muitas responsabilidades.
2. **Falta de Code-Splitting / Lazy Loading nas Rotas**:
   - Importações síncronas em `App.tsx` aumentam o bundle inicial, afetando o tempo de carregamento inicial (*First Contentful Paint*).
3. **Lógica de Banco de Dados Acoplada na UI**:
   - Queries complexas do Supabase direto nos `useEffect` das páginas dificultam reaproveitamento e manutenção.
4. **Resiliência Offline no Mobile**:
   - O app nativo depende 100% de conexão ativa com a internet para operações no subsolo/almoxarifado.

---

## 5. Resumo da Avaliação (Baseline Inicial)

| Aspecto | Nota Atual (22/07/2026) | Meta para Próxima Análise |
|---|:---:|:---:|
| **Arquitetura & Organização** | **9.0 / 10** | 9.5 / 10 |
| **Segurança & Integridade de Dados** | **9.5 / 10** | 9.8 / 10 |
| **Usabilidade & UX** | **9.0 / 10** | 9.5 / 10 |
| **Manutenibilidade de Código** | **7.5 / 10** | **9.0 / 10** *(foco em refatoração)* |
| **Performance do Bundle** | **7.0 / 10** | **9.0 / 10** *(foco em lazy loading)* |

---

## 6. O Que Deverá Ser Comparado na Próxima Análise

Na próxima avaliação, a comparação deverá focar nos seguintes critérios:

1. **Tamanho e Modularização dos Arquivos Críticos**:
   - Verificar se os arquivos monolíticos (`NewPurchase.tsx`, `SectorStock.tsx`, `Inventory.tsx`, `App.tsx`) foram fracionados em sub-componentes especializados.
2. **Implementação de Code-Splitting / Lazy Loading**:
   - Avaliar se as rotas em `App.tsx` foram migradas para `React.lazy()` + `Suspense`, reduzindo o tamanho do bundle inicial do Vite.
3. **Desacoplamento de Queries (Services/Custom Hooks)**:
   - Checar se as chamadas diretas ao Supabase foram movidas das páginas para rotinas reutilizáveis em `src/services/` ou `src/hooks/queries/`.
4. **Evolução das Notas de Manutenibilidade e Performance**:
   - Reavaliar as notas de **Manutenibilidade de Código** (meta: passar de 7.5 para 9.0) e **Performance do Bundle** (meta: passar de 7.0 para 9.0).
5. **Estabilidade e Resiliência Operacional**:
   - Verificar inclusão de fallbacks offline/cache para o app mobile em áreas com Wi-Fi instável.
