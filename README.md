# GeminiControllerFlow — extensão para Firefox

Abre o Gemini como assistente num painel à direita da página (só na aba em que você o abre), com acesso à página aberta e capacidade de agir nela: ler, clicar, digitar, escolher opções, rolar, passar o mouse, pressionar teclas, navegar, trocar/abrir abas, capturar a tela e executar JavaScript.

## Dois modos de uso

| Modo | Como funciona | Precisa de |
|---|---|---|
| **Minha conta Google** (padrão) | O `gemini.google.com` (logado na sua conta) roda **escondido no fundo da extensão** — sem abrir aba nem janela. A extensão digita suas mensagens nele, espera a resposta, executa as ações pedidas na sua página e devolve o resultado. A conversa também fica no histórico do Gemini. | Só estar logado no gemini.google.com |
| **Chave da API** | Chama a API oficial do Gemini com *function calling*. Mais rápido e estável. | Chave do [Google AI Studio](https://aistudio.google.com/apikey) |

## Instalar (modo desenvolvedor)

1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em **Carregar extensão temporária…** e escolha o arquivo `manifest.json` desta pasta.
3. Clique no ícone da extensão na barra de ferramentas (ou **Ctrl+Shift+Y**): o painel do assistente abre à direita da página atual, empurrando o conteúdo. Clique de novo (ou no X do painel) para fechar.

A instalação temporária some ao fechar o Firefox.

## Instalar de forma definitiva (Firefox normal)

O Firefox normal só instala de vez extensões assinadas pela Mozilla. A assinatura "não listada" é gratuita e automática (a extensão não aparece na loja):

1. Entre (ou crie a conta) em [addons.mozilla.org](https://addons.mozilla.org) e gere as credenciais em [Gerenciar chaves de API](https://addons.mozilla.org/pt-BR/developers/addon/api/key/) — *Emissor JWT* e *Segredo JWT*.
2. Na pasta do projeto, rode (na primeira vez, com `-Instalar`):
   ```
   powershell -ExecutionPolicy Bypass -File scripts\assinar-e-instalar.ps1 -Instalar
   ```
   O script lê as credenciais do `.env` (`Emissor JWT: …` / `Segredo JWT: …`) ou pede no terminal, assina e abre no Firefox. Confirme em **Adicionar**. Esse clique só é necessário uma vez.

## Atualização automática

A extensão declara um `update_url` (`updates/updates.json` neste repositório, servido pelo `raw.githubusercontent.com`). O Firefox consulta esse arquivo periodicamente e instala as versões novas sozinho, sem pedir confirmação (só pede se a versão nova exigir permissões novas).

Para lançar uma versão:

1. Aumente `version` no `manifest.json` (a Mozilla não assina a mesma versão duas vezes).
2. Rode `powershell -ExecutionPolicy Bypass -File scripts\assinar-e-instalar.ps1` (sem `-Instalar`). Ele assina e atualiza a pasta `updates/` (o `.xpi` e o `updates.json` com o hash SHA-256; mantém as 5 últimas versões).
3. Faça commit e push para a `main`. A partir daí, cada Firefox com a extensão instalada se atualiza na próxima verificação.

O Firefox verifica atualizações de extensões a cada 24 h por padrão. Para receber a versão nova poucos minutos depois do push, use `user_pref("extensions.update.interval", 300);` no `user.js` do perfil (vale depois de reiniciar o Firefox). Menos de 5 min não adianta: o `raw.githubusercontent.com` guarda o `updates.json` em cache por 5 min (`max-age=300`). Para forçar na hora: `about:addons` → engrenagem → **Procurar atualizações**.

A própria extensão não consegue disparar a verificação: `runtime.requestUpdateCheck` não existe no Firefox (só no Chrome).

Alternativa sem assinatura: **Firefox Developer Edition / Nightly**, com `xpinstall.signatures.required = false` em `about:config`, instalando o `.zip` de `web-ext-artifacts/` em `about:addons` → engrenagem → *Instalar extensão de um arquivo*.

## Primeiro uso (modo conta Google)

1. Clique na engrenagem → **Abrir o Gemini para fazer login** e entre com sua conta Google normalmente (a extensão nunca vê sua senha).
2. Volte para a página em que quer trabalhar, abra o painel pelo ícone e peça algo, por exemplo:
   - "Resuma esta página"
   - "Curta a primeira publicação do feed"
   - "Pesquise notebook gamer e ordene pelo menor preço"
3. Nada de aba ou janela do Gemini: ele roda escondido no fundo da extensão. O login é feito uma vez numa aba normal (botão "Abrir o Gemini para fazer login"); depois disso o assistente usa a sua conta automaticamente.

### Um assistente por aba

O painel existe só na aba em que você o abriu: ao trocar de aba ele não aparece; ao voltar, está lá com a conversa. Em outra aba, o ícone abre um painel com conversa limpa. Se a página navegar (inclusive pelo próprio agente), o painel reaparece sozinho com a conversa, e a tarefa em andamento continua (o motor do agente roda no fundo da extensão). Páginas internas do Firefox (about:, addons.mozilla.org, leitor de PDF) não aceitam o painel — o ícone mostra "!".

## Configurações

- **Pedir confirmação antes de agir**: só para JavaScript (padrão), para toda ação, ou nunca. Na confirmação existe "Permitir tudo nesta tarefa".
- **Máximo de passos por pedido**: limite de ações em sequência (padrão 40).
- **Nova conversa** (botão +): começa uma conversa nova no Gemini.
- **Parar** (botão vermelho durante a execução): interrompe a tarefa e a resposta do Gemini.

## Como o Gemini "vê" a página

- `get_page` lista os elementos interativos visíveis com referências `[n]` (ex.: `[12] button "Curtir"`), mais URL, título e rolagem; opcionalmente o texto da página.
- As ações usam essas referências. Um contorno verde pisca no elemento em que o Gemini age.
- **Gemini em Ação**: enquanto o agente trabalha numa aba, a página ganha uma borda verde sutil e o aviso "Gemini em Ação" no topo; um cursor verde vai até cada elemento antes de clicar, digitar, escolher ou passar o mouse (com uma onda no clique). No WordPress/Elementor, que são montados pela API do editor, o cursor aponta a área de edição. Some sozinho ao fim da tarefa.
- `screenshot` captura a área visível (no modo conta Google a imagem é anexada no chat do Gemini; se o site não aceitar, ele segue só com `get_page`).

## Anexos

Botão **+** ao lado da caixa de texto, **Ctrl+V** ou arrastar e soltar: imagens, PDFs, documentos e qualquer arquivo que o Gemini aceite (até 20 por pedido, 25 MB cada; no modo conta Google eles vão em lotes de 10, que é o limite do Gemini por mensagem).

## Habilidades

Roteiros especializados que entram automaticamente quando o contexto pede (uma vez por conversa). Ligue/desligue em Configurações → Habilidades.

### WordPress

Ativa no painel/editor/site WordPress ou quando o pedido fala de WordPress, Gutenberg, Elementor etc. Exemplo: abra `wp-admin`, anexe prints e textos de referência e peça *"crie a página Consultoria com base nos anexos"*. O agente:

1. analisa os anexos e lista as seções (textos que faltam ficam como **[REVISAR]**);
2. abre Páginas > Adicionar nova e identifica o editor e o tema (se não for o editor de blocos — Elementor, Divi, WPBakery — para e pergunta);
3. envia as imagens anexadas à Biblioteca de Mídia com texto alternativo (prints que são só referência viram espaço reservado);
4. monta as seções em blocos do Gutenberg (hero, colunas, imagens, botões, cores, um único H1);
5. define slug e, se houver Yoast/Rank Math, título SEO e meta descrição;
6. **salva só como rascunho** (a ferramenta não tem opção de publicar e se recusa a salvar páginas já publicadas) e confere a pré-visualização por trás, sem trocar a sua tela;
7. entrega o relatório: link da pré-visualização, seções, itens [REVISAR] e diferenças em relação à referência.

Por baixo, usa a ferramenta `wordpress` (API do próprio editor: `wp.data`/`wp.blocks`), muito mais confiável que clicar no editor de blocos.

## Limitações

- Eventos de teclado e mouse são sintéticos (`isTrusted = false`). Quase todos os sites aceitam, mas alguns bloqueiam (atalhos de teclado de certos apps, captchas, alguns players).
- Não age dentro de iframes de outros domínios nem em páginas internas do Firefox (`about:`, addons.mozilla.org, leitor de PDF).
- `run_javascript` roda no contexto do content script (acessa o DOM; variáveis JavaScript da página ficam em `window.wrappedJSObject`).
- O modo conta Google depende da interface do gemini.google.com; se o Google mudar a página, os seletores em `content/gemini-bridge.js` podem precisar de ajuste.

## Estrutura

```
manifest.json            Manifest V2 (ícone com atalho, content scripts da ponte e do painel)
background.js            Motor escondido (sidebar.html?host=1 + Gemini), ícone abre/fecha o painel na aba
content/panel-host.js    Mostra o painel dentro da página (empurra o conteúdo) e o reabre após navegação
panel/                   Interface do painel (conversa espelhada do motor, envio, anexos, modelo, configurações)
content/agent.js         Injetado na página alvo: lê elementos e executa ações
content/gemini-bridge.js Roda no gemini.google.com: digita, espera a resposta, extrai ações
sidebar/                 Interface do chat, loop do agente, ferramentas e cliente da API
icons/icon.svg
```
