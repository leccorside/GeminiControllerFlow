# CONTEXTO — GeminiControllerFlow (extensão Firefox)

## Estado atual

Extensão Firefox (Manifest V2) que abre o Gemini na barra lateral, lê a página aberta e executa ações nela (equivalente ao "Claude para Chrome"). Versão 1.0.0, criada em 14/11/2026.

- Motor padrão **"Minha conta Google"**: usa o `gemini.google.com` logado na conta do usuário, numa aba fixada, sem chave de API.
- Motor alternativo **"Chave da API"**: API oficial `generativelanguage.googleapis.com` com function calling.
- 15 ferramentas: `get_page`, `get_text`, `screenshot`, `click`, `type_text`, `select_option`, `press_key`, `scroll`, `hover`, `navigate`, `wait`, `list_tabs`, `switch_tab`, `open_tab`, `run_javascript`.
- `web-ext lint`: 0 erros, 0 avisos, 0 notas.

## Histórico de implementações

### 15/11/2026 — versão 1.0.17 (Gemini dentro da barra lateral, assistente por aba, Elementor, 20 anexos, fidelidade)

- **Gemini sem aba nem janela** (pedido: "deve centralizar apenas no agente da extensão"): o gemini.google.com roda num **iframe escondido dentro da barra lateral** (`.gemini-frame`: fixo, tamanho da barra, `opacity: 0.01`, `z-index: -1`, sem eventos — renderizado de propósito para contar como página visível; `display:none`/opacity 0 poderiam ser tratados como invisíveis).
  - **Experimento antes de implementar** (Firefox headless + extensão de teste): com `X-Frame-Options`/`frame-ancestors` removidos só para quadros cuja origem é a extensão, o Gemini carrega no iframe; cookies gravados no gemini.google.com no topo (`SameSite=None`, `Lax` e padrão) **aparecem dentro do iframe** — quadros em páginas da extensão não são isolados, então o login do usuário vale; a ponte respondeu "OK" em 5 s.
  - `background.js`: `webRequest.onHeadersReceived` (bloqueante) remove `X-Frame-Options` e a diretiva `frame-ancestors` **somente** quando `originUrl`/`documentUrl` começa com a URL da extensão. **Permissões novas**: `webRequest` e `webRequestBlocking` — o Firefox pede para o usuário aceitar na atualização.
  - Ponte em `all_frames`; dentro do iframe ela se conecta à barra lateral por `runtime.connect` com nome único (`window.name = "gcf-bridge:<uuid>"`, definido pela barra lateral) e atende comandos `{id, cmd, args}` (`dispatch`). A barra lateral usa `bridge()` → porta, `ensureGemini({fresh, url})` (navega o quadro para conversa nova ou para a conversa da aba). Login: só por pedido do usuário abre o gemini.google.com numa aba normal (o Google não permite login em quadro); ao carregar o Gemini numa aba e o quadro estiver sem conta, ele é recarregado para pegar a sessão.
  - Removidos: janela própria do Gemini (1.0.14) e troca de aba. A preferência de oclusão no `user.js` deixou de ser necessária (inofensiva).
- **Assistente por aba**: sessões (`sessions: tabId → { view, history, webFresh, skillsSent, stepsBox, geminiUrl }`). Cada aba tem a sua visão no chat; `bindSession` troca o estado global para a sessão dona (durante uma tarefa, o estado fica preso à aba da tarefa e só troca no fim). Abas sem sessão mostram o cartão "Abrir o assistente nesta aba" (`#tabGate`, conversa limpa); o envio em outra aba durante uma tarefa avisa (`busyOtherTab`). Fechar a aba apaga a sessão. A tarefa usa a aba da sessão (`runner.tabId = sessao.tabId`), não a aba ativa. O endereço da conversa no Gemini é salvo por aba e retomado. Limite do Firefox: a barra lateral é por janela e só abre/fecha por clique do usuário (MDN: `sidebarAction.open/close` "only from inside the handler for a user action") — por isso o cartão, e não fechar sozinho.
- **Elementor**: ferramenta `elementor` (info, get_structure, set_title com `ocultar_titulo`, build, save só rascunho e recusando publicada, preview) pela API `$e.run` do editor; modo Containers e Seções/Colunas; widgets por descrição simples (titulo, texto, imagem, botao, espaco, divisor, lista, video, html, widget). Fluxo no roteiro: página/slug/SEO/imagens pelo editor de blocos → editor do Elementor → build → save → preview.
  - **Teste** (WordPress local pelo Playground CLI em 127.0.0.1:9400 com Elementor 4.4.0, Edge headless): info (containers, 178 widgets), upload com alt, build com 3 seções/10 widgets (2 colunas, imagem, lista; widget inválido ignorado com aviso), save → draft, preview (títulos, imagem com alt, botão, 2 colunas), REST confirmou draft/título/slug. No Playground do navegador o teste não roda (navegar dentro do iframe derruba o quadro; instalar plugin por blueprint trava) — por isso o CLI.
