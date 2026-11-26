# Federano — guia para o Gemini (e outras IAs)

Federano é a versão pessoal do Fernando do **PhoneBox**: um tablet Android (iPlay50 Pro) ao lado do PC vira um painel
com widgets, letra do Spotify, podcast, espelhamento de vídeo e comandos de voz. Tudo em português do Brasil.

Leia este arquivo inteiro antes de mudar qualquer coisa.

## Regras do dono (obrigatórias)

1. **Nunca toque em `D:\VSCODE\AUTOFLOW`**, de jeito nenhum.
2. **Nunca instale o app no tablet** (`adb install`) sem o Fernando pedir com as palavras "pode instalar".
3. **Nada de mudança visual sem OK.** Mostre uma prévia (imagem ou página) e espere a aprovação antes de aplicar um
   visual novo. Tema 00 (o atual) e Tema 01 (Minimalista) já existem; não mude o visual deles por conta própria.
4. Antes de mexer nas configurações do PC (`%APPDATA%\Federano\config.json`), faça uma cópia do arquivo.
5. Trabalhe no branch **`federano`**. Não use o branch `main`. Não force push.
6. Commits em português, começando com `Federano:` e dizendo o que mudou para o usuário, por exemplo
   `Federano: botão de pular propaganda no podcast`. Termine a mensagem com a linha `Feito-por: Gemini`, para o Claude
   saber o que revisar.
7. Não instale a atualização "0.9.x disponível" do PhoneBox original: ela apagaria o Federano.
8. Não coloque chaves de API, tokens ou senhas em arquivos do repositório.
9. Divida tarefas grandes em blocos de até 5 minitarefas e avance parte por parte, informando o progresso.
10. Acumule as melhorias no código e nos testes para uma única atualização ao final. Não instale APKs nem substitua
    o agente em execução durante essa preparação; aguarde o Fernando pedir a atualização final, mantendo a regra 2.
