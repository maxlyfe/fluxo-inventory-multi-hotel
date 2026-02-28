Guia de Implantação: Supabase Edge Function para Notificações Push FCM
Este guia detalha os passos para implantar a Edge Function send-fcm-notification no seu projeto Supabase. Esta função é responsável por enviar notificações push para dispositivos de usuários através do Firebase Cloud Messaging (FCM).
Pré-requisitos
Conta Supabase e Projeto Criado: Você já deve ter um projeto Supabase ativo.
Conta Firebase e Projeto Configurado:
Um projeto Firebase criado.
Seu aplicativo web registrado no projeto Firebase.
A Chave do Servidor FCM obtida (Firebase Console > Configurações do Projeto > Cloud Messaging > Chave do servidor).
Node.js e npm/yarn: Necessários para instalar a Supabase CLI.
Supabase CLI Instalada e Autenticada: Se ainda não instalou, siga os passos abaixo.
1. Instalação e Configuração da Supabase CLI
Se você ainda não tem a Supabase CLI instalada, abra seu terminal e execute:
bash
npm install supabase --save-dev
# ou
yarn add supabase --dev
Após a instalação, autentique-se com sua conta Supabase:
bash
npx supabase login
Siga as instruções no navegador para completar o login.
2. Estrutura de Arquivos da Função
Certifique-se de que os seguintes arquivos estão na estrutura correta dentro do seu projeto (relativo à raiz do seu projeto React, por exemplo):
<seu-projeto>/
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   └── cors.ts       # Arquivo de configuração CORS
│   │   └── send-fcm-notification/
│   │       └── index.ts      # Código principal da Edge Function
│   └── ... (outros arquivos de configuração Supabase, se houver)
├── public/
│   └── firebase-messaging-sw.js
├── src/
│   ├── lib/
│   │   ├── firebase.ts
│   │   └── notifications.ts
│   └── ... (outros arquivos do seu app)
└── package.json
Os arquivos send-fcm-notification/index.ts e _shared/cors.ts já foram fornecidos.
3. Vinculando seu Projeto Local ao Projeto Supabase Remoto
Navegue até a raiz do seu projeto no terminal e vincule-o ao seu projeto Supabase remoto. Você precisará do ID de Referência do Projeto (Project Reference ID), que pode ser encontrado nas configurações do seu projeto no dashboard do Supabase (Configurações do Projeto > Geral > ID de Referência).
bash
cd /caminho/para/seu/projeto # Ex: /home/ubuntu/project_A
npx supabase link --project-ref SEU_PROJECT_REF_ID
Substitua SEU_PROJECT_REF_ID pelo ID real.
4. Configuração de Variáveis de Ambiente (Secrets)
A Edge Function precisa de algumas variáveis de ambiente para funcionar corretamente. Estas são configuradas como "secrets" no Supabase e não devem ser versionadas no seu código.
Você precisará definir os seguintes secrets:
SUPABASE_URL: A URL do seu projeto Supabase (Configurações do Projeto > API > URL).
SUPABASE_SERVICE_ROLE_KEY: A chave de service_role do seu projeto Supabase (Configurações do Projeto > API > Chaves de API do Projeto > service_role). Cuidado: Esta chave tem privilégios de administrador, trate-a com segurança.
FCM_SERVER_KEY: A Chave do Servidor que você obteve do seu console Firebase (Configurações do Projeto > Cloud Messaging > Chave do servidor).
Use os seguintes comandos da Supabase CLI para definir cada secret. Execute-os na raiz do seu projeto vinculado:
bash
npx supabase secrets set SUPABASE_URL=SUA_SUPABASE_URL
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=SUA_SUPABASE_SERVICE_ROLE_KEY
npx supabase secrets set FCM_SERVER_KEY=SUA_FCM_SERVER_KEY
Substitua SUA_SUPABASE_URL, SUA_SUPABASE_SERVICE_ROLE_KEY, e SUA_FCM_SERVER_KEY pelos seus valores reais.
Para listar os secrets configurados e verificar:
bash
npx supabase secrets list
5. Implantação (Deploy) da Edge Function
Com os arquivos no lugar e os secrets configurados, você pode implantar a Edge Function:
bash
npx supabase functions deploy send-fcm-notification --project-ref SEU_PROJECT_REF_ID
Se você omitir --project-ref, a CLI tentará usar o projeto vinculado automaticamente.
Observação sobre o import map:
Se você encontrar problemas com importações Deno (como esm.sh ou deno.land/std), pode ser necessário criar ou atualizar um arquivo import_map.json na pasta supabase/ e referenciá-lo no seu config.toml (ou supabase/config.json dependendo da sua versão da CLI).
Exemplo de supabase/import_map.json:
json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2",
    "std/": "https://deno.land/std@0.177.0/"
  }
}
E no supabase/config.toml (ou config.json) :
toml
# supabase/config.toml
[functions.send-fcm-notification]
import_map = "./import_map.json"
Se o config.toml não existir, crie-o. A CLI geralmente lida bem com isso, mas é um ponto a observar em caso de erros de importação durante o deploy.
6. Testando a Edge Function
Após a implantação, você pode testar a função invocando-a. A forma mais direta é usando a própria Supabase CLI ou uma ferramenta como curl ou Postman.
Para invocar com a Supabase CLI:
bash
npx supabase functions invoke send-fcm-notification --project-ref SEU_PROJECT_REF_ID --payload '{"userId":"SEU_USER_ID_PARA_TESTE","title":"Teste Push","body":"Esta é uma notificação de teste!"}'
Substitua SEU_USER_ID_PARA_TESTE por um ID de usuário real do seu banco que tenha um token FCM registrado na tabela user_fcm_tokens.
Para invocar com curl:
Você precisará da URL da sua função e de uma chave de API (pode ser a anon key para teste, mas a função em si usa a service_role key internamente para acessar o banco).
bash
curl -X POST \
  'https://SEU_PROJECT_REF_ID.supabase.co/functions/v1/send-fcm-notification' \
  -H 'Authorization: Bearer SUA_SUPABASE_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "SEU_USER_ID_PARA_TESTE",
    "title": "Teste Push via Curl",
    "body": "Esta é uma notificação de teste via Curl!",
    "data": { "pagina": "/algum-caminho" }
  }'
Substitua SEU_PROJECT_REF_ID, SUA_SUPABASE_ANON_KEY, e SEU_USER_ID_PARA_TESTE.
Verificando os Logs:
Se algo não funcionar, verifique os logs da sua função no dashboard do Supabase (Edge Functions > Sua Função > Logs) .
7. Próximos Passos
Após a implantação e teste bem-sucedidos da Edge Function, o próximo passo é integrar a chamada a esta função dentro da sua função createNotification no seu aplicativo React, para que as notificações push sejam disparadas automaticamente quando os eventos relevantes ocorrerem.