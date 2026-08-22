# Nota de segurança · 29/07/2026

Validação do sistema inteiro e levantamento de achados de segurança.

| Item | Valor |
|:--|:--|
| Commit avaliado | `9ddede3` (branch `main`) |
| Escopo | front (`src/`), functions Netlify, Edge Functions Supabase, migrations, headers |
| Método | build e testes executados localmente, leitura de código, conferência das policies nas migrations |
| Não coberto | teste dinâmico contra o banco de produção (as policies foram lidas nas migrations, não consultadas no servidor) |

## 1. Validação técnica

| Verificação | Comando | Resultado |
|:--|:--|:--|
| Tipos | `npx tsc --noEmit` | Passa, zero erro |
| Testes | `npm test` | 132 testes, 8 arquivos, todos passando |
| Build de produção | `npm run build` | Passa, 4012 módulos, 22s |
| Lint | `npm run lint` | **Falha ao iniciar. Nenhuma análise estática roda hoje.** |

### 1.1 Lint quebrado (bloqueia a análise estática)

Duas quebras somadas:

1. O script usa `eslint . --ext ts,tsx`, e a flag `--ext` foi removida no modelo de config novo. O eslint recusa antes de analisar qualquer arquivo.
2. O `eslint.config.js` importa o pacote `typescript-eslint`, que não está instalado. O `package.json` traz apenas `@typescript-eslint/eslint-plugin` e `@typescript-eslint/parser` na versão 6, que é a organização antiga do pacote.

Efeito prático: o lint não roda desde a migração para `eslint.config.js`, nem na máquina nem em qualquer CI que chame `npm run lint`. Falhas que o lint pegaria (variável não usada, hook fora de ordem, `any` implícito em ponto sensível) passam sem aviso.

Correção:

```bash
npm i -D typescript-eslint && npm pkg set scripts.lint="eslint ."
```

Depois vale rodar uma vez e tratar o passivo acumulado antes de exigir `--max-warnings 0`.

### 1.2 Observações menores do build

* Chunk único de 5,68 MB (1,39 MB gzip). Não é falha de segurança, mas é o maior custo de carregamento do app.
* O `netlify.toml` roda `npx tsc --noEmit --skipLibCheck && npm run build`, e o `npm run build` já começa com `tsc`. A checagem de tipos acontece duas vezes em todo deploy.

## 2. Achados de segurança

Ordenados por gravidade. Os dois primeiros formam uma única cadeia de ataque e devem ser tratados juntos.

### CRÍTICO 1 · Certificado digital A1 e a senha dele são legíveis por qualquer usuário autenticado

`supabase/migrations/20260622120000_nfe_nfse_system.sql:158`

```sql
CREATE POLICY "nf_hotel_config: auth full access"
  ON nf_hotel_config FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
```

A tabela `nf_hotel_config` guarda, em texto puro:

* `certificado_base64` e `certificado_senha` (o e-CNPJ A1 completo)
* `prefeitura_login` e `prefeitura_senha` (NFS-e Búzios)
* `csc_id` e `csc_token` (código de segurança do contribuinte)

A policy é `FOR ALL` com `USING (true)`, ou seja, vale para leitura **e** escrita, sem recorte por hotel ou por grupo. Qualquer conta válida do sistema, de qualquer unidade, faz uma chamada REST direta ao Supabase e baixa o certificado com a senha. A mesma conta consegue alterar ou apagar a configuração fiscal.

Consequência: posse do certificado digital da empresa. Com ele é possível assinar documento fiscal, emitir e cancelar nota em nome do CNPJ, fora do sistema e sem rastro nosso.

Vale registrar que RLS no Postgres é por linha, não por coluna. Não existe policy que esconda só a coluna da senha; a proteção precisa vir de outro lugar (item 2.1 do plano).

### CRÍTICO 2 · `nf-proxy` aceita qualquer requisição, sem autenticação

`netlify/functions/nf-proxy.ts`

A function que emite NF-e, NFC-e e NFS-e não valida sessão nenhuma: sem checagem de JWT, sem chave de serviço, `Access-Control-Allow-Origin: *`. Ela recebe `certificado_base64` e `certificado_senha` no corpo da requisição e assina o que vier.

Fechando a cadeia com o item anterior: uma conta comum lê o certificado no banco, chama o proxy aberto e emite ou cancela documento fiscal. O proxy também aceita certificado de terceiros, então serve para qualquer pessoa assinar documento próprio usando nossa infraestrutura e nossos IPs.

### ALTO 3 · Token da Meta, apikey do Evolution e senha do PMS legíveis por qualquer autenticado

| Tabela | Onde | Policy |
|:--|:--|:--|
| `whatsapp_configs` | `20260323120000_whatsapp_integration.sql:107` | `FOR ALL TO authenticated USING (true) WITH CHECK (true)` |
| `whatsapp_configs` | `20260429000000_security_hardening_rls.sql:51` | `FOR SELECT ... USING (true)` |
| `erbon_hotel_config` | `20260429000000_security_hardening_rls.sql:33` | `FOR SELECT ... USING (true)` |

