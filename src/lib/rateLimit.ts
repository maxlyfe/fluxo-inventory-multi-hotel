// src/lib/rateLimit.ts
// Detecta a resposta 429 da guarda anti-enumeração de `get_group_by_slug`
// (migration 20260729120200_group_slug_guard.sql).
//
// A função SQL responde com `set_config('response.status', '429')` e corpo
// vazio. Dependendo da versão do supabase-js isso chega como `status: 429`,
// como `code: '429'` ou apenas embutido na mensagem — por isso a checagem
// cobre as três formas.

export const SLUG_RATE_LIMIT_SECONDS = 30;

export const SLUG_RATE_LIMIT_MESSAGE =
  `Muitas tentativas. Aguarde ${SLUG_RATE_LIMIT_SECONDS}s antes de tentar de novo.`;

/** Erro lançado por helpers que não podem devolver o objeto de erro cru. */
export class SlugRateLimitError extends Error {
  constructor() {
    super(SLUG_RATE_LIMIT_MESSAGE);
    this.name = 'SlugRateLimitError';
  }
}

export function isRateLimit(err: unknown): boolean {
  if (err instanceof SlugRateLimitError) return true;
  if (!err) return false;
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status === 429) return true;
  if (e.code === '429') return true;
  return /\b429\b|too many requests|rate limit/i.test(e.message ?? '');
}
