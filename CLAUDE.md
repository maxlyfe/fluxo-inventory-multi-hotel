# Regra de Memória — Cofre Obsidian (leia antes de qualquer coisa)

Este projeto tem uma memória externa persistente no Obsidian, em:

```
D:\Cofre Obsidian LyFe-Hoteles\LyFe-Hoteles\
```

Ela existe para que nenhuma decisão, integração, achado de segurança ou padrão de código se perca entre sessões — o código muda rápido, e essa memória é a fonte de verdade sobre *por quê* as coisas são como são, além de *o quê*.

## Regra obrigatória

1. **Antes de começar qualquer tarefa** neste repositório — implementar feature, corrigir bug, mexer em schema, revisar segurança, o que for — leia primeiro `D:\Cofre Obsidian LyFe-Hoteles\LyFe-Hoteles\00-Indice.md` e, a partir dele, as notas relevantes ao que será feito. Não assuma o estado do projeto a partir de memória de sessões anteriores nem só do código: confira o cofre.
2. **Depois de implementar qualquer coisa** — feature nova, migration, correção de bug relevante, mudança de arquitetura, integração nova, correção de segurança — atualize a(s) nota(s) afetada(s) no cofre e registre a mudança em `09-Log-de-Mudancas.md` (data, o que mudou, por quê, arquivos/tabelas envolvidos). Isso é parte de terminar a tarefa, não um passo opcional.
3. Se a tarefa criar um módulo, integração ou área nova sem nota correspondente no cofre, crie a nota antes de considerar o trabalho concluído.
4. Se notar que uma nota do cofre está desatualizada em relação ao código atual, corrija-a como parte do trabalho em curso.

## Mapa rápido do cofre

| Nota | Conteúdo |
|---|---|
| `00-Indice.md` | Ponto de entrada — mapa de todas as notas |
| `01-Visao-Geral.md` | O que é o sistema, modelo multi-tenant, status atual |
| `02-Arquitetura-Tecnica.md` | Stack, estrutura de pastas, contextos, permissões, navegação, débitos técnicos |
| `03-Modulos-do-Sistema.md` | Todos os módulos funcionais e suas páginas/permissões |
| `04-Banco-de-Dados.md` | Convenções de schema Supabase, RLS, migrations, funções RPC |
| `05-Integracoes-Externas.md` | Erbon, Omnibees, WhatsApp, Firebase FCM, NF-e/NFS-e, Turnstile |
| `06-Seguranca.md` | Achados de segurança, o que já foi corrigido, o que está pendente |
| `07-Padroes-de-Codigo.md` | Convenções obrigatórias (inputs decimais, atomicidade de estoque, idempotência) |
| `08-Mobile-Android.md` | Capacitor, build de APK, auto-update, OAuth PKCE |
| `10-Hoteis-da-Rede.md` | Hotéis/unidades do grupo de referência |
| `09-Log-de-Mudancas.md` | Changelog cronológico — toda mudança relevante entra aqui |

## Por que isso importa aqui

Este é um sistema de gestão hoteleira multi-tenant com módulos fiscais (NF-e/NFS-e), financeiros, de PMS e de RH — erros de contexto custam caro (dado sensível exposto, saldo de estoque incorreto, nota fiscal emitida errada). A auditoria de segurança de 29/07/2026 (`06-Seguranca.md`) tem achados críticos ainda pendentes; qualquer tarefa em módulos fiscais, de integração ou autenticação deve conferir essa nota antes de mexer em código relacionado.

Os documentos técnicos que já existiam no repositório (`README.md`, `GEMINI.md`, `ANALISE_PROJETO_2026-07-22.md`, `NOTA_SEGURANCA_2026-07-29.md`, `SECURITY_HARDENING.md`) continuam valendo como registro histórico, mas o cofre Obsidian é o lugar que se mantém atualizado a cada sessão — é ele que deve ser consultado primeiro.
