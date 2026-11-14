# GeminiControllerFlow — extensão para Firefox

Abre o Gemini na barra lateral do Firefox como assistente, com acesso à página aberta e capacidade de agir nela: ler, clicar, digitar, escolher opções, rolar, passar o mouse, pressionar teclas, navegar, trocar/abrir abas, capturar a tela e executar JavaScript.

## Dois modos de uso

| Modo | Como funciona | Precisa de |
|---|---|---|
| **Minha conta Google** (padrão) | A extensão abre uma aba fixada do `gemini.google.com` (logada na sua conta) e conversa com ele por lá: digita suas mensagens, espera a resposta, executa as ações pedidas na sua página e devolve o resultado. A conversa também fica no histórico do Gemini. | Só estar logado no gemini.google.com |
| **Chave da API** | Chama a API oficial do Gemini com *function calling*. Mais rápido e estável. | Chave do [Google AI Studio](https://aistudio.google.com/apikey) |

## Instalar (modo desenvolvedor)

1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em **Carregar extensão temporária…** e escolha o arquivo `manifest.json` desta pasta.
3. A barra lateral do Gemini abre sozinha. Também dá para abrir pelo ícone na barra de ferramentas ou com **Ctrl+Shift+Y**.

A instalação temporária some ao fechar o Firefox.

## Instalar de forma definitiva (Firefox normal)

O Firefox normal só instala de vez extensões assinadas pela Mozilla. A assinatura "não listada" é gratuita e automática (a extensão não aparece na loja):

1. Entre (ou crie a conta) em [addons.mozilla.org](https://addons.mozilla.org) e gere as credenciais em [Gerenciar chaves de API](https://addons.mozilla.org/pt-BR/developers/addon/api/key/) — *Emissor JWT* e *Segredo JWT*.
2. Na pasta do projeto, rode:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\assinar-e-instalar.ps1
   ```
   O script pede as duas credenciais (não grava em arquivo), assina, gera o `.xpi` em `web-ext-artifacts/` e abre no Firefox. Confirme em **Adicionar**.
3. Para publicar uma atualização, aumente `version` no `manifest.json` e rode o script de novo (a Mozilla não assina a mesma versão duas vezes).

Alternativa sem assinatura: **Firefox Developer Edition / Nightly**, com `xpinstall.signatures.required = false` em `about:config`, instalando o `.zip` de `web-ext-artifacts/` em `about:addons` → engrenagem → *Instalar extensão de um arquivo*.

## Primeiro uso (modo conta Google)

1. Clique na engrenagem → **Abrir o Gemini para fazer login** e entre com sua conta Google normalmente (a extensão nunca vê sua senha).
2. Volte para a página em que quer trabalhar e peça algo na barra lateral, por exemplo:
   - "Resuma esta página"
   - "Curta a primeira publicação do feed"
   - "Pesquise notebook gamer e ordene pelo menor preço"
3. A aba fixada do Gemini precisa continuar aberta (pode ficar em segundo plano).

## Configurações

- **Pedir confirmação antes de agir**: só para JavaScript (padrão), para toda ação, ou nunca. Na confirmação existe "Permitir tudo nesta tarefa".
- **Máximo de passos por pedido**: limite de ações em sequência (padrão 40).
- **Nova conversa** (botão +): começa uma conversa nova no Gemini.
- **Parar** (botão vermelho durante a execução): interrompe a tarefa e a resposta do Gemini.

## Como o Gemini "vê" a página

- `get_page` lista os elementos interativos visíveis com referências `[n]` (ex.: `[12] button "Curtir"`), mais URL, título e rolagem; opcionalmente o texto da página.
- As ações usam essas referências. Um contorno roxo pisca no elemento em que o Gemini age.
- `screenshot` captura a área visível (no modo conta Google a imagem é colada no chat do Gemini; se o site não aceitar, ele segue só com `get_page`).

## Limitações

- Eventos de teclado e mouse são sintéticos (`isTrusted = false`). Quase todos os sites aceitam, mas alguns bloqueiam (atalhos de teclado de certos apps, captchas, alguns players).
- Não age dentro de iframes de outros domínios nem em páginas internas do Firefox (`about:`, addons.mozilla.org, leitor de PDF).
- `run_javascript` roda no contexto do content script (acessa o DOM; variáveis JavaScript da página ficam em `window.wrappedJSObject`).
- O modo conta Google depende da interface do gemini.google.com; se o Google mudar a página, os seletores em `content/gemini-bridge.js` podem precisar de ajuste.

## Estrutura

```
manifest.json            Manifest V2 (sidebar_action, content script da ponte, atalho)
background.js            Ícone da barra de ferramentas abre/fecha a barra lateral
content/agent.js         Injetado na página alvo: lê elementos e executa ações
content/gemini-bridge.js Roda no gemini.google.com: digita, espera a resposta, extrai ações
sidebar/                 Interface do chat, loop do agente, ferramentas e cliente da API
icons/icon.svg
```