- **20 anexos**: limite da barra lateral 10 → 20; no Gemini web (máx. 10 por mensagem) os primeiros lotes vão antes como "anexos de referência" (o Gemini só confirma) e o último lote vai com o pedido; modo API recusa acima de ~18 MB somados.
- **Fidelidade 100%**: regra nas instruções gerais e bloco "FIDELIDADE 100% À REFERÊNCIA" no topo do roteiro WordPress (textos palavra por palavra, mesma ordem/quantidade de seções e colunas, cores em hexadecimal da referência, imagens no lugar exato, plano antes de montar, comparar e corrigir até bater).
- **Teste de ponta a ponta da barra lateral** (extensão real no Firefox headless, `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` para controlar a página da extensão, barra lateral aberta numa aba ativa): quadro criado, porta conectada; pedido "título desta página" sobre example.com (outra aba, em 2º plano) → get_page + resposta "Example Domain" em 14 s; **nenhuma aba/janela do Gemini criada** (1 janela); `geminiUrl` salvo; outra aba mostra o cartão sem a conversa; "abrir aqui" cria conversa limpa; voltar à 1ª aba mantém as mensagens. Com a página da barra lateral oculta (aba em 2º plano), o Gemini não desenha a resposta — no uso real a barra lateral está visível.

### 15/11/2026 — versão 1.0.16 (habilidades + habilidade WordPress)

- **Pedido**: o agente não entendia "crie uma página no WordPress". O usuário enviou um roteiro completo (entender a referência, identificar o editor, preparar imagens, montar seções, SEO, salvar como rascunho sem publicar, relatório final e regras de segurança), que virou o roteiro oficial da habilidade.
- **Sistema de habilidades** (`sidebar/skills.js`): cada habilidade tem `detectar(contexto)` e `instrucoes`. Entra **uma vez por conversa** (`skillsSent`, zerado em "nova conversa"): no modo conta Google vai no início da mensagem ao Gemini; no modo API, junto do `systemInstruction`. Aviso "🧩 Habilidade ativada: …" no chat. Configurações → Habilidades liga/desliga (`skillsOff`).
- **Detecção da plataforma** (`agent.js`, `pageInfo().plataforma`): meta generator WordPress, `/wp-content/`/`/wp-includes/`, `#wpadminbar`, `body.wp-admin`, `/wp-admin/`. A habilidade WordPress também ativa por palavras no pedido (wordpress, gutenberg, elementor, divi, wpbakery, yoast, rank math, woocommerce).
- **Ferramenta `wordpress`** (ações: info, get_content, set_title, set_slug, set_content, set_seo, upload_media, save, preview), executada no contexto da página via `window.wrappedJSObject.eval` (`pageEval`) e, para operações assíncronas, `pageJob` (resultado em `window.__gcfJobs`):
  - `set_content`: marcação de blocos (`wp.blocks.parse`) ou HTML comum (`wp.blocks.rawHandler`); substituir (`resetBlocks`) ou acrescentar (`insertBlocks`); informa blocos inválidos.
  - `upload_media`: o anexo do pedido (por nome ou número; `runner.anexos`) vai para `/wp/v2/media` (`wp.apiFetch` ou fetch com nonce) e recebe o `alt_text`.
  - `save`: **só rascunho** — não existe opção de publicar; se o post já estiver publicado/agendado/privado, **recusa** (não altera página existente).
  - `preview`: busca a pré-visualização com `fetch` (cookies da sessão), sem abrir aba, e devolve títulos, imagens/alt, botões/links, marcas [REVISAR], colunas e aviso de H1 duplicado.
  - `set_seo`: Yoast (`yoast-seo/editor`), Rank Math (`rank-math`) ou meta do post; informa o que funcionou.
  - Editor clássico tem suporte básico (título, conteúdo, salvar rascunho); Elementor/Divi/WPBakery: a ferramenta para e o roteiro manda perguntar ao usuário.
