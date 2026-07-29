# Hardening de acesso — guia de ativação

Bloqueio por tentativas de login, anti-enumeração de grupos e headers de segurança.
Este documento é a ordem de execução. **A ordem importa**: fora dela, o login para de funcionar.

---

## Ordem de ativação

### 1. Migrations (Supabase Dashboard → SQL Editor)

| # | Arquivo | Status |
|---|---|---|
| 1 | `20260729120000_login_guard.sql` — `login_lockouts` + RPCs do lockout | ✅ **já aplicada e testada** |
| 2 | `20260729120200_group_slug_guard.sql` — guarda em `get_group_by_slug` | ✅ **já aplicada e testada** |
| 3 | `20260729120100_lock_username_resolution.sql` — fecha `resolve_username_email` | ⏳ **aplicar só no passo 4** |

As duas primeiras são inertes até o front novo subir: nada as chama ainda.

> **A nº 3 fica para depois de propósito.** Ela revoga o acesso público a
> `resolve_username_email`, de que o front **em produção** ainda depende para
> login por username. Só pode ser aplicada depois que o front novo estiver
> publicado — não basta a Edge Function estar no ar.

Conferência (já executada, resultados obtidos):

```sql
select * from login_guard_check('teste@exemplo.com', '1.2.3.4');  -- allowed=true, retry_after=0
select login_guard_fail('teste@exemplo.com', '1.2.3.4');          -- 0, 0 e 30 na 3ª chamada
select * from get_group_by_slug('meridiana');                      -- 1 linha
```

### 2. Deploy da Edge Function

```bash
npx supabase functions deploy auth-login --no-verify-jwt --project-ref bnmyflgyrlskhljrbyfc
```

O `--no-verify-jwt` é obrigatório: é o próprio login, o usuário ainda não tem token.

✅ **Já feita em 29/07/2026.** Testada com `curl` direto no endpoint: 2 falhas
retornam `401 Credenciais inválidas`, a 3ª retorna
`429 {"error":"Muitas tentativas...","retry_after":30}`.

### 3. Widget Turnstile no Cloudflare

✅ **Já criado em 29/07/2026** — widget "LyFe Hoteles - Login", modo **Managed**,
hostnames `lyfehoteles.com.br` e `localhost` (o `localhost` cobre o WebView do
APK Capacitor, que serve a partir dele).

A **Site Key** já está em `.env` como `VITE_TURNSTILE_SITE_KEY`. A **Secret Key**
fica guardada com você para o passo 5.

> Os deploy previews da Netlify (`*.netlify.app`) **não** estão na lista de
> hostnames. Se você testa em preview, adicione o domínio no widget (aceita até
> 10) — senão o login falha lá depois que o CAPTCHA for ativado.

### 4. Deploy do front (Netlify) + migration nº 3

**a)** Netlify → Site settings → Environment variables:
```
VITE_TURNSTILE_SITE_KEY = 0x4AAAAAAEBAFhMPc66Lhlgj
```
A Site Key é pública (vai no HTML do widget), mas precisa existir **em build
time** — o Vite embute no bundle. Sem ela o widget não renderiza.

**b)** Push na `main` e aguarde o deploy. Confirme que o widget aparece na tela
de login antes de seguir.

**c)** Só agora rode `20260729120100_lock_username_resolution.sql` no SQL Editor.
A partir daí só a Edge Function (service_role) traduz username → e-mail.

**Neste ponto o lockout de 3 tentativas + 30s está valendo, mas ainda é
contornável** por quem chamar `/auth/v1/token` direto com a anon key. É o passo
5 que fecha isso.

### 5. Ativar o CAPTCHA no Supabase

Supabase → Authentication → **Attack Protection** → Enable CAPTCHA protection:
- Provider: **Turnstile by Cloudflare**
- Secret: a **Secret Key** do widget criado no passo 3

> Faça isto **depois** do passo 4b estar no ar. Se o CAPTCHA for ativado antes do
> front enviar o token, ninguém consegue entrar.

### 6. Rate limits do Supabase (plano Pro)

Supabase → Authentication → **Rate Limits**:

| Limite | Padrão | Sugerido |
|---|---|---|
| Sign in / Sign up por IP (5 min) | 30 | **10** |
| Token refresh por IP (5 min) | 1800 | 150 |

Camada extra por IP, independente do lockout por conta.

### 7. Promover a CSP (depois de tudo estabilizado)

O `netlify.toml` publica a CSP como `Content-Security-Policy-Report-Only`: ela
**reporta e não bloqueia**. Navegue com o console aberto por login, dashboard,
compras, diretoria, web check-in e o APK. Quando não sobrar nenhuma violação,
renomeie a chave para `Content-Security-Policy` (sem o `-Report-Only`) e faça deploy.

---

## Como testar

**Lockout (3 + 30s)**

