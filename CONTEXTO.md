# CONTEXTO — GeminiControllerFlow (extensão Firefox)

## Estado atual

Extensão Firefox (Manifest V2) que abre o Gemini na barra lateral, lê a página aberta e executa ações nela (equivalente ao "Claude para Chrome"). Versão 1.0.0, criada em 14/11/2026.

- Motor padrão **"Minha conta Google"**: usa o `gemini.google.com` logado na conta do usuário, numa aba fixada, sem chave de API.
- Motor alternativo **"Chave da API"**: API oficial `generativelanguage.googleapis.com` com function calling.
- 15 ferramentas: `get_page`, `get_text`, `screenshot`, `click`, `type_text`, `select_option`, `press_key`, `scroll`, `hover`, `navigate`, `wait`, `list_tabs`, `switch_tab`, `open_tab`, `run_javascript`.
- `web-ext lint`: 0 erros, 0 avisos, 0 notas.

## Histórico de implementações

### 14/11/2026 — versão 1.0.1 (barra à direita e botões)

- **Bug**: os botões Enviar e Parar apareciam juntos. A classe `.send` define `display: grid`, que anula o atributo `hidden`. O mesmo afetava os blocos de configuração por motor. Correção: regra global `[hidden] { display: none !important; }` no `sidebar.css`.
- **Barra lateral à direita**: a posição é preferência do Firefox, não da extensão (não há API para isso). Criado `user.js` no perfil `xi81vy5u.default-release` com `sidebar.position_start = false`; vale ao reiniciar o Firefox. Para voltar ao padrão, apagar o `user.js`.
- `scripts/assinar-e-instalar.ps1` agora lê as credenciais do `.env` (aceita `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` ou "Emissor JWT"/"Segredo JWT", com `=` ou `:`), sem exibir os valores.
- Versão 1.0.1 assinada (`web-ext-artifacts/a6e4eca4a5b84242aab2-1.0.1.xpi`) e aberta no Firefox para atualizar.

### 14/11/2026 — instalação definitiva

- O Firefox da máquina é o **160.0, canal release**: ele ignora `xpinstall.signatures.required` e só instala de vez extensões assinadas pela Mozilla.
- Criado `scripts/assinar-e-instalar.ps1` (UTF-8 com BOM, para os acentos saírem certos no PowerShell 5.1): lê `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` ou pede no terminal (segredo como SecureString, sem gravar em arquivo), roda `web-ext sign --channel=unlisted`, abre o `.xpi` assinado no Firefox e apaga o segredo da sessão.
- A conta e as chaves do addons.mozilla.org são do usuário: o Claude não cria contas nem digita credenciais, por isso a assinatura é executada pelo próprio usuário.
- Cada nova assinatura exige subir a `version` do `manifest.json`.
- **Versão 1.0.0 assinada pela Mozilla** em 14/11/2026 (aprovação automática em poucos minutos): `web-ext-artifacts/a6e4eca4a5b84242aab2-1.0.0.xpi`, aberto no Firefox para instalação definitiva.
- **Erro**: depois de baixar o `.xpi`, o web-ext falhou com `ENOENT ... lstat 'C:\Users\JOHNAT~1\AppData\Local\Temp\tmp-web-ext-...'` ao limpar a pasta temporária (provável problema com o caminho curto 8.3 do usuário) e o script parou antes de abrir o Firefox. **Correção**: o script agora decide o sucesso pela existência de um `.xpi` novo da versão atual, não só pelo código de saída, e segue para a instalação. `.env` também passou a ser ignorado no pacote.

### 14/11/2026 — repositório git

- `git init` feito pelo usuário. O Git do Windows (`core.autocrlf=true`) avisava "LF will be replaced by CRLF" porque os arquivos são criados com LF.
- Correção: `.gitattributes` com `* text=auto eol=lf` (mantém LF no repositório e na cópia de trabalho, sem aviso) e `.gitignore` ignorando `web-ext-artifacts/` (pacotes gerados), `node_modules/` e `.claude/`.

### 14/11/2026 — renomeada para GeminiControllerFlow

- Nome exibido (`manifest.json`, prompt do modo web, README) trocado de "Gemini Controler" para **GeminiControllerFlow**.
- ID do Gecko trocado para `geminicontrollerflow@local`. Como ainda não houve versão publicada, não há instalação a migrar; quem carregou a versão anterior deve removê-la em `about:debugging` e carregar de novo.
- A pasta do projeto continua `gemini-controler` (renomear a pasta fica a critério do usuário).

