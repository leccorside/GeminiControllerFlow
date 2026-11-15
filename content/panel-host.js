// Mostra o painel do assistente DENTRO da página (só nas abas em que o usuário o abriu), empurrando o conteúdo
// para a esquerda. Ao carregar a página, pergunta ao fundo da extensão se o painel estava aberto nesta aba
// (assim ele reaparece depois de uma navegação, com a conversa).
(() => {
  if (window.top !== window || window.__gcfPanelHost) return;
  window.__gcfPanelHost = true;

  const LARGURA = 420;
  let frame = null;
  let estilo = null;

  function abrir(url) {
    if (frame) { if (frame.src !== url) frame.src = url; return; }
    estilo = document.createElement("style");
    estilo.textContent = `html { margin-right: ${LARGURA}px !important; }`;
    (document.head || document.documentElement).appendChild(estilo);
    frame = document.createElement("iframe");
    frame.src = url;
    frame.title = "GeminiControllerFlow";
    frame.setAttribute("allow", "clipboard-read; clipboard-write");
    frame.dataset.gcfPanel = "1";
    frame.style.cssText = [
      "position:fixed", "top:0", "right:0", `width:${LARGURA}px`, "height:100vh", "max-height:100vh",
      "border:0", "border-left:1px solid rgba(127,127,127,.35)", "margin:0", "padding:0",
      "z-index:2147483647", "background:#18181b", "color-scheme:normal", "display:block", "visibility:visible", "opacity:1"
    ].map(r => r + " !important").join(";");
    document.documentElement.appendChild(frame);
  }

  function fechar() {
    if (frame) frame.remove();
    if (estilo) estilo.remove();
    frame = estilo = null;
  }

  browser.runtime.onMessage.addListener(m => {
    if (!m || !m.gcfPanel) return undefined;
    if (m.gcfPanel === "open") abrir(m.url);
    if (m.gcfPanel === "close") fechar();
    return Promise.resolve({ ok: true });
  });

  browser.runtime.sendMessage({ gcfPanel: "query" }).then(r => { if (r && r.open) abrir(r.url); }).catch(() => {});
})();
