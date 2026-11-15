// Ponte com o gemini.google.com (roda na aba do Gemini, logada com a conta Google do usuário).
// Digita mensagens no chat, espera a resposta terminar e devolve o texto + as ações pedidas.
(() => {
  if (window.__geminiBridge) return;
  window.__geminiBridge = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isVisible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labelOf = b => (b.getAttribute("aria-label") || b.getAttribute("mattooltip") || "").toLowerCase();
  const buttons = () => [...document.querySelectorAll("button")];

  // Com a conta logada o Gemini pode ter mais de uma caixa e mais de um botão "Send message" na página
  // (edição de mensagem, painéis, Canvas). Preferimos sempre os VISÍVEIS da área de digitação principal.
  const INPUT_AREA = "input-area-v2, input-container, .input-area-container, .input-area";
  function editor() {
    const all = [...document.querySelectorAll("rich-textarea .ql-editor[contenteditable=true], rich-textarea [contenteditable=true]")];
    // Na interface nova (conta Pro), a caixa da tela inicial continua na página depois do envio, com o texto antigo,
    // e parece visível com a aba em 2º plano (a animação que a esconde não roda). Preferimos a caixa VAZIA e a última.
    const vis = all.filter(e => isVisible(e) && e.closest(INPUT_AREA));
    const pool = vis.length ? vis : all.filter(isVisible);
    const vazia = pool.filter(e => !clean(e.textContent));
    return vazia.at(-1) || pool.at(-1) || all.at(-1) || null;
  }
  const SEND_LABEL = /^(enviar mensagem|enviar|send message|send|enviar mensaje)$/;
  function sendCandidates() {
    return buttons().filter(b => SEND_LABEL.test(labelOf(b).trim()) || b.classList.contains("send-button") ||
      b.matches("[data-test-id*=send]") || !!b.querySelector("mat-icon[fonticon=send], mat-icon[data-mat-icon-name=send]"));
  }
  function sendButton() {
    const ed = editor();
    const area = ed && ed.closest(INPUT_AREA);
    const cands = sendCandidates();
    return (area && cands.find(b => area.contains(b) && isVisible(b))) ||
      cands.find(b => isVisible(b) && SEND_LABEL.test(labelOf(b).trim())) ||
      cands.find(isVisible) || cands[0] || null;
  }
  // Clique "completo" (pointer + mouse + click), no centro do botão — alguns componentes ouvem pointerdown/up.
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...o, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...o, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.click();
  }
  const stopButton = () => buttons().find(b => /parar resposta|stop response|parar de gerar|stop generating/.test(labelOf(b)));
  const responses = () => [...document.querySelectorAll("model-response")];

  function isLoggedIn() {
    const signIn = [...document.querySelectorAll("a[href*='accounts.google.com'], button")]
      .some(el => /^(fazer login|sign in)$/i.test((el.textContent || labelOf(el)).trim()));
    return !signIn;
  }

  // Conta Google conectada: lida do botão do avatar ("Conta do Google: Nome (email@gmail.com)").
  function account() {
    const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
    const candidates = [...document.querySelectorAll(
      "a[aria-label*='Conta do Google'], a[aria-label*='Google Account'], a[href*='accounts.google.com/SignOutOptions'], [aria-label*='@']"
    )];
    for (const el of candidates) {
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
      const email = label.match(EMAIL)?.[0];
      if (!email) continue;
      let nome = label.replace(/^[^:]*:\s*/, "").replace(/\(?\s*[\w.+-]+@[\w-]+(\.[\w-]+)+\s*\)?/, "").trim();
      if (!nome || nome === label) nome = "";
      const img = el.querySelector("img");
      return { email, nome, foto: img?.src || null };
    }
    return null;
  }

  // Converte o HTML da resposta em texto/markdown simples, preservando blocos de código.
  function toText(root) {
    let out = "";
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) { out += node.textContent; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const tag = el.tagName.toLowerCase();
      if (["button", "mat-icon", "script", "style", "sources-carousel-inline", "source-footnote"].includes(tag)) return;
      if (el.classList.contains("code-block-decoration") || el.classList.contains("cdk-visually-hidden")) return;
      if (tag === "code-block" || tag === "pre") {
        const code = el.querySelector("code");
        const lang = (code?.getAttribute("data-test-id") || "").trim();
        out += "\n```" + (lang && !/code/.test(lang) ? lang : "") + "\n" + (code ? code.textContent : el.textContent).replace(/\n$/, "") + "\n```\n";
        return;
      }
      if (tag === "code") { out += "`" + el.textContent + "`"; return; }
      if (tag === "br") { out += "\n"; return; }
      const block = /^(p|div|h[1-6]|li|tr|table|ul|ol|blockquote|response-element)$/.test(tag);
      if (tag === "li") out += "\n- ";
      else if (/^h[1-6]$/.test(tag)) out += "\n" + "#".repeat(Number(tag[1])) + " ";
      else if (block) out += "\n";
      if (tag === "strong" || tag === "b") out += "**";
      for (const c of el.childNodes) walk(c);
      if (tag === "strong" || tag === "b") out += "**";
      if (tag === "td" || tag === "th") out += " | ";
      if (block) out += "\n";
    };
    walk(root);
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Extrai ações {"tool": "...", "args": {...}} dos blocos de código da resposta.
  function extractActions(root) {
    const actions = [];
    const tryParse = s => {
      try {
        const v = JSON.parse(s.trim());
        const list = Array.isArray(v) ? v : [v];
        for (const a of list) {
          if (!a || typeof a.tool !== "string") continue;
          // Aceita também o formato "achatado" que o Gemini às vezes usa: {"tool": "click", "ref": 5}.
          let args = a.args && typeof a.args === "object" ? a.args : null;
          if (!args) { const { tool, ...resto } = a; args = resto; }
          actions.push({ tool: a.tool, args });
        }
        return true;
      } catch (_) { return false; }
    };
    root.querySelectorAll("code").forEach(c => tryParse(c.textContent));
    if (!actions.length) {
      // Plano B: JSON solto no texto.
      const m = root.textContent.match(/\{\s*"tool"\s*:\s*"[^"]+"[\s\S]*?\}\s*\}/g);
      if (m) m.forEach(tryParse);
    }
    return actions;
  }

  async function attachImage(base64, mimeType) {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const file = new File([bytes], "captura-da-tela.jpg", { type: mimeType });
    const area = document.querySelector("input-area-v2") || document.body;
    const countImgs = () => area.querySelectorAll("img").length;
    const before = countImgs();
    const ed = editor();
    ed.focus();
    const dt1 = new DataTransfer(); dt1.items.add(file);
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt1, bubbles: true, cancelable: true }));
    for (let i = 0; i < 12; i++) { await sleep(250); if (countImgs() > before) return true; }
    // Plano B: arrastar e soltar.
    const dt2 = new DataTransfer(); dt2.items.add(file);
    for (const type of ["dragenter", "dragover", "drop"]) {
      area.dispatchEvent(new DragEvent(type, { dataTransfer: dt2, bubbles: true, cancelable: true }));
    }
    for (let i = 0; i < 12; i++) { await sleep(250); if (countImgs() > before) return true; }
    return false;
  }

  // ---------- Seletor de modelo do gemini.google.com ----------
  // Estrutura conferida em 14/11/2026: botão [data-test-id=bard-mode-menu-button] (aria-controls -> gem-menu[role=menu]);
  // itens gem-menu-item[role=menuitemradio] com .label (descrição, ex.: "Código e análise"), .sublabel (modelo, ex.: "4 Argon")
  // e .badge ("Novo"); aria-checked = em uso; aria-disabled = bloqueado. Escape não fecha: fecha clicando no botão de novo.
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  let lastSelected = null; // { nome, botao } — nome do modelo em uso e o texto do botão naquele momento

  function modelButton() {
    return document.querySelector("[data-test-id='bard-mode-menu-button'], bard-mode-switcher button, button.input-area-switch") ||
      buttons().find(b => b.getAttribute("aria-haspopup") && /seletor de modo|mode picker|mode selector|selector de modo/i.test(labelOf(b)));
  }

  function menuEl(btn) {
    const id = btn && btn.getAttribute("aria-controls");
    return (id && document.getElementById(id)) || document.querySelector("gem-menu[role=menu]");
  }

  function menuItems(btn) {
    const menu = menuEl(btn);
    const scope = menu || document;
    let items = [...scope.querySelectorAll("gem-menu-item[role=menuitemradio], [role=menuitemradio]")];
    if (!items.length) items = [...document.querySelectorAll(".cdk-overlay-container [role=menuitemradio], .cdk-overlay-container [role=option]")];
    return items;
  }

  const isOpen = btn => btn.getAttribute("aria-expanded") === "true" || menuItems(btn).some(el => el.getBoundingClientRect().height > 0);

  async function closeMenu(btn) {
    if (btn && btn.getAttribute("aria-expanded") === "true") btn.click();
    await sleep(150);
  }

  async function openMenu() {
    const btn = modelButton();
    if (!btn) throw new Error("Não encontrei o seletor de modelo do Gemini (a interface pode ter mudado).");
    if (!isOpen(btn)) {
      btn.click();
      for (let i = 0; i < 30 && !menuItems(btn).length; i++) await sleep(100);
    }
    const items = menuItems(btn);
    if (!items.length) { await closeMenu(btn); throw new Error("O menu de modelos do Gemini não abriu."); }
    return { btn, items };
  }

  function describeItem(el) {
    const label = clean(el.querySelector(".label")?.textContent);
    const sub = clean(el.querySelector(".sublabel")?.textContent);
    const selo = clean(el.querySelector(".badge, .trailing-badge")?.textContent);
    let nome, descricao;
    if (sub) { nome = /gemini/i.test(sub) ? sub : "Gemini " + sub; descricao = label; }
    else {
      const lines = (el.innerText || el.textContent || "").split(/\n/).map(clean).filter(Boolean);
      nome = label || lines[0] || ""; descricao = lines.filter(l => l !== nome && l !== selo).join(" — ");
    }
    return {
      nome, descricao, selo,
      id: el.getAttribute("data-mode-id") || "",
      selecionado: el.getAttribute("aria-checked") === "true" || el.getAttribute("data-active") === "true",
      desabilitado: el.getAttribute("aria-disabled") === "true"
    };
  }

  function buttonText() {
    const btn = modelButton();
    if (!btn) return null;
    const span = btn.querySelector(".logo-pill-label-container span, .input-area-switch-label span");
    return clean(span?.textContent || btn.innerText || btn.textContent).replace(/\b(arrow_drop_down|expand_more|keyboard_arrow_down)\b/g, "").trim() || null;
  }

  // Nome amigável do modelo em uso (o botão mostra uma forma curta, ex.: "Flash-Lite").
  function currentModel() {
    const txt = buttonText();
    if (lastSelected && lastSelected.botao === txt) return lastSelected.nome;
    return txt;
  }

  // ---- Nível de raciocínio (submenu do item, se o Gemini oferecer) ----
  // Sem login o menu não tem submenu; com conta, alguns modelos podem ter um submenu de nível (ex.: Medium/High).
  const SUB_ICONS = /^(chevron_right|arrow_right|keyboard_arrow_right|arrow_forward_ios|navigate_next)$/;
  function hasSubmenu(el) {
    if (el.getAttribute("aria-haspopup") === "true") return true;
    return [...el.querySelectorAll("mat-icon")].some(i => SUB_ICONS.test(i.getAttribute("data-mat-icon-name") || i.getAttribute("fonticon") || clean(i.textContent)));
  }

  const visibleMenus = () => [...document.querySelectorAll("gem-menu[role=menu], [role=menu]")]
    .filter(m => m.getBoundingClientRect().height > 0);

  async function openSubmenu(el, mainMenu) {
    const known = new Set(visibleMenus());
    known.add(mainMenu);
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const ty of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
      el.dispatchEvent(new (ty.startsWith("pointer") ? PointerEvent : MouseEvent)(ty, opts));
    }
    let sub = null;
    for (let i = 0; i < 10 && !sub; i++) { await sleep(100); sub = visibleMenus().find(m => !known.has(m)); }
    if (!sub && el.getAttribute("aria-haspopup") === "true") {
      (el.querySelector("gem-menu-item-content") || el).click();
      for (let i = 0; i < 10 && !sub; i++) { await sleep(100); sub = visibleMenus().find(m => !known.has(m)); }
    }
    return sub;
  }

  function levelItems(sub) {
    return [...sub.querySelectorAll("[role=menuitemradio], [role=menuitem], gem-menu-item")].map(it => ({
      el: it,
      nome: clean(it.querySelector(".label")?.textContent) || clean(it.innerText || it.textContent),
      selecionado: it.getAttribute("aria-checked") === "true" || it.getAttribute("data-active") === "true",
      desabilitado: it.getAttribute("aria-disabled") === "true"
    })).filter(l => l.nome);
  }

  async function listModels() {
    const { btn, items } = await openMenu();
    const mainMenu = menuEl(btn);
    const modelos = [];
    for (const it of items) {
      const d = describeItem(it);
      if (!d.nome) continue;
      if (!d.desabilitado && hasSubmenu(it)) {
        try {
          const sub = await openSubmenu(it, mainMenu);
          if (sub) {
            d.niveis = levelItems(sub).map(({ nome, selecionado, desabilitado }) => ({ nome, selecionado, desabilitado }));
            d.nivel = (d.niveis.find(l => l.selecionado) || {}).nome || "";
          }
        } catch (_) { /* sem submenu legível */ }
      }
      modelos.push(d);
    }
    await closeMenu(btn);
    const sel = modelos.find(m => m.selecionado);
    if (sel) lastSelected = { nome: sel.nome, nivel: sel.nivel || "", botao: buttonText() };
    return { atual: currentModel(), modelos };
  }

  async function selectModel({ nome, nivel }) {
    const alvo = clean(nome).toLowerCase();
    const { btn, items } = await openMenu();
    const match = el => {
      const d = describeItem(el);
      return [d.nome, d.descricao, d.id].map(x => (x || "").toLowerCase());
    };
    const item = items.find(el => match(el).includes(alvo)) ||
      items.find(el => match(el).some(x => x && (x.includes(alvo) || alvo.includes(x))));
    if (!item) { await closeMenu(btn); throw new Error(`Modelo "${nome}" não encontrado no menu do Gemini.`); }
    const d = describeItem(item);
    if (d.desabilitado) { await closeMenu(btn); throw new Error(`O modelo "${d.nome}" está bloqueado nesta conta (faça login ou verifique o plano).`); }
    let nivelEscolhido = "";
    if (nivel && hasSubmenu(item)) {
      const sub = await openSubmenu(item, menuEl(btn));
      const niveis = sub ? levelItems(sub) : [];
      const n = clean(nivel).toLowerCase();
      const lv = niveis.find(l => l.nome.toLowerCase() === n) || niveis.find(l => l.nome.toLowerCase().includes(n));
      if (!lv) { await closeMenu(btn); throw new Error(`Nível "${nivel}" não encontrado para ${d.nome}.`); }
      if (lv.desabilitado) { await closeMenu(btn); throw new Error(`O nível "${lv.nome}" está bloqueado nesta conta.`); }
      (lv.el.querySelector("gem-menu-item-content") || lv.el).click();
      nivelEscolhido = lv.nome;
    } else {
      (item.querySelector("gem-menu-item-content") || item).click();
    }
    for (let i = 0; i < 20 && btn.getAttribute("aria-expanded") === "true"; i++) await sleep(100);
    if (btn.getAttribute("aria-expanded") === "true") await closeMenu(btn);
    lastSelected = { nome: d.nome, nivel: nivelEscolhido, botao: buttonText() };
    return { ok: true, atual: d.nome, nivel: nivelEscolhido };
  }

  // O que a página do Gemini mostra quando o envio não acontece: estado do botão, avisos e janelas abertas.
  function sendDiagnostics(btn) {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const textos = sel => [...document.querySelectorAll(sel)].filter(visible)
      .map(el => clean(el.innerText || el.textContent)).filter(t => t && t.length < 300);
    const area = document.querySelector("input-area-v2, input-container") || document.body;
    const avisos = [...new Set([
      ...textos("[role=alert], [aria-live=assertive], mat-error, .mat-mdc-snack-bar-label, simple-snack-bar, .snackbar, .error-message"),
      ...[...area.querySelectorAll("[class*=error], [class*=warning], [class*=limit], [class*=hint], [class*=counter]")]
        .filter(visible).map(el => clean(el.innerText || el.textContent)).filter(t => t && t.length < 300)
    ])].slice(0, 4);
    const dlg = [...document.querySelectorAll("[role=dialog], mat-dialog-container, .cdk-overlay-pane")].find(visible);
    const eds = [...document.querySelectorAll("rich-textarea [contenteditable=true]")];
    const sends = sendCandidates();
    const ed = editor();
    return {
      botao: btn ? clean(btn.getAttribute("aria-label") || btn.innerText) : "nenhum",
      desabilitado: !!btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true"),
      botaoVisivel: !!btn && visible(btn),
      botaoNaAreaDaCaixa: !!(btn && ed && ed.closest(INPUT_AREA) && ed.closest(INPUT_AREA).contains(btn)),
      caixas: `${eds.filter(visible).length} visíveis de ${eds.length}`,
      botoesEnviar: `${sends.filter(visible).length} visíveis de ${sends.length}`,
      avisos,
      dialogo: dlg ? clean(dlg.innerText || dlg.textContent).slice(0, 200) : ""
    };
  }

  // ---------- Monitor de rede ----------
  // Cada envio ao Gemini gera uma requisição de geração. O PerformanceObserver registra quando ela TERMINA,
  // só observando (não mexe nas requisições da página) — funciona com a aba em 2º plano, quando a tela pode não
  // ser redesenhada. Não envolver XMLHttpRequest/fetch da página: testado, isso quebra o envio do Gemini.
  // Nome conferido em 14/11/2026: a interface atual envia por geminiweb-pa.clients6.google.com/v1/processSession
  // (a antiga usava .../StreamGenerate).
  const STREAM = /StreamGenerate|\/v1\/processSession/i;
  const net = { inicios: 0, fins: 0, ultimoFim: 0 }; // "inicios" fica em 0 (sem sinal de início); mantido para os diagnósticos
  try {
    const po = new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (STREAM.test(e.name)) { net.fins++; net.ultimoFim = Date.now(); }
    });
    po.observe({ type: "resource", buffered: false });
  } catch (_) { /* sem PerformanceObserver */ }

  let stopRequested = false;
  let pendente = null; // estado do último envio, para o "collect" ler a resposta sem reenviar

  const queries = () => [...document.querySelectorAll("user-query")];

  async function ask({ text, image }) {
    stopRequested = false;
    let ed = editor();
    for (let i = 0; !ed && i < 40; i++) { await sleep(250); ed = editor(); }
    if (!ed) return { erro: "Não encontrei a caixa de mensagem do Gemini. A página carregou? Talvez seja preciso fazer login." };

    // Espera uma resposta anterior terminar.
    for (let i = 0; stopButton() && i < 120; i++) await sleep(500);

    let imageAttached = null;
    if (image) {
      imageAttached = await attachImage(image.data, image.mimeType);
      if (imageAttached) await sleep(1500); // upload
    }

    // Marcas de antes do envio (DOM, endereço e rede).
    const st = {
      before: responses().length,
      lastRespBefore: responses().at(-1) || null,
      queriesBefore: queries().length,
      lastQueryBefore: queries().at(-1) || null,
      urlBefore: location.href,
      iniciosBefore: net.inicios,
      finsBefore: net.fins,
      imageAttached
    };

    ed.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges(); sel.addRange(range);
    if (!document.execCommand("insertText", false, text)) {
      ed.textContent = text;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    await sleep(300);
    const typed = clean(ed.textContent).length;
    if (!typed && clean(text)) {
      return { erro: "Não consegui escrever na caixa de mensagem do Gemini (ela continuou vazia). Recarregue a aba do Gemini e tente de novo." };
    }

    let btn;
    for (let i = 0; i < 40; i++) {
      btn = sendButton();
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") break;
      await sleep(250);
    }
    if (!btn) return { erro: `Botão de enviar do Gemini não encontrado (a interface pode ter mudado). Texto na caixa: ${typed} caracteres.` };
    realClick(btn);

    // 1) A mensagem saiu? Qualquer sinal basta. NÃO olhamos "a caixa atual": na interface nova a caixa da tela
    //    inicial continua com o texto depois do envio. Usamos a caixa em que digitamos (ed), o endereço e a rede.
    // Devolve o nome do primeiro sinal de envio encontrado (ou "" se nenhum).
    // A rede NÃO entra aqui: processSession também aparece fora do envio (falso positivo visto em teste).
    const sinalEnvio = () =>
      !ed.isConnected ? "caixa-removida" :
      clean(ed.textContent).length < Math.min(typed, 20) ? "caixa-vazia" :
      location.href !== st.urlBefore ? "endereco" :
      queries().length > st.queriesBefore || (queries().at(-1) || null) !== st.lastQueryBefore ? "pergunta-na-tela" :
      stopButton() ? "botao-parar" :
      started(st) ? "resposta-na-tela" : "";
    const sent = () => !!sinalEnvio();
    st.sinalEnvio = sinalEnvio;
    Object.assign(st, { sent, ed, btn, typed });
    let t = Date.now();
    // Com a aba OCULTA, o Gemini da conta logada deixa o envio na fila até a aba ficar visível (confirmado pelo
    // usuário: a mensagem saía quando ele abria a aba). Sem sinal em 4 s, pedimos à barra lateral para mostrar a
    // aba — sem reenviar nada, para não duplicar a mensagem quando a fila andar.
    const espera = document.hidden ? 4000 : 15000;
    while (!sent() && Date.now() - t < espera) await sleep(300);
    if (!sent()) {
      if (document.hidden) {
        st.aguardandoEnvio = true;
        pendente = st;
        return { precisaVisivel: true, enviada: false };
      }
      // Aba visível e nada saiu: uma nova tentativa com Enter.
      ed.focus();
      const kev = type => new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true });
      ed.dispatchEvent(kev("keydown")); ed.dispatchEvent(kev("keypress")); ed.dispatchEvent(kev("keyup"));
      t = Date.now();
      while (!sent() && Date.now() - t < 8000) await sleep(300);
      if (!sent()) return notSentError(st);
    }
    pendente = st;
    return waitAndRead(st);
  }

  function notSentError(st) {
    const d = sendDiagnostics(st.btn);
    return {
      erro: `A mensagem não foi enviada ao Gemini (nenhum sinal de envio; o texto continua na caixa: ${clean(st.ed.textContent).length} de ${st.typed} caracteres; aba oculta: ${document.hidden ? "sim" : "não"}). ` +
        `Botão de enviar: "${d.botao}"${d.desabilitado ? " (desabilitado)" : ""}${d.botaoVisivel ? "" : " (invisível)"}${d.botaoNaAreaDaCaixa ? "" : " (fora da área da caixa)"}; ` +
        `caixas: ${d.caixas}; botões de enviar: ${d.botoesEnviar}.` +
        (d.avisos.length ? ` Aviso na tela do Gemini: ${d.avisos.join(" | ")}` : " Nenhum aviso visível perto da caixa.") +
        (d.dialogo ? ` Janela aberta: ${d.dialogo}` : ""),
      diagnostico: d,
      naoEnviada: true
    };
  }

  // Resposta nova na tela: mais blocos, ou o último bloco é outro (lista virtualizada em conversas longas).
  function started(st) {
    return responses().length > st.before || (responses().at(-1) || null) !== st.lastRespBefore;
  }

  // 2) Espera a resposta começar e terminar, e lê o texto. Se a rede mostra a resposta pronta mas a tela não foi
  //    redesenhada (aba em 2º plano), devolve precisaVisivel para a barra lateral mostrar a aba por um instante.
  async function waitAndRead(st) {
    const start = Date.now();
    let sawStop = false;
    // A rede "ficou quieta": houve requisição de geração depois do envio e nenhuma nova há 5 s.
    const redeQuieta = () => net.fins > st.finsBefore && Date.now() - net.ultimoFim > 5000;
    while (!started(st)) {
      if (stopRequested) return { erro: "Interrompido." };
      if (stopButton()) sawStop = true;
      if (redeQuieta() && document.hidden) return { precisaVisivel: true, enviada: true, sinal: st.sinalEnvio ? st.sinalEnvio() : "" };
      const limite = sawStop || net.inicios > st.iniciosBefore ? 300000 : 90000;
      if (Date.now() - start > limite) {
        if (document.hidden && (net.inicios > st.iniciosBefore || net.fins > st.finsBefore)) return { precisaVisivel: true, enviada: true, sinal: st.sinalEnvio ? st.sinalEnvio() : "" };
        return { erro: `O Gemini não começou a responder em ${Math.round(limite / 1000)} s ` +
          `(mensagem enviada: sim; gerando: ${stopButton() ? "sim" : "não"}; respostas na tela: ${st.before} → ${responses().length}; ` +
          `requisições: ${net.inicios - st.iniciosBefore} iniciadas / ${net.fins - st.finsBefore} concluídas; aba oculta: ${document.hidden ? "sim" : "não"}).` };
      }
      await sleep(400);
    }
    // Espera terminar: sem botão de parar e texto estável (ou a rede já concluiu e o texto parou de mudar).
    let lastText = "", stableSince = Date.now();
    while (Date.now() - start < 300000) {
      if (stopRequested) { stopButton()?.click(); break; }
      await sleep(500);
      const r = responses().at(-1);
      const t = r?.textContent || "";
      if (t !== lastText) { lastText = t; stableSince = Date.now(); continue; }
      if ((!stopButton() || redeQuieta()) && Date.now() - stableSince > 1200 && t.trim()) break;
      if (redeQuieta() && !t.trim() && document.hidden && Date.now() - stableSince > 4000) return { precisaVisivel: true, enviada: true, sinal: st.sinalEnvio ? st.sinalEnvio() : "" };
    }
    const r = responses().at(-1);
    const md = r.querySelector("message-content .markdown, message-content") || r;
    pendente = null;
    return { texto: toText(md), acoes: extractActions(md), imagem_anexada: st.imageAttached, requisicoes: net.fins - st.finsBefore };
  }

  // Lê a resposta do último envio sem reenviar (usado depois de mostrar a aba do Gemini).
  async function collect() {
    if (!pendente) {
      const r = responses().at(-1);
      if (!r) return { erro: "Não há resposta do Gemini para ler." };
      const md = r.querySelector("message-content .markdown, message-content") || r;
      return { texto: toText(md), acoes: extractActions(md) };
    }
    const st = pendente;
    if (st.aguardandoEnvio) {
      // A aba acabou de ficar visível: o envio que estava na fila normalmente sai sozinho agora.
      let t = Date.now();
      while (!st.sent() && Date.now() - t < 10000) await sleep(300);
      if (!st.sent()) {
        // Não saiu: um clique no botão de enviar, agora com a aba visível.
        const b = sendButton();
        if (b && !b.disabled && b.getAttribute("aria-disabled") !== "true") realClick(b);
        t = Date.now();
        while (!st.sent() && Date.now() - t < 8000) await sleep(300);
      }
      if (!st.sent()) { pendente = null; return notSentError(st); }
      st.aguardandoEnvio = false;
    }
    return waitAndRead(st);
  }

  browser.runtime.onMessage.addListener(msg => {
    if (!msg || msg.__gcBridge !== true) return undefined;
    switch (msg.cmd) {
      case "ping": return Promise.resolve({ ok: true });
      case "status": {
        const conta = account();
        return Promise.resolve({ ok: true, pronto: !!editor(), logado: !!conta || isLoggedIn(), conta, modelo: currentModel(),
          nivel: lastSelected && lastSelected.botao === buttonText() ? lastSelected.nivel || "" : "", url: location.href });
      }
      case "list_models": return listModels().catch(e => ({ erro: e.message || String(e) }));
      case "select_model": return selectModel(msg.args || {}).catch(e => ({ erro: e.message || String(e) }));
      case "ask": return ask(msg.args).catch(e => ({ erro: e.message || String(e) }));
      case "collect": return collect().catch(e => ({ erro: e.message || String(e) }));
      case "stop": stopRequested = true; stopButton()?.click(); return Promise.resolve({ ok: true });
      default: return Promise.resolve({ erro: "comando desconhecido" });
    }
  });
})();