- `run_javascript` ganhou `page_context` (código síncrono no contexto da página, acessa `wp`, `jQuery`…).
- Ações de leitura do WordPress (info, get_content, preview) não pedem confirmação no modo "toda ação".
- **Corrigido**: erros de funções assíncronas do content script voltavam como promise rejeitada, e a barra lateral reinjetava o script e **repetia a ação** (ex.: mídia enviada duas vezes) → agora sempre voltam como `{ erro }`.
- **Testes** (WordPress Playground — WordPress 7.1, tema Twenty Twenty-Five, logado como admin —, Edge headless via CDP com sessão no iframe do editor; o Firefox BiDi avaliava no topo em vez do iframe de outro domínio): detecção `wordpress/painel`; info (gutenberg, 115 blocos, tema); título; upload com alt (id 6); conteúdo com capa+H1, H2, colunas com H3 e imagem, botão "#"[REVISAR], 0 blocos inválidos; acrescentar; slug; SEO (meta); save → **draft** com link de pré-visualização; preview (só o conteúdo, aviso de 2 H1, imagem com alt, botão, [REVISAR], colunas empilham no celular); REST confirmou página 4 `draft`, slug e 13 blocos. Proteção: com a página publicada, `save` recusou e o título publicado ficou intacto.
- Limites: o ajuste responsivo é conferido pela estrutura (colunas empilham), não por renderização em tela de celular; SEO via Yoast/Rank Math não foi testado (Playground sem esses plugins).
- `web-ext lint`: 1 aviso (`eval` no `agent.js`, usado de propósito em `pageEval` para rodar código no contexto da página). A assinatura "unlisted" foi aprovada automaticamente mesmo assim; numa eventual publicação listada no AMO, esse ponto passaria por revisão.

### 15/11/2026 — versão 1.0.15 (anexar imagens e arquivos)

- **Interface**: botão **+** à esquerda da caixa de texto (abre o seletor de arquivos, vários de uma vez), **Ctrl+V** de imagens/arquivos na caixa e **arrastar e soltar** na barra lateral (a caixa fica tracejada). Anexos pendentes aparecem acima da caixa (miniatura para imagem, extensão para os demais, ✕ para remover) e, ao enviar, dentro da mensagem do usuário. Limites: 10 anexos, 25 MB cada. Só anexos, sem texto → usa "Analise os arquivos anexados." Chaves novas nos 3 idiomas (97 no total).
- **Modo conta Google** (`attachFiles` na ponte): o Gemini cria `input.hidden-file-input` **só com o menu "Envio e ferramentas" aberto** (um aceita `image/*,video/*`, outro documentos `.txt,.pdf,.docx…`) e os destrói ao fechar. A ponte abre o menu, coloca os arquivos direto no input certo (mídia × documentos) e dispara `change`; espera as prévias `<uploader-file-preview>` (por grupo, reabrindo o menu se ele fechar) e o fim do upload (`mat-spinner` some, até 45 s); fecha o menu e envia o texto. A captura de tela (`screenshot`) passou a usar o mesmo caminho (antes era colar).
  - **Erro 1**: `File`/`DataTransfer` criados no content script não eram aceitos → criados no mundo da página (`window.wrappedJSObject` + `cloneInto`), forma documentada pela Mozilla.
  - **Erro 2**: a ponte fechava o menu antes de pôr os arquivos e os inputs eram destruídos (diagnóstico: "arquivos no campo 1/1, prévias 0 → 0") → mantém o menu aberto até as prévias aparecerem.
  - Os anexos vão só no 1º envio do pedido; o reenvio reduzido não anexa de novo. Aviso quando parte dos anexos não entra; erro de não envio avisa se os anexos ainda estavam subindo.
- **Modo API**: imagem, PDF, áudio, vídeo e `text/*` vão como `inlineData`; código/dados de texto (.json, .csv, .md, .py…) viram texto; outros tipos (.docx, .zip…) são ignorados com aviso.
- **Testes**: no Gemini real com a extensão instalada (sem login), as prévias aparecem (anexo entra), mas **sem login o upload nunca conclui** e o Gemini não libera o envio — o teste de ponta a ponta com resposta sobre o anexo depende da conta do usuário (pendente). UI renderizada no Edge headless com a API simulada (mensagem com 2 anexos + 3 pendentes): sem erros de JavaScript.

### 15/11/2026 — versão 1.0.14 (Gemini em janela própria, sem trocar a aba do usuário)

