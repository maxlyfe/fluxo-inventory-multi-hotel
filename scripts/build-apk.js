#!/usr/bin/env node
/**
 * build-apk.js
 * Compila o APK Android sem incluir os APKs de /public/downloads/ nos assets.
 *
 * Passos:
 *  1. Move APKs de public/downloads/ para temp (evita bundling no android assets)
 *  2. npm run build (Vite)
 *  3. npx cap sync android
 *  4. gradlew assembleDebug com JAVA_HOME do Android Studio
 *  5. Copia o APK gerado para public/downloads/
 *  6. Restaura APKs antigos do temp (se houver)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DOWNLOADS = path.join(ROOT, 'public', 'downloads');
const TEMP      = path.join(ROOT, '.apk-temp');
const ANDROID   = path.join(ROOT, 'android');
const APK_OUT   = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr';

function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

// ── 1. Mover APKs de downloads/ para temp ──────────────────────────────────
fs.mkdirSync(TEMP, { recursive: true });
const moved = [];
for (const f of fs.readdirSync(DOWNLOADS)) {
  if (f.endsWith('.apk')) {
    fs.renameSync(path.join(DOWNLOADS, f), path.join(TEMP, f));
    moved.push(f);
    console.log(`📦 Movido temporariamente: ${f}`);
  }
}

try {
  // ── 2. Build web ───────────────────────────────────────────────────────────
  run('npm run build', { cwd: ROOT });

  // ── 3. Cap sync ────────────────────────────────────────────────────────────
  run('npx cap sync android', { cwd: ROOT });

  // ── 4. Gradle build ────────────────────────────────────────────────────────
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  run(`${gradlew} assembleDebug`, {
    cwd: ANDROID,
    env: { ...process.env, JAVA_HOME },
  });

  // ── 5. Copiar APK gerado para public/downloads/ ────────────────────────────
  const destName = 'LyFe Hoteles.apk';
  fs.copyFileSync(APK_OUT, path.join(DOWNLOADS, destName));
  const { size } = fs.statSync(path.join(DOWNLOADS, destName));
  console.log(`\n✅ APK copiado: public/downloads/${destName} (${(size / 1024 / 1024).toFixed(1)} MB)`);

} finally {
  // ── 6. Restaurar APKs antigos do temp (sempre, mesmo em erro) ─────────────
  for (const f of moved) {
    const src  = path.join(TEMP, f);
    const dest = path.join(DOWNLOADS, f);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.renameSync(src, dest);
    } else if (fs.existsSync(src)) {
      fs.unlinkSync(src); // APK novo já está no lugar
    }
  }
  fs.rmdirSync(TEMP, { recursive: true });
}

console.log('\n🚀 Build do APK concluído com sucesso!');
console.log('   Próximo passo: git add public/downloads + commit + push');