11. **Registro de quem fez o quê.** No fim de cada edição, escreva no topo do seu arquivo o que você fez:
    o Claude escreve em `claude.txt`, o ChatGPT (ou outra IA) em `gpt.txt`. Antes de começar, leia os dois para saber o
    que a outra IA fez por último. Cada registro: data e hora, o que mudou para o Fernando, arquivos, commit (ou "sem
    commit"), testes que passaram ou falharam, e se instalou no tablet ou trocou o agente.

## Onde fica cada coisa

| Parte | Caminho | Linguagem |
|---|---|---|
| Agente do PC (servidor na porta 8775, Wi-Fi 8776) | `agent/PhoneBox.Agent/` | C# .NET 10 |
| Testes do agente | `agent/PhoneBox.Agent.Tests/` | xUnit |
| Painel do tablet (o que aparece na tela) | `android/app/src/main/assets/www/` | JavaScript (módulos ES) + CSS |
| App Android (casca, microfone, conexão) | `android/app/src/main/java/net/oxog/phonebox/deskpanel/` | Kotlin |
| Testes de tela (Playwright, rodam no navegador com um PC de mentira) | `tools/ui-tests/` | JS |
| PC de mentira dos testes | `tools/pages/demo.js` | JS |
| Extensão do Chrome (espelhamento) | `extras/chrome-federano/` | JS |
| Comandos de voz ("skills") | `agent/PhoneBox.Agent/skills/*.json` | JSON |
| Catálogo de widgets | `agent/PhoneBox.Agent/widgets.json` | JSON |

Arquivos do Federano que mais importam:
- `www/widgets/lyrics.js` — tela da letra do Spotify e do podcast (fundo animado num worker, sincronia da letra).
- `www/themes.js` — tela "Temas" (Tema 00 / Tema 01). Estilos do Tema 01 no fim de `www/style.css` (`body[data-ftheme="01"]`).
- `www/edit.js` — editar a página pelo tablet. Agente: `PanelEdit.cs` (o que o tablet pode mudar).
- `www/edit-sync.js` — catálogo offline, edições locais, sincronização e conflitos por PC.
- `www/wake.js` — "Federano, ..." sempre ouvindo (desligado por padrão).
- `www/mirror.js` — espelhamento e controles.
- Agente: `SpotifyControl.cs`, `Lyrics.cs`, `MediaMonitor.cs`, `Skills.cs`, `Lan.cs` (lista do que o tablet pode pedir pelo Wi-Fi), `Program.cs` (rotas `/api/...`).

## Compilar e testar

Agente (PowerShell, na pasta `agent`):

```
dotnet build PhoneBox.Agent/PhoneBox.Agent.csproj -c Release -f net10.0-windows10.0.19041.0
dotnet test PhoneBox.Agent.Tests
```

Testes de tela (na pasta `tools/ui-tests`; o Chromium do Playwright já está instalado):

```
npx playwright test lyrics.spec.js themes.spec.js edit-page.spec.js edit-offline.spec.js
```

Já falhavam antes e não são problema seu: `i18n-coverage.spec.js` (textos em vietnamita) e `navigation.spec.js:140`.

Colocar o agente novo no ar (fecha o agente, copia e abre de novo):

```
$src="agent\PhoneBox.Agent\bin\Release\net10.0-windows10.0.19041.0"; $dst="$env:LOCALAPPDATA\Federano\app"
Get-Process PhoneBoxAgent -ErrorAction SilentlyContinue | Stop-Process -Force; Copy-Item "$src\*" $dst -Recurse -Force; Start-Process "$dst\PhoneBoxAgent.exe"
```

App do tablet (só gerar; instalar só com "pode instalar"), na pasta `android`:

```
$env:JAVA_HOME="$env:LOCALAPPDATA\Programs\jdk17\jdk-17.0.21.1+2"; .\gradlew.bat assembleDebug
```

O arquivo sai em `android/app/build/outputs/apk/debug/app-debug.apk`. Se o `adb` não enxergar o tablet, use
`$env:ADB_LIBUSB="1"; adb kill-server; adb devices`.

## Cuidados técnicos

- O tablet fala com o PC pelo USB (`adb reverse`) ou pelo Wi-Fi. Pelo Wi-Fi, só passam as rotas listadas em `Lan.cs`;
  rota nova que o tablet usa precisa entrar lá.
- O tablet é fraco para efeitos: evite `filter: blur()` animado e sombras grandes em canvas. Meça a fluidez com
  `adb shell dumpsys gfxinfo com.federano.painel`.
- Arquivos `.cs` usam CRLF; mantenha.
- Nada do tablet pode rodar comandos no PC sem passar pelas regras do agente (veja `PanelEdit.cs`).

## O que está pendente (ideias combinadas, ainda não feitas)

- Botão "Pular propaganda" no podcast (+1 minuto) e comando de voz "Federano, pula a propaganda".
- Pular propaganda automático (precisa de um modelo de voz; esperar a decisão do Fernando).
- Animações da tela inicial no Tema 01 (relógio subindo, linha dos segundos, temperatura contando).

O Claude revisa o trabalho pelo `git log` (commits com `Feito-por: Gemini`).

## Editor do tablet: português e uso offline

- O catálogo em português fica em `CATALOG.pt`, no `www/i18n.js`; o editor preserva os valores técnicos e os textos do usuário.
- Depois de uma conexão com o agente atualizado, o catálogo e as regras ficam disponíveis offline no tablet.
- Salvar guarda uma edição durável e já aplica a organização no tablet. O envio ocorre quando o painel consegue alcançar
  o agente no PC por USB, Wi-Fi ou Tailscale. Ter internet sem acesso ao PC não basta; não há serviço de nuvem.
- Edições pertencem a um PC específico. Mudanças simultâneas na mesma página pedem uma escolha entre PC e tablet;
  uma página removida no PC continua guardada localmente até o usuário descartar a edição.
- O app Android usa a ponte nativa `savePage` para enviar o corpo JSON. Não use o proxy comum para POSTs com corpo:
  a interceptação do WebView não consegue ler esse corpo.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