- **Resultado da 1.0.13**: funcionou de ponta a ponta (buscou vagas de assistente técnico no LinkedIn e listou os resultados), mas a aba do Gemini aparecia a cada passo. Pedido: a tela do usuário (ex.: LinkedIn) não pode mudar; tudo aparece só na barra lateral.
- **Tentativa descartada — fingir visibilidade** (`content/gemini-visible.js` em `document_start`: `document.hidden=false`, `visibilityState="visible"`, `hasFocus()=true` via `wrappedJSObject`/`exportFunction`, e `requestAnimationFrame` com timer em aba oculta). Na página de teste funcionou (aba oculta, página "via" visível, resposta lida em 7 s), mas no Gemini real ficou **instável**: envios que antes funcionavam passaram a sair devagar ou não sair (provável espera por animações CSS, que o Firefox não roda em aba oculta). Removido.
- **Solução**: o Gemini fica numa **janela própria do Firefox, atrás da janela do usuário** (mesma posição/tamanho com 30 px de margem). Para a página ela é visível de verdade; o usuário só vê a página dele. A aba fixada das versões antigas é desafixada e movida para essa janela (`moveGeminiToOwnWindow`); se não existir, `openGeminiWindow`. Depois de criar/mover, o foco volta para a janela do usuário. A extensão **nunca** troca a aba da janela do usuário. Janela minimizada → restaurada atrás (`restoreGeminiBehind`). O botão "Abrir o Gemini para fazer login" traz a janela à frente (ação pedida pelo usuário).
- **Pré-requisito no Windows**: `widget.windows.window_occlusion_tracking.enabled = false` (adicionado ao `user.js` do perfil; vale ao reiniciar o Firefox). Sem isso o Firefox trata janela totalmente coberta como oculta. A própria Mozilla desliga essa preferência nas automações (`RecommendedPreferences.sys.mjs`, bug 1802473).
- **Também corrigidos** (vistos na execução do LinkedIn):
  - "el.click is not a function": o alvo virava um ícone SVG sob o ponto do clique; agora só troca por elemento HTML e usa evento `click` quando não há `.click()`.
  - Mensagens com "[{ref}]" literal: a regex de `tr()` no `agent.js` tinha perdido as barras (`/{(w+)}/`) desde o passo dos idiomas; corrigida para `/\{(\w+)\}/`. Varredura: nenhum outro caractere de controle/regex quebrada nos scripts.
  - "Elemento [n] não encontrado" com o campo de busca do LinkedIn (recriado pela página): cada referência guarda a identidade (tag, papel, nome, id, name, placeholder) e, se o elemento sumir, `findEquivalent` acha o equivalente visível (exige nome, id ou name+papel batendo).
  - A rede (`processSession`) deixou de contar como prova de envio: falso positivo em teste.
- **Testes** (extensão real, Firefox headless/BiDi): aba do Gemini fixada na janela principal → movida para janela própria; janela principal focada e aba ativa do usuário intacta antes e depois; página do Gemini `hidden: false`; ask OK em 5 s. Limite: o headless não tem oclusão de janelas do Windows — o efeito do `user.js` só se confirma no Firefox do usuário.

### 15/11/2026 — versão 1.0.13 (Gemini da conta só envia com a aba visível)

- **Erro relatado (1.0.12)**: "não foi enviada (nenhuma requisição saiu…)", mas o print da aba do Gemini mostrava a mensagem enviada e respondida (`{"tool": "click", "ref": 5}`, sem `args`).
- **Causa**: com a conta logada, o Gemini **deixa o envio na fila enquanto a aba está oculta** e só envia quando ela fica visível — ao abrir a aba para tirar o print, a fila andava. Por isso nenhum sinal (rede, caixa, endereço, tela) aparecia com a aba fixada em 2º plano. Sem login isso não acontece (todos os testes headless passavam).
- **Correção**:
  - Ponte: com a aba oculta e nenhum sinal de envio em 4 s, devolve `{ precisaVisivel: true, enviada: false }` **sem reenviar** (reenviar duplicaria a mensagem quando a fila andasse). O `collect`, chamado com a aba visível, espera a fila sair (10 s); se não sair, clica uma vez no enviar; depois lê a resposta. Erro de não envio centralizado em `notSentError`, com "aba oculta: sim/não".
  - Barra lateral: `withGeminiVisible(fn)` ativa a aba do Gemini, executa e volta para a aba do usuário; `collectVisible` usa ela. Depois da primeira vez em que o envio ficou na fila, `geminiPrecisaVisivel = true` e os próximos envios já são feitos com a aba do Gemini à frente (sem os 4 s de espera). Efeito visível: a aba do Gemini aparece durante a geração e a extensão volta para a página em seguida.
  - Ações no formato "achatado" (`{"tool":"click","ref":5}`) agora são aceitas: os campos fora de `tool` viram `args`.
  - Diagnóstico: `sinalEnvio()` informa qual sinal detectou o envio (rede, caixa-removida, caixa-vazia, endereço, pergunta-na-tela, botão-parar, resposta-na-tela), devolvido em `sinal`.
- **Testes**:
  - Determinístico (`gemini-falso.html` + ponte real, Firefox headless/BiDi): aba oculta → `precisaVisivel, enviada=false` em 5 s e **nada enviado**; aba visível → `collect` leu a resposta, ação achatada convertida (`args: {ref: 5}`); 1 pergunta e 1 resposta na página (sem duplicata).
  - Gemini real com a extensão instalada (en e pt-BR): OK (10–12 s). Tentativas de simular a fila no Gemini real (segurar eventos do botão, botão falso) não funcionaram — o Gemini sem login envia por outro caminho —, por isso o teste determinístico.
- **Pendente**: confirmar no Firefox do usuário.

### 14/11/2026 — versão 1.0.12 (causa real do "não enviada": a verificação errava)

