import { createClient } from "@supabase/supabase-js";
import { generate } from "generate-password";
import 'dotenv/config'; // Para carregar variáveis do arquivo .env

// #############################################################################
// # CONFIGURAÇÃO - ADAPTADO PARA VARIÁVEIS DE AMBIENTE COM PREFIXO VITE_    #
// #############################################################################

// 1. O script agora tentará ler VITE_SUPABASE_URL e VITE_SUPABASE_SERVICE_ROLE_KEY do seu arquivo .env
// Certifique-se de que seu arquivo .env contém:
// VITE_SUPABASE_URL=https://bnmyflgyrlskhljrbyfc.supabase.co
// VITE_SUPABASE_SERVICE_ROLE_KEY="SUA_CHAVE_SERVICE_ROLE_AQUI"

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

// 2. Lista de usuários a serem criados em auth.users
const usersToCreate = [
  {
    id: "5bff75b3-0085-47e3-8bef-c7b1f42eebb0",
    email: "max@costadosol.com",
    role: "admin",
  },
  {
    id: "1cf6d9e5-fd8f-45a6-a50b-ec39417d944e",
    email: "jessica@bravaclub.com",
    role: "admin",
  },
  {
    id: "5b3a1ac0-dfe3-4eb6-9425-6e7b3312c920",
    email: "dani@costadosol.com",
    role: "admin",
  },
  {
    id: "b1805fd6-fbf9-4f42-81ef-39a2c7519fee",
    email: "pedro@meridiana.com",
    role: "admin",
  },
  {
    id: "83b700e3-1d3a-46b0-a5d5-ce2b8601b1d6",
    email: "joicy@bravaclub.com",
    role: "admin",
  },
  {
    id: "e19d0abc-b633-4c82-8321-84847206b83d",
    email: "robson@costadosol.com",
    role: "admin",
  },
  {
    id: "dd985b55-9d2e-456a-863a-1ca4893f822e",
    email: "estoque@costadosol.com",
    role: "inventory",
  },
  {
    id: "0523d989-cc05-4160-b9b4-d9b4bd51dbf4",
    email: "fabiano@meridiana.com",
    role: "admin",
  },
  {
    id: "618a32e3-d8ca-44ac-ad06-ae36c672da95",
    email: "vanessa@costadosol.com",
    role: "sup-governanca",
  },
];

// #############################################################################
// # LÓGICA DO SCRIPT - NÃO MODIFIQUE ABAIXO A MENOS QUE SAIBA O QUE FAZ   #
// #############################################################################

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "ERRO: VITE_SUPABASE_URL e VITE_SUPABASE_SERVICE_ROLE_KEY precisam estar definidas no seu arquivo .env."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function syncUsers() {
  console.log("Iniciando script de sincronização de usuários para auth.users (versão ES6 Modules, adaptado para VITE_ vars)...");

  for (const user of usersToCreate) {
    console.log(`\nProcessando usuário: ${user.email} (ID: ${user.id})`);

    const password = generate({
      length: 12,
      numbers: true,
      symbols: true,
      uppercase: true,
      lowercase: true,
      strict: true,
    });

    try {
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: password,
        email_confirm: true, 
        user_metadata: {
          role: user.role,
        },
      });

      if (error) {
        if (error.message.includes("User already registered")) {
          console.warn(
            `AVISO: Usuário ${user.email} já existe em auth.users. Pulando.`
          );
        } else {
          console.error(
            `ERRO ao criar usuário ${user.email} em auth.users:`,
            error.message
          );
        }
      } else {
        console.log(
          `SUCESSO: Usuário ${user.email} (Novo ID Auth: ${newUser.user.id}) criado em auth.users.`
        );
        console.log(`  Senha gerada: ${password}`);
        console.log(
          `  IMPORTANTE: Comunique esta senha ao usuário ou instrua-o a usar o fluxo \'Esqueci minha senha\'.`
        );
      }
    } catch (e) {
      console.error(
        `ERRO CRÍTICO ao processar ${user.email}: `,
        e.message || e
      );
    }
  }
  console.log("\nScript de sincronização concluído.");
}

syncUsers();

