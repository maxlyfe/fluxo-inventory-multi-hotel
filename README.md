Fluxo Inventory - Multi Hotel
Um sistema de gestão de inventário e compras (ERP) completo, projetado para otimizar as operações de uma rede de hotéis.

📖 Sobre o Projeto
O Fluxo Inventory é uma aplicação web moderna e robusta, construída para centralizar e simplificar o controle de inventário, o ciclo de compras e a análise de dados operacionais em múltiplas unidades hoteleiras. A plataforma oferece ferramentas poderosas para administradores, gerentes de estoque e funcionários de setor, garantindo um fluxo de trabalho coeso, desde a requisição de um item até a sua compra e reconciliação financeira.

O sistema foi projetado com uma arquitetura escalável e segura, utilizando tecnologias de ponta para fornecer uma experiência de usuário rápida, interativa e em tempo real.

✨ Funcionalidades Principais
Este sistema é rico em funcionalidades específicas para o domínio da hotelaria:

🏨 Arquitetura Multi-Hotel: Gerencie múltiplas unidades hoteleiras a partir de uma única interface, com a capacidade de transferir estoque e sincronizar catálogos de produtos entre elas.

📦 Controle de Inventário Avançado:

Gestão completa do ciclo de vida dos produtos, com estoque mínimo/máximo, preços e visibilidade por setor.

Porcionamento: Um fluxo de trabalho detalhado para processar itens comprados em grande escala e transformá-los em porções (ex: uma peça de carne em bifes), controlando o rendimento e as perdas.

Balanço de Estoque: Ferramenta interativa para contagem física do estoque local de cada setor, com cálculo automático de consumo e discrepâncias.

Importação de inventário em massa a partir de planilhas Excel, com validação de dados.

🛒 Ciclo de Compras Completo:

Geração de listas de compras automáticas com base nos níveis de estoque.

Criação de orçamentos físicos (planilhas editáveis) e orçamentos online (com links de produtos e cálculo de frete).

Cotação Dinâmica: Geração de links públicos para que fornecedores externos submetam seus preços, com uma tela de análise comparativa para facilitar a tomada de decisão.

Fluxo de aprovação de orçamentos e registro de entrada de notas fiscais.

🏢 Gestão por Setores:

Controle de estoque local para cada setor (Cozinha, Governança, etc.).

Sistema de requisições para que os setores solicitem itens ao almoxarifado central.

📊 Central de Relatórios Interativa:

Painel de gestão com gráficos de consumo, gastos e evolução de preços.

Relatórios detalhados para Lavanderia, Contas de Consumo (água/luz) e Custo por Hóspede.

Reconciliação Semanal de Estoque: Um relatório completo que detalha toda a movimentação de cada item (estoque inicial, compras, transferências, consumo, perdas, estoque final).

💰 Controle Financeiro Integrado: Cada movimentação de estoque com valor monetário (como transferências entre hotéis ou pagamentos) gera transações de débito e crédito no balanço financeiro da unidade, criando um livro-razão integrado.

🔐 Segurança e Acesso por Cargos (RBAC): O sistema possui um controle de acesso granular. Cada usuário tem um cargo (admin, inventory, management, etc.) que define exatamente quais telas e funcionalidades ele pode acessar.

🔔 Notificações em Tempo Real: Um sistema de notificações (no aplicativo e via push) alerta os usuários sobre eventos importantes (novas requisições, aprovações, etc.) com base em suas preferências personalizadas.

🚀 Tecnologias Utilizadas
O projeto foi construído com uma stack de tecnologias moderna e performática.

Frontend
Framework: React com TypeScript.

Build Tool: Vite.

Estilização: Tailwind CSS com um sistema de design customizado.

Roteamento: React Router.

Gráficos: Recharts.

Ícones: Lucide React.

Backend & Banco de Dados (BaaS)
Plataforma: Supabase.

Banco de Dados: PostgreSQL.

Autenticação: Supabase Auth.

Funções Serverless: Supabase Edge Functions (Deno).

Notificações Push: Firebase Cloud Messaging (FCM).

🛠️ Como Executar o Projeto Localmente
Siga os passos abaixo para configurar e executar o ambiente de desenvolvimento.

Pré-requisitos
Node.js (versão 18 ou superior)

Yarn (gerenciador de pacotes)

Uma conta no Supabase para configurar o backend.

Instalação
Clone o repositório:

Bash

git clone https://github.com/maxlyfe/fluxo-inventory-multi-hotel.git
cd fluxo-inventory-multi-hotel
Instale as dependências:

Bash

yarn install
Configure as Variáveis de Ambiente:

Crie uma cópia do arquivo .env.example e renomeie para .env.

Preencha as variáveis com as chaves do seu projeto Supabase:

Fragmento de código

VITE_SUPABASE_URL=https://<seu-projeto-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<sua-chave-anon-publica>
Execute o servidor de desenvolvimento:

Bash

yarn dev
A aplicação estará disponível em http://localhost:5173.

Configuração do Backend (Supabase)
O frontend depende de uma estrutura de banco de dados e funções no Supabase para funcionar corretamente.

Esquema do Banco de Dados: Aplique o esquema SQL fornecido no arquivo supabase/schema.sql ao seu banco de dados Supabase para criar todas as tabelas, funções (RPC) e políticas de segurança.

Funções Serverless (Edge Functions): Faça o deploy das funções localizadas no diretório supabase/functions/ para o seu projeto Supabase. O guia supabase_edge_function_deployment_guide.md contém instruções detalhadas.

Configuração Inicial: Utilize o script sync_users_to_auth.js para popular o banco com os usuários iniciais, se necessário.

📄 Licença
Este projeto está sob a licença MIT.