- **Prova** (print da aba do Gemini da conta Pro, interface nova em inglês): a mensagem de instruções FOI enviada e o Gemini respondeu `{"tool":"click","args":{"ref":5}}`; o histórico tinha ~15 conversas "Busca de Vagas…", uma por tentativa. O envio sempre funcionou — a extensão concluía "não enviada" e desistia (e o reenvio por Enter/clique e o reenvio reduzido da 1.0.10 podem ter gerado conversas duplicadas).
- **Por quê**: na interface nova a caixa da tela inicial continua no DOM com o texto depois do envio (outra caixa assume a conversa) e, com a aba em 2º plano, a animação que a esconde não roda — o diagnóstico "caixas: 1 visíveis de 2" batia com isso. A verificação lia `editor()` (essa caixa antiga) e via o texto. Além disso, com a aba oculta a tela pode não ser redesenhada (`user-query`/`model-response` não aparecem) — reproduzido sem login: em uma rodada a rede concluiu e a resposta não apareceu na tela.
- **Correções**:
  - `editor()` prefere a caixa visível **vazia** (e a última); a verificação de envio usa a caixa em que digitou (`ed`: desconectada ou esvaziada), mudança de endereço, `user-query` novo, botão Parar, resposta nova **e a rede**.
  - **Rede**: `PerformanceObserver` conta o fim das requisições de geração. Conferido no Firefox: a interface atual envia por `geminiweb-pa.clients6.google.com/v1/processSession` (≈6 por resposta); `StreamGenerate` (antigo) também aceito. **Não** envolver `XMLHttpRequest`/`fetch` da página com `exportFunction`: testado, quebra o envio do Gemini (revertido).
  - Reenvio só depois de 15 s **sem nenhum sinal** de envio (evita duplicatas).
  - `waitAndRead`: se a rede concluiu, ficou quieta por 5 s e a tela não mostrou a resposta com a aba oculta, devolve `precisaVisivel`; a barra lateral (`collectVisible`) ativa a aba do Gemini por ~1 s, chama o novo comando `collect` (lê sem reenviar) e volta para a aba do usuário.
- **Testes** (extensão real, Firefox headless, ~14 mil caracteres, aba oculta): en e pt-BR, 2 rodadas cada → todos OK em 9–13 s, 6 requisições contadas, sem pedir a aba visível antes da hora. O caminho `collect` com a aba ativada não foi exercitado de ponta a ponta (depende da tela não redesenhar).

### 14/11/2026 — versão 1.0.11 (caixa e botão de enviar visíveis)

- **Erro relatado (1.0.10)**: "não foi enviada… 5457 de 5457 caracteres. Botão de enviar: 'Send message'. Nenhum aviso visível". Mostra que o reenvio reduzido também falhou, que a conta usa o Gemini **em inglês** e que o botão estava habilitado e sem aviso — o clique não chegou ao botão certo. O print da aba do Gemini citado pelo usuário não veio anexado.
- **Hipótese**: a ponte usava o **primeiro** `rich-textarea` e o **primeiro** botão "Send message" da página. Com conta logada pode haver duplicatas escondidas (edição de mensagem, painéis, Canvas); sem login só há um de cada.
- **Correção**: `editor()` prefere a caixa visível dentro da área de digitação (`input-area-v2`, `input-container`…); `sendButton()` prefere o botão visível **dentro da mesma área da caixa** (rótulos pt/en/es, classe `send-button`, `data-test-id*=send`, ícone `send`); clique completo (`pointerdown/mousedown/pointerup/mouseup/click`); na nova tentativa, Enter (keydown/keypress/keyup) e clique em cada candidato visível. O diagnóstico mostra se o botão está visível/na área da caixa e quantas caixas e botões de enviar existem (visíveis/total). `:has()` evitado (Firefox < 121).
- **Testes** (extensão real no Firefox headless): pt-BR longo OK (17 s); **inglês** longo OK (10 s) — numa primeira rodada em inglês a pergunta foi enviada e respondida mas o teste não recebeu o resultado em 240 s, e não se repetiu (registrado como possível intermitência na detecção do fim da resposta). Página em inglês com a ponte direto: OK (6 s); botões em inglês durante/depois: "Copy prompt / Edit / Redo / Copy / Show more options".
- **Pendente**: teste com a conta do usuário e print da aba do Gemini se falhar.

### 14/11/2026 — versão 1.0.10 (mensagem não enviada ao Gemini da conta)

