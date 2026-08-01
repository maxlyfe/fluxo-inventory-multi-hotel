// netlify/functions/lib/crypto.ts
// Cifra e decifra segredos que precisam ficar guardados no banco mas nunca podem
// ser legíveis a partir dele (hoje: a senha de app SMTP de cada unidade).
//
// AES-256-GCM com a chave em EMAIL_CONFIG_KEY, que existe só no ambiente da
// Netlify. Consequência prática: nem service_role no SQL Editor consegue ler a
// senha, porque a chave não está no banco. É o oposto do que acontece hoje com
// nf_hotel_config.certificado_senha, guardado em texto puro.
//
// Formato do texto cifrado: base64( iv(12) || authTag(16) || ciphertext ).

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

export class CryptoConfigError extends Error {}

/**
 * Deriva 32 bytes a partir da env. Aceita chave de qualquer tamanho para não
 * obrigar a gerar exatamente 32 caracteres na mão, mas exige um mínimo: chave
 * curta derivada não fica mais forte por passar por SHA-256.
 */
function key(): Buffer {
  const raw = process.env.EMAIL_CONFIG_KEY ?? '';
  if (raw.length < 24) {
    throw new CryptoConfigError(
      'EMAIL_CONFIG_KEY ausente ou muito curta (mínimo 24 caracteres). ' +
      'Gere com: openssl rand -base64 32'
    );
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length <= IV_LEN + TAG_LEN) {
    throw new CryptoConfigError('Texto cifrado inválido ou truncado');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  // Se a EMAIL_CONFIG_KEY mudou, o authTag não confere e o final() lança. É o
  // comportamento desejado: melhor falhar do que enviar com senha errada e
  // queimar tentativas contra o Google.
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** true quando a env está configurada, para a tela avisar antes de tentar salvar. */
export function isCryptoConfigured(): boolean {
  try { key(); return true; } catch { return false; }
}
