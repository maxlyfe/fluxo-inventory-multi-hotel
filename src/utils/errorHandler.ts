/**
 * errorHandler.ts
 * Centraliza o tratamento de erros do sistema para evitar Info Leakage
 * e melhorar a experiência do usuário.
 */

export interface AppError {
  message: string;
  code?: string;
  originalError?: any;
}

const ERROR_MAP: Record<string, string> = {
  'PGRST116': 'O registro solicitado não foi encontrado.',
  '23505': 'Já existe um registro com estes dados (duplicidade).',
  '23503': 'Este item não pode ser excluído pois está sendo usado em outro lugar.',
  '42P01': 'Erro de configuração no servidor. Contate o suporte.', // Table not found
  '42703': 'Erro de compatibilidade de dados. Contate o suporte.', // Column not found
  'JWT expired': 'Sua sessão expirou. Por favor, faça login novamente.',
};

/**
 * Traduz erros técnicos para mensagens amigáveis ao usuário.
 * Silencia detalhes internos em ambiente de produção.
 */
export const sanitizeError = (error: any): string => {
  if (!error) return 'Ocorreu um erro inesperado.';

  const isDev = import.meta.env.DEV;
  const code = error.code || error.status || (error.message?.includes('JWT') ? 'JWT expired' : '');
  const rawMessage = error.message || String(error);

  // 1. Log detalhado apenas em desenvolvimento
  if (isDev) {
    console.group('🛠️ [Debug Error]');
    console.error('Original Error:', error);
    console.error('Code:', code);
    console.groupEnd();
  }

  // 2. Tradução por código
  if (code && ERROR_MAP[code]) {
    return ERROR_MAP[code];
  }

  // 3. Verificação de palavras-chave para erros comuns
  if (rawMessage.includes('failed to fetch') || rawMessage.includes('Network Error')) {
    return 'Erro de conexão. Verifique sua internet.';
  }

  // 4. Mensagem genérica segura para produção
  return 'Não foi possível completar a operação. Tente novamente em instantes.';
};