- **Erro relatado (1.0.9)**: "A mensagem não foi enviada ao Gemini (o texto continua na caixa: 13665 de 13708 caracteres)". O texto entra na caixa, mas o clique em Enviar (e a nova tentativa com Enter + clique) não envia — **só com a conta logada**.
- **Não reproduzido sem login, nem como extensão real**: Firefox headless com a extensão instalada via WebDriver BiDi (`webExtension.install`, cópia de teste com um background que dispara o `ask` pelo content script, com a aba do Gemini em 2º plano): mensagem curta OK (17 s) e de ~14 mil caracteres OK (13–17 s). A automação não abre páginas `moz-extension://` em aba (mesmo com `web_accessible_resources`), por isso o disparo pelo background.
- **Hipótese**: o Gemini da conta recusa mensagens grandes (limite do plano/aviso) ou mostra algo na tela que bloqueia o envio.
- **Mudanças**: (1) o 1º envio ficou menor — a leitura da página vai em texto simples (URL, título, até 80 elementos, cortada em ~3,5 mil caracteres) em vez de JSON indentado de até 9 mil; (2) se o Gemini não aceitar, a extensão reenvia **sem** a leitura da página (pedindo para começar com `get_page`); (3) o erro de não envio agora traz o diagnóstico da tela do Gemini — rótulo e estado do botão de enviar, avisos visíveis perto da caixa (`role=alert`, snack-bar, classes error/warning/limit/hint/counter) e janela aberta.
- Teste de regressão (extensão real no Firefox, mensagem longa): OK.
- **Pendente**: o usuário testar com a conta; se ainda falhar, o erro mostrará o aviso do Gemini.

### 14/11/2026 — versão 1.0.9 (erro "O Gemini não começou a responder em 60 s")

- **Erro relatado** com a conta logada, no 1º pedido ("procure vagas relacionadas a desenvolvimento web…").
- **Não reproduzido sem login**: com a ponte real no gemini.google.com, todos os cenários responderam — Edge em 1º plano (4 s), Edge com a aba oculta (6 s), Edge com mensagem de ~15,5 mil caracteres (5 s), **Firefox headless via WebDriver BiDi** com a aba oculta (9 s) e oculta + mensagem longa (17 s). Ou seja: aba em 2º plano e tamanho do primeiro envio não são a causa.
- **Causas prováveis (com conta)**: (a) a ponte só considerava a resposta iniciada quando o **número** de `model-response` aumentava — em conversa longa o Gemini virtualiza a lista e remove blocos antigos, então a contagem não sobe; (b) modelos que raciocinam (Argon/Carbon) podem levar mais de 60 s até criar o bloco, com o botão "Parar resposta" já visível; (c) a mensagem podia nem ter sido enviada (aviso, limite, janela) e o erro não dizia.
- **Correção** em `ask()`: confirma o envio (caixa esvaziou ou novo `user-query`), com segunda tentativa por Enter e novo clique; erro próprio se o texto não entrar na caixa ou não for enviado. Resposta iniciada = contagem maior **ou** último bloco diferente do anterior; enquanto o botão Parar estiver visível espera até 5 min (senão 90 s). O erro de tempo agora traz diagnóstico (enviada, gerando, respostas antes → depois, caminho da página).
- Testes repetidos com a ponte nova (Firefox oculto, Firefox oculto + longo, Edge): todos OK. **Pendente**: confirmar com a conta do usuário; se falhar, a mensagem de erro nova indica em que etapa parou.
- Scripts de teste (no scratchpad da sessão): `cdp-ask-test.mjs` (Edge/CDP) e `bidi-firefox-ask.mjs` (Firefox headless/BiDi, perfil temporário).

### 14/11/2026 — atualização poucos minutos depois do push

- Pedido: a extensão procurar atualização sozinha logo depois do push. **Não é possível pela extensão**: `runtime.requestUpdateCheck` não existe no Firefox (MDN browser-compat-data: `version_added: false`). Instalar o `.xpi` por conta própria exigiria o clique em "Adicionar".
- Solução: `extensions.update.interval` no `user.js` do perfil passou de 3600 para **300** (5 min). Menos que isso não adianta: o `raw.githubusercontent.com` responde com `Cache-Control: max-age=300`. Na prática, a versão nova entra entre ~5 e ~10 min depois do push, sem clique. O Firefox lê o intervalo só na inicialização: é preciso reiniciá-lo uma vez.
- Diagnóstico anterior (1.0.8 "não atualizou"): a verificação do Firefox rodou às 21:47:54 e o commit foi às 21:47:58 — a checagem aconteceu 4 s antes do push; nada estava quebrado.
- Sem mudança de código nem de versão da extensão.

### 14/11/2026 — versão 1.0.8 (nível de raciocínio no seletor)