1. Erre a senha 3× na tela de login → a 3ª resposta traz o contador de 30s e o botão trava.
2. Espere os 30s → volta a aceitar.
3. Acerte a senha antes do 3º erro → o contador zera (`login_lockouts` limpa a linha).

**O teste que prova que não dá para burlar** — com o Turnstile já ativo (passo 4c):

```bash
curl -i -X POST "https://bnmyflgyrlskhljrbyfc.supabase.co/auth/v1/token?grant_type=password" -H "apikey: SUA_ANON_KEY" -H "Content-Type: application/json" -d '{"email":"teste@exemplo.com","password":"errada"}'
```

Deve responder erro de **captcha**, não "invalid credentials". Se responder
"invalid credentials", o passo 4c não está ativo e o lockout é contornável.

**Anti-enumeração (5 + 30s)**

Tente 5 nomes de grupo inexistentes seguidos no modal da landing → a 5ª já vem
bloqueada com cooldown. Nome de grupo válido nunca é penalizado.

**Headers**

```bash
curl -sSI https://lyfehoteles.com.br/
```

Depois rode [securityheaders.com](https://securityheaders.com/?q=lyfehoteles.com.br)
e [SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=lyfehoteles.com.br) —
são os relatórios que a landing linka na seção "Verifique você mesmo".

---

## Ajuste dos limites

Constantes no topo de `login_guard_fail`, em
`supabase/migrations/20260729120000_login_guard.sql`:

```
MAX_FAILS_USER = 3    BLOCK_USER = 30 segundos
MAX_FAILS_IP   = 10   BLOCK_IP   = 60 segundos
WINDOW_SPAN    = 15 minutos
```

3 falhas + 30s deixa passar ~360 senhas/hora por conta indefinidamente — o que
ainda quebra senha fraca. Para endurecer, multiplique o bloqueio a cada lockout
consecutivo em vez de zerar `fail_count`.

Para a guarda de slug, as constantes estão em `get_group_by_slug`
(`20260729120200_group_slug_guard.sql`): 5 falhas em 30s → 30s de bloqueio.

---

## Ganho rápido: 3 toggles no dashboard

Os advisors do Supabase apontaram três coisas que se resolvem clicando, sem código,
e que atacam justamente o que o lockout **não** cobre:

| Onde | O quê | Por quê |
|---|---|---|
| Authentication › Policies | **Leaked password protection** | Recusa senha que já vazou (checa no HaveIBeenPwned). É a defesa contra o furo que o lockout não fecha: senha fraca ou reutilizada. |
| Authentication › Providers › Email | **OTP expiry < 1 hora** | Hoje está acima de 1h; link de e-mail interceptado fica válido tempo demais. |
| Authentication › Policies | **MFA (TOTP)** para papéis administrativos | Conta de admin comprometida hoje entra sem segundo fator. |

---

## O que isto NÃO cobre

- **Senha fraca ou reutilizada** — lockout não ajuda se a senha vazou em outro
  serviço. Ative o *leaked password protection* acima; depois, MFA.
- **Phishing** — nenhum header impede alguém digitar a senha num site clonado.
- **`password-reset` sem throttle** — os modos `validate`/`apply` são públicos e
  sem limite de tentativas de token.
- **RLS — este é o ponto mais sério.** Os advisors apontam, em 29/07/2026:

  | Achado | Ocorrências |
  |---|---|
  | `rls_disabled_in_public` (tabela pública **sem RLS nenhuma**) | **41** |
  | `rls_policy_always_true` (policy `USING (true)`) | **266** |
  | `policy_exists_rls_disabled` (policy escrita, mas RLS desligada) | 22 |
  | `auth_users_exposed` (view `public.auth_users_safe` expõe `auth.users`) | 1 |

  Entre as tabelas sem RLS estão `inventory`, `supplier_quotes`,
  `expense_supplier_entries`, `item_consumption`. Na prática: **qualquer usuário
  autenticado, de qualquer grupo, consegue ler essas tabelas** chamando a API REST
  direto — sem passar pela tela.

  Isso é um vazamento maior do que a força bruta que acabamos de fechar: aqui o
  atacante nem precisa quebrar senha, basta ter uma conta válida em qualquer
  grupo. **Recomendo tratar como o próximo trabalho**, com auditoria tabela a
  tabela e policies escopadas por `group_id`.

---

## Rollback

Se o login quebrar depois do deploy:

1. Reverta o front (Netlify → Deploys → **Publish deploy** anterior). O
   `AuthContext.login` antigo volta a chamar `signInWithPassword` direto.
2. Se o CAPTCHA já estiver ativo, desative-o em Attack Protection — senão o front
   antigo (sem token) é rejeitado.
3. Restaure a RPC pública se necessário:
   ```sql
   GRANT EXECUTE ON FUNCTION public.resolve_username_email(TEXT, UUID) TO anon, authenticated;
   ```
