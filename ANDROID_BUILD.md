# Android APK — Guia de Build e Distribuição

## Visão Geral

O aplicativo Android é um wrapper Capacitor que carrega `https://lyfehoteles.com.br` em WebView.
O código web é servido **ao vivo** do site — não precisa rebuildar o APK para cada mudança de UI.

Só é necessário rebuildar o APK quando:
- Mudou `versionCode` / `versionName` (nova versão para distribuição)
- Mudou `capacitor.config.ts` (ex: `server.url`)
- Mudou `AndroidManifest.xml` (permissões, deep links)
- Adicionou/atualizou plugins Capacitor nativos

---

## Pré-requisitos

| Ferramenta | Versão | Onde fica |
|---|---|---|
| Java | **21** (via Android Studio JBR) | `C:/Program Files/Android/Android Studio/jbr` |
| Android Studio | Qualquer recente | Para Gradle e SDK |
| Node.js | 18+ | Sistema |

> ⚠️ O Java do sistema pode ser incompatível (ex: Java 26 → erro "Unsupported class file major version 70").
> **Sempre use o Java embutido no Android Studio.**

---

## Comando de Build (Recomendado)

```bash
npm run build:apk
```

Este script (`scripts/build-apk.js`) faz automaticamente:
1. Move APKs de `public/downloads/` para temp (evita serem bundlados no APK)
2. `npm run build` (Vite)
3. `npx cap sync android`
4. `gradlew assembleDebug` com `JAVA_HOME` do Android Studio
5. Copia o APK gerado para `public/downloads/LyFe Hoteles.apk`
6. Restaura arquivos movidos

---

## Build Manual (passo a passo)

```bash
# 1. Remover APKs de public/downloads/ antes de buildar
# (evita que sejam bundlados dentro do APK final)
rm public/downloads/*.apk

# 2. Build do web
npm run build

# 3. Sync para Android
npx cap sync android

# 4. Build do APK (usar Java do Android Studio)
cd android
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew.bat assembleDebug

# 5. APK gerado em:
# android/app/build/outputs/apk/debug/app-debug.apk

# 6. Copiar para public/downloads/
cp android/app/build/outputs/apk/debug/app-debug.apk "public/downloads/LyFe Hoteles.apk"
```

---

## Fazer Release de Nova Versão

### 1. Bump de versão em `android/app/build.gradle`
```gradle
versionCode 4          # incrementar +1 sempre
versionName "1.2.0"    # semver: major.minor.patch
```

### 2. Atualizar `public/update-manifest.json`
```json
{
  "latestVersion": "1.2.0",
  "url": "/downloads/LyFe%20Hoteles.apk",
  "notes": "Descrição das mudanças desta versão.",
  "minVersion": "1.0.0",
  "forceUpdate": false
}
```

### 3. Buildar o APK
```bash
npm run build:apk
```

### 4. Commit e push
```bash
git add android/app/build.gradle public/update-manifest.json "public/downloads/LyFe Hoteles.apk"
git commit -m "release(android): vX.X.X — descrição"
git push
```

> O push do APK (68MB) gera um aviso do GitHub mas passa normalmente (limite hard = 100MB).

### 5. Netlify deploy automático
Após o push, o Netlify reimplanta em ~2 min. O arquivo fica disponível em:
```
https://lyfehoteles.com.br/downloads/LyFe%20Hoteles.apk
```

---

## Sistema de Auto-Atualização

### Fluxo
```
APK abre (qualquer tela)
  → useAppUpdate detecta isNativePlatform() = true
  → Busca https://lyfehoteles.com.br/update-manifest.json
  → Compara manifest.latestVersion vs App.getInfo().version
  → Se manifest > instalado: exibe AppUpdateModal
  → Usuário toca "ATUALIZAR AGORA"
  → Browser.open(https://lyfehoteles.com.br/downloads/LyFe%20Hoteles.apk)
  → Usuário baixa e instala manualmente
```

### Arquivos envolvidos
| Arquivo | Responsabilidade |
|---|---|
| `src/hooks/useAppUpdate.ts` | Lógica de verificação de versão |
| `src/components/AppUpdateModal.tsx` | UI do modal de atualização |
| `public/update-manifest.json` | Fonte de verdade da versão mais recente |
| `android/app/build.gradle` | Versão instalada no APK (`versionName`) |

### `forceUpdate: true`
Quando `true`, o modal não tem botão de fechar — o usuário é obrigado a atualizar.
Usar apenas em casos críticos (breaking changes de banco de dados, etc.).

---

## Google OAuth no APK

O login com Google usa **PKCE flow** via in-app browser:

1. `Capacitor.isNativePlatform()` detecta que está no APK
2. `supabase.auth.signInWithOAuth({ skipBrowserRedirect: true })` retorna URL do Google
3. `Browser.open(url)` abre o in-app browser (Chrome Custom Tab)
4. Usuário autentica no Google
5. Google redireciona para `com.lyfe.fluxo://login-callback?code=...`
6. `App.addListener('appUrlOpen', ...)` captura o deep link
7. `supabase.auth.exchangeCodeForSession(code)` troca o code por sessão
8. In-app browser fecha, usuário está logado

### Configurações necessárias no Supabase Dashboard
`Authentication → URL Configuration → Redirect URLs`:
```
https://lyfehoteles.com.br/
com.lyfe.fluxo://login-callback
```

### Supabase Client (PKCE global)
```ts
// src/lib/supabase.ts
export const supabase = createClient(url, key, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
  },
});
```

---

## Versões Histórico

| Versão | versionCode | Data | Notas |
|---|---|---|---|
| 1.0.0 | 1 | 2025-05 | Lançamento inicial |
| 1.0.1 | 2 | 2025-05 | Correções gerais |
| 1.1.0 | 3 | 2026-05 | Google OAuth PKCE, WhatsApp module, fichas técnicas |