- Seletor no estilo do Antigravity: o botão mostra modelo + nível ("Gemini 4 Argon Medium"); cada modelo mostra o nível ao lado do nome e, quando há níveis, um **›** que abre a lista "Nível de raciocínio" com ✓ no nível em uso. Clicar no modelo mantém o nível; clicar num nível troca modelo + nível.
- **Modo API**: níveis Automático / Low / Medium / High (nomes em inglês como no Antigravity; "Automático" traduzido), salvos em `apiLevel` e enviados em `generationConfig.thinkingConfig` — `thinkingLevel` para Gemini 3+ e `thinkingBudget` (1024 / 8192 / 24576) para 2.0/2.5. Se a API recusar (400 citando "think"), repete sem `thinkingConfig`.
- **Modo conta Google**: o gemini.google.com **não tem** controle de nível sem login (inspecionado no Edge headless: só os 4 modelos e, no menu de ferramentas, arquivos/imagem/vídeo/Canva). A ponte detecta submenu em um item (`aria-haspopup="true"` ou ícone `chevron_right`/`arrow_right`…), abre por hover (ou clique, se `aria-haspopup`), lê os níveis e escolhe; o `status` devolve `nivel`. Salvo em `webLevel` e reaplicado em conversa nova. Se o Gemini da conta não oferecer submenu, aparece só o modelo.
- **Testes**: ponte no Gemini real — sem submenu, lista igual à 1.0.7; com um submenu simulado (Medium marcado / High) num item, leu `nivel: Medium`, escolheu High (clique confirmado), `status` devolveu `nivel: High` e o menu fechou. UI renderizada no Edge headless com a API do navegador simulada: botão "Gemini 4 Argon Medium", submenu de níveis aberto, sem erros de JavaScript.
- **Pendente**: confirmar no Firefox do usuário, com a conta logada, se o Gemini oferece submenu de nível em algum modelo (e o formato dele).
- Lição: heredoc no Bash deste ambiente perde barras invertidas (`\s`, `\\`) — para código com regex, gravar arquivo com Write/Edit.

### 14/11/2026 — versão 1.0.7 (correção do seletor de modelo)

- **Erro**: na 1.0.6 o menu mostrava "Não consegui listar os modelos: O menu de modelos do Gemini não abriu." A ponte procurava os itens dentro de `.cdk-overlay-container`, mas o Gemini renderiza o menu em `gem-menu[role=menu]` (ligado ao botão por `aria-controls`), fora do overlay.
- **Estrutura real** (inspecionada num Edge headless via CDP, sem login): botão `[data-test-id=bard-mode-menu-button]` (aria-label "Abrir seletor de modo. No momento: …"); itens `gem-menu-item[role=menuitemradio]` com `.label` (descrição: "Respostas rápidas", "Código e análise"…), `.sublabel` (modelo: "3.5 Flash Lite", "4 Argon"…), `.badge` ("Novo"), `aria-checked` (em uso) e `aria-disabled` (bloqueado, ícone `lock`). Há também um item `role=menuitem` "Fazer login", ignorado. Escape **não** fecha o menu; fecha clicando no botão de novo.
- **Correção**: a ponte lê esses itens e monta nome = "Gemini " + sublabel (ex.: "Gemini 4 Argon"), descrição = label, selo = badge. O botão do Gemini mostra uma forma curta ("Flash-Lite"); a ponte guarda o nome completo do último modelo visto para devolver no `status`. Escolher modelo bloqueado dá erro claro.
- Barra lateral: selo "Novo" e 🔒 nos modelos bloqueados (estilo do seletor do Antigravity). Nova chave `modelLocked` nos 3 idiomas.
- **Teste** (Edge headless, sem login, injetando o `gemini-bridge.js` real): `list_models` devolveu os 4 modelos (Gemini 3.5 Flash Lite ✓, 4 Hydrogen, 4 Argon, 4 Carbon — os três bloqueados sem login), o menu fechou depois, `select_model` em bloqueado devolveu erro e em liberado funcionou; `status` passou a mostrar "Gemini 3.5 Flash Lite".
- **Bug durante a edição**: gerar o código por `node -e` com template literal comeu as barras invertidas (`\s` virou `s`, `\b` virou backspace). Corrigido à mão; preferir Edit/Write para código com regex.
- 1.0.7 assinada e colocada em `updates/`.

### 14/11/2026 — versão 1.0.6 (seletor de modelo)

- Botão de modelo abaixo da caixa de texto (como nos assistentes de IDE), com menu suspenso: nome, descrição e ✓ no modelo ativo; itens indisponíveis aparecem desabilitados. Fica bloqueado enquanto uma tarefa roda.
- **Modo conta Google**: a ponte ganhou `list_models` e `select_model`. Ela abre o seletor de modo do próprio gemini.google.com (`bard-mode-switcher button` e alternativas), lê os itens do menu (`.cdk-overlay-container [role=menuitem|menuitemradio|option]`) e clica no escolhido. O `status` passou a devolver o `modelo` atual (texto do botão). A escolha é salva (`webModel`) e reaplicada a cada conversa nova.
- **Modo API**: o menu lista os modelos de `geminiListModels` (cache em memória, limpo ao salvar as configurações) e grava em `model`.
- 9 chaves novas de tradução (88 no total, iguais nos 3 idiomas).
- ~~Validado pelo usuário~~: o registro anterior estava errado — o Firefox ainda estava na 1.0.5. Na 1.0.6 o menu não listava os modelos (corrigido na 1.0.7).
- Pacote voltou a 49 KB (logo fora do `.xpi`). 1.0.6 assinada e colocada em `updates/`; a 1.0.5 instalada já tem `updateURL` e o `updates.json` está no GitHub (HTTP 200), então a 1.0.6 chega sozinha depois do push.

