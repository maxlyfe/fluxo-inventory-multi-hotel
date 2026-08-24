#!/usr/bin/env node
// scripts/check-fatal-ts.mjs
//
// Portão de build contra erros de TypeScript que viram crash em produção.
//
// Contexto: o build rodava `tsc --noEmit` sem `-p`, então caía no
// tsconfig.json da raiz — que é um projeto-solução (`files: []` + `references`).
// Sem `--build`, o tsc não entra nos projetos referenciados: checava zero
// arquivo e saía com sucesso. Um `formatDistanceToNow` sem import passou por
// esse "typecheck" e derrubou a tela inteira em produção.
//
// O projeto tem um passivo grande de erros de tipo (mais de mil, quase todos
// TS2345 de assinatura de addNotification e TS6133 de import não usado). Travar
// o build em tudo isso pararia o deploy hoje. Então este portão bloqueia apenas
// os códigos que **quebram em runtime** e que hoje estão zerados:
//
//   TS2304  Cannot find name           (identificador inexistente)
//   TS2552  Cannot find name (did you mean...)
//
// Ambos significam a mesma coisa na prática: a linha explode assim que executa.
// Manter esses dois em zero é o que impede a regressão que aconteceu.
//
// Para endurecer com o tempo, acrescente códigos a FATAL conforme forem sendo
// zerados — o número de erros restantes é impresso a cada execução.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const FATAL = ['TS2304', 'TS2552'];
const PROJECT = 'tsconfig.app.json';

const padrao = new RegExp(`error (${FATAL.join('|')})\\b`);

const require = createRequire(import.meta.url);
let tscPath;
try {
  tscPath = require.resolve('typescript/bin/tsc');
} catch {
  console.error('[check-fatal-ts] typescript nao encontrado em node_modules. Rode npm install.');
  process.exit(1);
}

console.log(`[check-fatal-ts] tsc --noEmit -p ${PROJECT}`);

// Chama o tsc pelo entrypoint JS com o próprio node, em vez de npx: no Windows
// o Node recusa spawnar `.cmd` sem shell, e a chamada falhava em silêncio — o
// portão passava sem ter checado nada, repetindo exatamente o erro que ele
// existe para impedir.
const res = spawnSync(process.execPath, [tscPath, '--noEmit', '-p', PROJECT], { encoding: 'utf8' });

if (res.error) {
  console.error(`[check-fatal-ts] falha ao executar o tsc: ${res.error.message}`);
  process.exit(1);
}

// tsc sai com código != 0 sempre que há QUALQUER erro. Aqui o que decide é o
// conteúdo, não o código de saída — o passivo conhecido não pode parar o build.
const saida = `${res.stdout || ''}${res.stderr || ''}`;
const linhas = saida.split('\n').filter(Boolean);

const fatais = linhas.filter(l => padrao.test(l));
const totalErros = linhas.filter(l => / error TS\d+/.test(l)).length;

// Saída vazia com status de erro significa que o tsc nem chegou a rodar.
// Aprovar aqui seria, de novo, um "typecheck" que não checa nada.
if (res.status !== 0 && totalErros === 0) {
  console.error(
    `[check-fatal-ts] o tsc saiu com status ${res.status} sem reportar erro nenhum. `
    + 'Isso indica que ele nao rodou de verdade — o portao nao pode aprovar assim.',
  );
  if (saida.trim()) console.error(saida);
  process.exit(1);
}

if (fatais.length > 0) {
  console.error('\n[check-fatal-ts] Erros que quebram em runtime:\n');
  for (const l of fatais) console.error(`  ${l}`);
  console.error(
    `\n${fatais.length} erro(s) fatal(is). Sao identificadores que nao existem: `
    + 'a linha explode assim que executar. Corrija antes do deploy.\n',
  );
  process.exit(1);
}

console.log(
  `[check-fatal-ts] OK — nenhum ${FATAL.join('/')}. `
  + `(${totalErros} erros de tipo nao-fatais no passivo do projeto)`,
);
