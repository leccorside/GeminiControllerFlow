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

  // ---------- "Gemini em Ação": borda verde, aviso no topo e cursor verde ----------
  // Enquanto o agente trabalha nesta aba, a área da página (sem o painel) ganha uma borda verde sutil e o aviso
  // "Gemini em Ação". O cursor verde vai até cada elemento antes de clicar/digitar/passar o mouse, como uma pessoa.
  // Tudo num Shadow DOM fechado e com pointer-events:none: não interfere nos cliques nem no CSS da página.
  let acaoHost = null, acaoRoot = null, cursorEl = null;
  let cursorPos = null;
  const CURSOR_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2.5 L19.5 13 L12.6 14.2 L16.4 21.3 L13.4 22.8 L9.7 15.6 L4.6 20.2 Z" fill="#22c55e" stroke="#052e16" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

  function montarAcao(label) {
    if (acaoHost) { acaoRoot.querySelector(".rotulo span").textContent = label; return; }
    acaoHost = document.createElement("gcf-acao");
    acaoHost.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;display:block";
    acaoRoot = acaoHost.attachShadow({ mode: "closed" });
    acaoRoot.innerHTML = `<style>
      :host { all: initial; }
      .moldura { position: fixed; top: 0; left: 0; bottom: 0; right: var(--painel, 0px); pointer-events: none;
        border: 3px solid rgba(34, 197, 94, .75); box-shadow: inset 0 0 22px rgba(34, 197, 94, .35);
        animation: brilho 2.4s ease-in-out infinite; }
      .rotulo { position: fixed; top: 10px; left: calc((100vw - var(--painel, 0px)) / 2); transform: translateX(-50%);
        display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 11px; border-radius: 999px;
        background: #15803d; color: #fff; font: 600 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
        letter-spacing: .01em; box-shadow: 0 4px 14px rgba(0, 0, 0, .25); pointer-events: none; white-space: nowrap; }
      .ponto { width: 8px; height: 8px; border-radius: 50%; background: #bbf7d0; animation: pisca 1.2s ease-in-out infinite; }
      .cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; pointer-events: none; opacity: 0;
        transition: transform .45s cubic-bezier(.22, .9, .3, 1), opacity .2s; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      .cursor.on { opacity: 1; }
      .onda { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; pointer-events: none;
        border: 2px solid #22c55e; background: rgba(34, 197, 94, .25); animation: onda .55s ease-out forwards; }
      @keyframes brilho { 50% { border-color: rgba(34, 197, 94, .45); box-shadow: inset 0 0 12px rgba(34, 197, 94, .2); } }
      @keyframes pisca { 50% { opacity: .35; } }
      @keyframes onda { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .moldura, .ponto { animation: none; } .cursor { transition: opacity .2s; } }
    </style>
    <div class="moldura"></div>
    <div class="rotulo"><i class="ponto"></i><span></span></div>
    <div class="cursor">${CURSOR_SVG}</div>`;
    acaoRoot.querySelector(".rotulo span").textContent = label;
    cursorEl = acaoRoot.querySelector(".cursor");
    ajustarPainel();
    document.documentElement.appendChild(acaoHost);
  }
  function ajustarPainel() { if (acaoHost) acaoHost.style.setProperty("--painel", frame ? LARGURA + "px" : "0px"); }
  function desmontarAcao() {
    if (acaoHost) acaoHost.remove();
    acaoHost = acaoRoot = cursorEl = null;
  }
  // Leva o cursor verde até (x, y) da janela, com a animação de movimento; resolve quando chega.
  function cursorPara(x, y) {
    if (!cursorEl) return Promise.resolve();
    const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!cursorPos) {
      // Primeira vez: aparece perto do centro da página e vai até o alvo.
      const w = innerWidth - (frame ? LARGURA : 0);
      cursorPos = [w / 2, innerHeight / 2];
      cursorEl.style.transition = "none";
      cursorEl.style.transform = `translate(${cursorPos[0]}px, ${cursorPos[1]}px)`;
      void cursorEl.offsetWidth;
      cursorEl.style.transition = "";
    }
    cursorEl.classList.add("on");
    const longe = Math.hypot(x - cursorPos[0], y - cursorPos[1]) > 4;
    cursorPos = [x, y];
    cursorEl.style.transform = `translate(${x}px, ${y}px)`;
    return new Promise(r => setTimeout(r, longe && !reduzido ? 480 : 60));
  }
  function cliqueVisual(x, y) {
    if (!acaoRoot) return;
    const o = document.createElement("div");
    o.className = "onda";
    o.style.left = x + "px"; o.style.top = y + "px";
    acaoRoot.appendChild(o);
    setTimeout(() => o.remove(), 650);
  }
  // Usado por content/agent.js (mesmo contexto de content script desta aba).
  window.__gcfAcao = { cursorPara, cliqueVisual, ativo: () => !!acaoHost };

  browser.runtime.onMessage.addListener(m => {
    if (!m || !m.gcfPanel) return undefined;
    if (m.gcfPanel === "open") abrir(m.url);
    if (m.gcfPanel === "close") fechar();
    if (m.gcfPanel === "acao") { if (m.on) montarAcao(m.label || "Gemini em Ação"); else desmontarAcao(); }
    ajustarPainel();
    return Promise.resolve({ ok: true });
  });

  browser.runtime.sendMessage({ gcfPanel: "query" }).then(r => {
    if (r && r.open) abrir(r.url);
    if (r && r.acao) montarAcao(r.label || "Gemini em Ação");
    ajustarPainel();
  }).catch(() => {});
})();
