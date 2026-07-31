// netlify/functions/lib/nfse-discriminacao.ts
// Monta o texto de discriminação dos serviços dentro do limite de tamanho do
// leiaute. Tanto o <xDescServ> do DPS nacional (tipo TSDesc2000) quanto o
// <Discriminacao> do ABRASF 2.04 aceitam no máximo 2000 caracteres, e a conta
// de uma hospedagem passa disso com facilidade: cada dia de pensão (MAP/FAP)
// entra como uma linha de R$ 0,00 repetida, uma por refeição por dia.

export const NFSE_DISCRIMINACAO_MAX = 2000;

export interface DiscriminacaoItem {
  description: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
}

const linhaDe = (it: DiscriminacaoItem) =>
  `${it.description} - Qtd: ${it.quantidade} x R$ ${it.valor_unitario.toFixed(2)} = R$ ${it.valor_total.toFixed(2)}`;

/**
 * Reduz a discriminação em dois estágios, só até caber:
 * 1. agrupa itens idênticos (mesma descrição e mesmo valor unitário), somando
 *    quantidade e total — não perde informação, só deixa de repetir linha;
 * 2. mantém as linhas que couberem e resume o resto em "(+ N itens - R$ X)",
 *    para o valor total da nota continuar explicado no texto.
 */
export function buildDiscriminacao(
  items: DiscriminacaoItem[],
  separator: string,
  maxLength = NFSE_DISCRIMINACAO_MAX,
): string {
  const completa = items.map(linhaDe).join(separator);
  if (completa.length <= maxLength) return completa;

  const grupos = new Map<string, DiscriminacaoItem>();
  for (const it of items) {
    const chave = `${it.description}|${it.valor_unitario.toFixed(2)}`;
    const atual = grupos.get(chave);
    if (atual) {
      atual.quantidade += it.quantidade;
      atual.valor_total += it.valor_total;
    } else {
      grupos.set(chave, { ...it });
    }
  }
  const linhas = Array.from(grupos.values());

  const agrupada = linhas.map(linhaDe).join(separator);
  if (agrupada.length <= maxLength) return agrupada;

  for (let mantidas = linhas.length - 1; mantidas >= 1; mantidas--) {
    const restantes = linhas.slice(mantidas);
    const total = restantes.reduce((s, it) => s + it.valor_total, 0);
    const resumo = `(+ ${restantes.length} ${restantes.length === 1 ? 'item' : 'itens'} - R$ ${total.toFixed(2)})`;
    const texto = linhas.slice(0, mantidas).map(linhaDe).join(separator) + separator + resumo;
    if (texto.length <= maxLength) return texto;
  }

  // Nem a primeira linha cabe (descrição gigante num item só).
  return agrupada.slice(0, maxLength);
}
