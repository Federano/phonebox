# Federano — instruções para o Claude Code

Leia também o AGENTS.md (regras do dono, onde fica cada coisa, como testar).

## Regras de economia de tokens (do projeto ECONOMIZA)

- Responda curto e direto. Sem resumo do que acabou de fazer, sem repetir a pergunta.
- Antes de abrir arquivos, consulte o mapa do Graphify: `graphify-out/GRAPH_REPORT.md` ou `graphify query "<pergunta>"`. Abra só os arquivos que o mapa apontar.
- Não releia arquivo já lido nesta conversa; leia só o trecho necessário (offset/limit, grep).
- Não cole saídas longas: filtre (`Select-Object -First/-Last`, `grep`).
- Uma tarefa por conversa: use `/compact` quando a conversa crescer e `/clear` ao trocar de tarefa.
- Prefira a solução mais simples que funciona (modo Ponytail).
