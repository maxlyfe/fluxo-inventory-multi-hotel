#!/usr/bin/env node
/**
 * build-webcheckin-apk.js
 *
 * Cria um APK Capacitor SECUNDÁRIO dedicado ao Web Check-in.
 * Diferenças em relação ao APK principal:
 *   - applicationId : com.lyfe.webcheckin  (instala lado a lado, não conflita)
 *   - app name      : "LyFe Check-in"
 *   - server.url    : https://lyfehoteles.com.br/web-checkin
 *   - deep link OAuth removido (este APK não faz login do Google)
 *
 * O script reusa o projeto Android existente: copia android/ → android-webcheckin/,
 * aplica os patches e roda o gradle separado. Não toca em nada do APK principal.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SRC       = path.join(ROOT, 'android');
const DST       = path.join(ROOT, 'android-webcheckin');
const DOWNLOADS = path.join(ROOT, 'public', 'downloads');
const APK_OUT   = path.join(DST, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APK_NAME  = 'LyFe Check-in.apk';
const JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr';

// Identidade do APK Web Check-in
const APP_ID      = 'com.lyfe.webcheckin';
const APP_NAME    = 'LyFe Check-in';
const APP_URL     = 'https://lyfehoteles.com.br/web-checkin';
const VERSION_CODE = 1;
const VERSION_NAME = '1.0.0';

function log(msg) { console.log(`\n▶ ${msg}`); }
function run(cmd, opts = {}) {
  log(cmd);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Limpar destino e copiar android/ → android-webcheckin/
// ─────────────────────────────────────────────────────────────────────────────
log('Preparando projeto Android secundário');
if (fs.existsSync(DST)) {
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.cpSync(SRC, DST, {
  recursive: true,
  // Ignora artefatos de build do projeto principal
  filter: (src) => !/[\\/](build|\.gradle|\.idea|\.cxx)([\\/]|$)/.test(src),
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Patch: app/build.gradle (applicationId + versão)
// ─────────────────────────────────────────────────────────────────────────────
const gradlePath = path.join(DST, 'app', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/applicationId\s+"com\.lyfe\.fluxo"/, `applicationId "${APP_ID}"`);
gradle = gradle.replace(/versionCode\s+\d+/,                  `versionCode ${VERSION_CODE}`);
gradle = gradle.replace(/versionName\s+"[\d.]+"/,             `versionName "${VERSION_NAME}"`);
// Mantém namespace = "com.lyfe.fluxo" para não precisar mover MainActivity.java
fs.writeFileSync(gradlePath, gradle);
log(`build.gradle patched: applicationId=${APP_ID}, v${VERSION_NAME} (code ${VERSION_CODE})`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Patch: res/values/strings.xml
// ─────────────────────────────────────────────────────────────────────────────
const stringsPath = path.join(DST, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const stringsXml = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">${APP_NAME}</string>
    <string name="title_activity_main">${APP_NAME}</string>
    <string name="package_name">${APP_ID}</string>
    <string name="custom_url_scheme">${APP_ID}</string>
</resources>
`;
fs.writeFileSync(stringsPath, stringsXml);
log(`strings.xml: app_name="${APP_NAME}"`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Patch: AndroidManifest.xml (remove intent-filter de deep link OAuth)
// ─────────────────────────────────────────────────────────────────────────────
const manifestPath = path.join(DST, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
// Remove o bloco inteiro do intent-filter VIEW (deep link OAuth — não usado pelo check-in)
manifest = manifest.replace(
  /\s*<intent-filter>\s*<action android:name="android\.intent\.action\.VIEW"\s*\/>[\s\S]*?<\/intent-filter>/g,
  ''
);
fs.writeFileSync(manifestPath, manifest);
log('AndroidManifest.xml: intent-filter de deep link OAuth removido');

// ─────────────────────────────────────────────────────────────────────────────
// 5. Patch: capacitor.config.json (server.url + identidade)
// ─────────────────────────────────────────────────────────────────────────────
const capConfigPath = path.join(DST, 'app', 'src', 'main', 'assets', 'capacitor.config.json');
const capConfig = {
  appId:   APP_ID,
  appName: APP_NAME,
  webDir:  'dist',
  server: {
    url:       APP_URL,
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};
fs.writeFileSync(capConfigPath, JSON.stringify(capConfig, null, 2));
log(`capacitor.config.json: server.url=${APP_URL}`);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Gradle build (Java 21 do Android Studio JBR)
// ─────────────────────────────────────────────────────────────────────────────
if (process.platform === 'win32') {
  run(
    `powershell -NoProfile -Command "` +
    `$env:JAVA_HOME='${JAVA_HOME}'; ` +
    `Set-Location '${DST.replace(/'/g, "''")}'; ` +
    `.\\gradlew.bat assembleDebug"`,
    { cwd: DST, env: { ...process.env, JAVA_HOME } }
  );
} else {
  run('./gradlew assembleDebug', { cwd: DST, env: { ...process.env, JAVA_HOME } });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Copiar APK para public/downloads/
// ─────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(APK_OUT)) {
  console.error(`✗ APK não encontrado em ${APK_OUT}`);
  process.exit(1);
}
fs.mkdirSync(DOWNLOADS, { recursive: true });
const apkDst = path.join(DOWNLOADS, APK_NAME);
fs.copyFileSync(APK_OUT, apkDst);
const sizeMB = (fs.statSync(apkDst).size / 1024 / 1024).toFixed(1);

console.log('\n────────────────────────────────────────────────');
console.log(`✅ ${APP_NAME} v${VERSION_NAME} criado com sucesso!`);
console.log(`   Arquivo : public/downloads/${APK_NAME}`);
console.log(`   Tamanho : ${sizeMB} MB`);
console.log(`   App ID  : ${APP_ID}`);
console.log(`   URL     : ${APP_URL}`);
console.log('────────────────────────────────────────────────');
console.log('\nPróximos passos:');
console.log('  1. git add public/downloads/LyFe\\ Check-in.apk');
console.log('  2. git commit -m "release(webcheckin): vX.X.X"');
console.log('  3. git push');
console.log('  4. Download via lyfehoteles.com.br/downloads/LyFe Check-in.apk\n');