O comentário da migration de hardening diz que "apenas admins podem ver as colunas de senha". Isso não é o que a policy faz: o `SELECT` está liberado para todo autenticado e a coluna da senha vem junto. A restrição a admin existe só no `FOR ALL`, ou seja, cobre escrita, não leitura.

Fica exposto: token permanente do WhatsApp Cloud API, `api_key` do Evolution, usuário e senha do Erbon.

Agravante em `whatsapp_configs`: como o `FOR ALL` da migration antiga permite escrita a qualquer autenticado, é possível trocar o `base_url` da instância. O `evolution-proxy` usa esse valor como destino, então a alteração redireciona as chamadas para um host escolhido pelo atacante, que passa a receber a apikey.

### ALTO 4 · Passivo de RLS ainda aberto

Já registrado em `SECURITY_HARDENING.md`, repetido aqui porque continua valendo: 41 tabelas públicas sem RLS, 266 policies `USING (true)`, 22 policies escritas com RLS desligada, e a view `public.auth_users_safe` expondo `auth.users`.

A migration `20260730120000_rls_helpers.sql` (Lote 0) já está escrita e é aditiva, mas segue não aplicada e não commitada. Ela cria apenas os helpers (`can_read_hotel`, `hotel_in_my_group`, `my_group_id`, `is_admin` com `search_path` fechado). Nenhuma policy foi reescrita ainda.

### MÉDIO 5 · Webhook do WhatsApp aceita POST sem verificar assinatura

`netlify/functions/whatsapp-webhook.ts:106`

O `GET` valida o `hub.verify_token` da Meta. O `POST`, que é o que grava dados, não valida nada: não confere o `X-Hub-Signature-256` da Meta nem qualquer segredo compartilhado no ramo do Evolution. Escreve no banco com `service_role`, portanto passa por cima de qualquer RLS.

Com a URL do webhook (que é pública e previsível) qualquer pessoa consegue inserir mensagem falsa no inbox, marcar mensagem enviada como lida ou falha, e alterar o `connection_status` da instância. O handler responde 200 mesmo em erro, então a injeção não deixa sinal de recusa.

### MÉDIO 6 · Filtro anti SSRF por sufixo de domínio

| Arquivo | Linha | Teste atual | Domínio que passa indevidamente |
|:--|:--|:--|:--|
| `netlify/functions/erbon-proxy.ts` | 69 | `hostname.endsWith('erbonsoftware.com')` | `naoerbonsoftware.com` |
| `netlify/functions/omnibees-proxy.ts` | 31 | `hostname.endsWith('omnibees.com')` | `falsoomnibees.com` |

`endsWith` sobre o hostname inteiro casa qualquer domínio que termine com aquela cadeia de caracteres, não apenas subdomínios. Basta registrar um domínio com o sufixo para transformar a function em relay para host arbitrário, com repasse do header `Authorization`.

O teste correto compara o host exato ou exige o ponto separador:

```ts
const ok = host === 'erbonsoftware.com' || host.endsWith('.erbonsoftware.com');
```

O `evolution-proxy` tem validação melhor (exige HTTPS e bloqueia faixas privadas), mas checa o hostname como texto. Um nome público que resolva para `127.0.0.1` ou para faixa interna passa pelo filtro, porque a resolução de DNS não é verificada.

### MÉDIO 7 · Todos os proxies são abertos

`erbon-proxy`, `omnibees-proxy`, `whatsapp-proxy`, `fnrh-proxy` e `nf-proxy` respondem a qualquer origem, sem sessão. Quem tiver a URL usa. Servem como relay anônimo para tentativa de credencial contra Erbon, SERPRO, Omnibees e Meta, partindo dos IPs da Netlify e consumindo nossa cota de execução.

Caso mais sensível: o `fnrh-proxy` recebe usuário e senha do sistema do governo em `x-fnrh-usuario` e `x-fnrh-senha`, e o CPF do solicitante em `x-fnrh-cpf`. Em erro, a resposta ecoa a URL de destino completa.

### MÉDIO 8 · Credenciais de integração trafegam pelo navegador

É um padrão do sistema, não um ponto isolado: o front lê a credencial do banco e a envia ao proxy por header ou corpo. Vale para o certificado A1 (`src/lib/nfService.ts:924` e outros doze pontos), para o token da Meta, para a apikey do Evolution e para a senha do Erbon.

O comentário no topo de cada proxy afirma o contrário ("evita expor a apikey no browser", "mantém credenciais no servidor"). Na prática o segredo passa pela aba do navegador do usuário: fica visível no devtools, alcançável por extensão instalada e capturável por qualquer XSS.

### BAIXO 9 · Bloqueio por IP contornável