### 14/11/2026 — versão 1.0.5 (atualização automática)

- `manifest.json` ganhou `browser_specific_settings.gecko.update_url` = `https://raw.githubusercontent.com/leccorside/GeminiControllerFlow/main/updates/updates.json` (repositório público). O Firefox consulta esse arquivo e instala sozinho versões novas assinadas, sem confirmação, desde que não peçam permissões novas.
- `scripts/assinar-e-instalar.ps1` agora, depois de assinar, copia o `.xpi` para `updates/geminicontrollerflow-<versão>.xpi` e regrava `updates/updates.json` (link raw + `update_hash` SHA-256), mantendo as 5 últimas versões. Só abre o Firefox com `-Instalar` (necessário só na primeira instalação com `update_url`). Os arquivos entram no ar quando o usuário faz commit + push da `updates/` na `main` (o Claude não commita).
- `.gitignore`: exceção `!updates/*.xpi` e `.amo-upload-uuid` ignorado.
- `user.js` do perfil: `extensions.update.interval = 3600` (verifica a cada 1 h em vez de 24 h).
- **Erro 1**: "This upload has already been submitted" — o web-ext 8 guarda o upload em `.amo-upload-uuid` e o reaproveitou. Correção: o script apaga esse arquivo antes de assinar. A versão 1.0.4 ficou registrada no AMO sem o arquivo baixado, por isso pulamos para a 1.0.5.
- **Erro 2**: o `.xpi` passou a ter 1,18 MB porque o `logo-geminicontrollerflow.png` (só para o GitHub) entrou no pacote. Correção: `logo-*.png` e `*.md` no `--ignore-files` (vale a partir da próxima versão; a 1.0.5 ainda leva o logo).
- 1.0.5 assinada e aberta no Firefox para a instalação manual única.

### 14/11/2026 — versão 1.0.3 (idiomas: pt-BR, inglês, espanhol)

- Novo campo **Idioma** nas configurações. Ao salvar, a barra lateral é retraduzida na hora (configurações, cabeçalho, selo da conta, tela inicial, sugestões, botões, confirmações, rótulos dos passos e mensagens de erro) e aparece um aviso de idioma alterado. Mensagens que já estavam no chat continuam como foram escritas.
- `sidebar/i18n.js`: dicionário com 79 chaves nos 3 idiomas, `t(chave, variáveis)` e `applyI18n()` para elementos com `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`. Conferido por script que todas as chaves usadas existem e que os 3 idiomas têm as mesmas chaves.
- Idioma padrão: o do Firefox (`navigator.language`), caindo para pt-BR.
- O Gemini passa a responder no idioma escolhido: a regra do prompt virou "Responda sempre em {idioma}". O restante do prompt e as mensagens internas para o modelo continuam em português (o modelo entende e isso evita manter 3 prompts).
- O content script recebe `lang` em cada mensagem e devolve os erros (elemento não encontrado etc.) no idioma escolhido.
- `_locales/` (pt_BR, en, es) para a descrição da extensão, o título do botão e a descrição do atalho no Firefox. Esses seguem o idioma do Firefox, não o da configuração (limitação da plataforma).
- Versão 1.0.3 assinada (`web-ext-artifacts/a6e4eca4a5b84242aab2-1.0.3.xpi`) e aberta no Firefox para atualizar.

### 14/11/2026 — versão 1.0.2 (conta conectada no cabeçalho)

- O selo ao lado de "Gemini" mostra a conta Google conectada no gemini.google.com (foto + e-mail, nome no tooltip), em verde. Sem conta, mostra "não conectado — fazer login" em vermelho e, ao clicar, abre a aba do Gemini para entrar.
- A ponte (`content/gemini-bridge.js`) lê a conta no botão do avatar pelo `aria-label` ("Conta do Google: Nome (email)" / "Google Account: …"), com regex de e-mail. O comando `status` passou a devolver `conta`.
- A barra lateral consulta a aba do Gemini já aberta (sem abrir aba nova) ao iniciar, a cada 15 s, quando a aba do Gemini termina de carregar (login/logout recarrega a página) e a cada pedido. Fechar a aba do Gemini volta o selo para "não conectado".
- Não foi possível testar com uma conta logada aqui: o formato do `aria-label` foi testado com exemplos, mas precisa ser confirmado no Firefox do usuário.
- Versão 1.0.2 assinada (`web-ext-artifacts/a6e4eca4a5b84242aab2-1.0.2.xpi`) e aberta no Firefox para atualizar.

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