### 14/11/2026 — versão inicial

- **Arquitetura**: o loop do agente roda na própria página da barra lateral (tem acesso a `browser.tabs`), sem depender do background. O background só alterna a barra lateral pelo ícone.
- **Content script `content/agent.js`** injetado sob demanda (`tabs.executeScript`) quando a primeira ferramenta é chamada; atribui `data-gc-ref` aos elementos e mantém as referências estáveis entre leituras.
- **Digitação**: `input`/`textarea` usam o setter nativo de `value` + eventos `input`/`change` (compatível com React); editores `contenteditable` (Lexical/Draft, como o do Facebook) usam `document.execCommand('insertText')`.
- **Screenshot**: `tabs.captureVisibleTab` reduzido para a largura do viewport em pixels CSS, para as coordenadas valerem direto no `click(x, y)`.
- **Motor API**: histórico no formato da API; resultados antigos de ferramentas são encurtados (mantém os 3 últimos e só a última imagem) para não estourar o contexto; as partes do modelo são guardadas inteiras (preserva `thoughtSignature` dos modelos Gemini 3).
- **Mudança de rumo pedida pelo usuário**: o uso não deve ser por API, e sim com o login da conta Google. Decisão: ponte com o gemini.google.com (`content/gemini-bridge.js`) em vez de embutir o site num iframe — o Google bloqueia frames (X-Frame-Options) e o login dentro de iframe tende a falhar com a proteção de cookies do Firefox. A API ficou como opção nas configurações.
- **Protocolo do modo web**: na primeira mensagem vai um prompt com as regras e a lista de ferramentas; o Gemini responde com um bloco de código JSON `{"tool": ..., "args": ...}`; a extensão executa e responde com `RESULTADO …`. Ações são extraídas dos elementos `<code>` da resposta (com regex de reserva).
- **Seletores do gemini.google.com** (conferidos em 14/11/2026): editor `rich-textarea .ql-editor[contenteditable=true]`, botão `aria-label="Enviar mensagem"`, botão `aria-label="Parar resposta"` durante a geração, respostas em `model-response` → `message-content .markdown`. O `aria-busy` fica `true` mesmo depois de terminar, então o fim da resposta é detectado por "sem botão Parar + texto estável por 1,2 s".

## Erros e correções conhecidas

- **Gemini web ignorava o protocolo na 1ª mensagem** (respondeu com pesquisa própria sobre o assunto em vez de agir). Correção: cada pedido leva automaticamente o resultado de `get_page` da aba alvo e um lembrete final ("responda agora com o bloco JSON da próxima ação"). Testado: passou a responder com `type_text` no campo correto.
- `web-ext lint` acusava `innerHTML` com valor dinâmico: trocado por `DOMParser` + `replaceChildren` (o Markdown já é escapado antes).
- Aviso de `data_collection_permissions` ausente: adicionado `"required": ["none"]`.

## Testes feitos

- `node --check` em todos os scripts e `web-ext lint` limpos.
- Ponte do Gemini testada no gemini.google.com real (sem login): envio de mensagem, espera do fim da resposta e extração da ação JSON funcionando; protocolo seguido nas duas rodadas.
- **Ainda não testado dentro do Firefox** com a extensão carregada (o ambiente de teste não tem o Firefox automatizado nem a conta do usuário): validar o fluxo completo, a colagem de screenshot no Gemini logado e a digitação no compositor do Facebook.

## Pendências / próximos passos

1. Testar no Firefox real (about:debugging) com a conta Google logada, em sites como Facebook e Mercado Livre.
2. Confirmar se colar imagem (screenshot) funciona no Gemini logado; se não, usar o input de arquivo do menu "+".
3. Opcional: assinar como extensão não listada no AMO para instalação permanente.
4. Opcional: suporte a iframes (`allFrames`) e menu de contexto "Perguntar ao Gemini sobre a seleção".

## Limitações conhecidas

- Eventos sintéticos (`isTrusted=false`); o Firefox não tem a API `debugger` do Chrome para gerar eventos reais.
- Sem acesso a páginas internas do Firefox, addons.mozilla.org e iframes de outros domínios.
- Modo web depende do layout do gemini.google.com (seletores centralizados no topo de `content/gemini-bridge.js`).
- Modo web sem login funciona, mas com limites menores e sem anexar imagens.