`supabase/functions/auth-login/index.ts:35`

`clientIp` usa o primeiro valor de `x-forwarded-for`, header que o cliente controla. Trocar esse valor a cada tentativa zera o contador por IP. O bloqueio por conta continua íntegro, porque é indexado pelo e-mail, então o impacto se limita à camada extra de IP.

### BAIXO 10 · Chave do job derivada da chave de serviço

`netlify/functions/pickup-daily-snapshot.ts:23`

O gatilho autentica no worker com `x-job-key` igual aos últimos 24 caracteres de `SUPABASE_SERVICE_KEY`. Funciona, mas amarra o segredo do job ao segredo mestre: vazar o job key entrega um pedaço conhecido da chave de serviço. Um valor próprio em variável de ambiente separada resolve.

### BAIXO 11 · `password-reset` sem throttle nos modos públicos

Já citado em `SECURITY_HARDENING.md`. Os modos `validate` e `apply` são públicos e sem limite de tentativas. O risco real é pequeno: o token tem 64 caracteres hexadecimais vindos de dois `randomUUID`, o que torna a força bruta inviável. Fica como ponto de higiene.

## 3. O que está correto

Registro para não perder o que já foi feito e não regredir:

* **Nenhum segredo real versionado.** Busca por JWT em todos os arquivos rastreados pelo git não retorna nada. `.env`, `.env.*` e `docker/evolution/.env` estão no `.gitignore`; os scripts SQL de cron usam `<SERVICE_ROLE_KEY>` como marcador.
* **`auth-login` bem construída.** Mensagem única para qualquer falha de credencial, username inexistente também conta tentativa (fecha a enumeração de graça), falha de captcha não penaliza o usuário, e o lockout roda com `service_role` fora do alcance do front.
* **`admin-user-actions` com autorização em camadas.** Valida o token do chamador, consulta o nível de hierarquia, exige `can_manage_user` sobre o alvo e impede conceder papel de nível igual ou superior ao próprio.
* **CSP bloqueante com coletor de violações.** Junto com HSTS de 2 anos, `frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy`.
* **CAPTCHA fechando o bypass do endpoint de token.** Sem ele o lockout seria contornável chamando `/auth/v1/token` direto com a anon key.

## 4. Plano de ação

Na ordem. Os itens 1 e 2 são a cadeia de emissão fiscal e não devem esperar o resto.

**1. Tirar o certificado do alcance do cliente.** Revogar o `SELECT` de `nf_hotel_config` para `authenticated` e deixar as colunas de certificado, senha, CSC e login de prefeitura acessíveis apenas ao `service_role`. O front passa a pedir a emissão informando `hotel_id` e o servidor busca o certificado por conta própria. É a mudança que dissolve os itens 1, 2 e 8 de uma vez.

**2. Autenticar o `nf-proxy`.** Exigir o JWT do usuário, validar a permissão de emissão (o registry `nf.emit.*` já existe) e conferir que o hotel do pedido é um hotel a que o usuário tem acesso. Enquanto o item 1 não estiver pronto, isto sozinho já impede que um estranho use o proxy.

**3. Fechar `whatsapp_configs` e `erbon_hotel_config`.** Restringir o `SELECT` ao `service_role` e mover o envio de mensagem e a chamada ao PMS para dentro das functions, que passam a ler a credencial no servidor. O front recebe apenas o resultado, nunca a chave.

**4. Assinar o webhook do WhatsApp.** Validar `X-Hub-Signature-256` com o app secret da Meta e exigir um segredo em query string ou header no ramo do Evolution. Descartar em silêncio o que não conferir.

**5. Corrigir o filtro de host dos proxies.** Trocar `endsWith(dominio)` por comparação exata mais `.dominio`, nos dois arquivos.

**6. Aplicar o Lote 0 de RLS e seguir para as policies.** A migration de helpers é aditiva e pode ser aplicada com segurança. Depois, tabela a tabela, com `(SELECT can_read_hotel(hotel_id))` como predicado padrão, começando pelas 41 sem RLS nenhuma.

**7. Restabelecer o lint.** Instalar `typescript-eslint`, ajustar o script e tratar o passivo.

**8. Higiene.** Chave própria para o job de pickup, throttle nos modos públicos do `password-reset`, e os três toggles do dashboard Supabase já listados em `SECURITY_HARDENING.md` (leaked password protection, OTP abaixo de 1 hora, MFA para papéis administrativos).

## 5. Resumo

O trabalho de hardening do login está sólido e verificado. O risco do sistema hoje não está mais na porta da frente: está no que uma conta comum alcança depois de entrar. O ponto mais grave é o certificado digital A1 com a senha em texto puro, legível e alterável por qualquer usuário autenticado de qualquer unidade, combinado com uma function de emissão fiscal que não pede autenticação nenhuma. Os dois juntos permitem emitir e cancelar nota em nome do CNPJ sem passar por nenhuma tela do sistema.
