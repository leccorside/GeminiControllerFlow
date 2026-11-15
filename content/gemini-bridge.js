// Ponte com o gemini.google.com (roda na aba do Gemini, logada com a conta Google do usuário).
// Digita mensagens no chat, espera a resposta terminar e devolve o texto + as ações pedidas.
(() => {
  if (window.__geminiBridge) return;
  window.__geminiBridge = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const editor = () => document.querySelector("rich-textarea .ql-editor[contenteditable=true], rich-textarea [contenteditable=true]");
  const labelOf = b => (b.getAttribute("aria-label") || b.getAttribute("mattooltip") || "").toLowerCase();
  const buttons = () => [...document.querySelectorAll("button")];
  const sendButton = () => buttons().find(b => /^(enviar mensagem|send message)$/.test(labelOf(b))) ||
    document.querySelector("button.send-button");
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
        for (const a of list) if (a && typeof a.tool === "string") actions.push({ tool: a.tool, args: a.args || {} });
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
  // O Gemini web troca de modelo por um menu ("Rápido", "Raciocínio", "Pro"...). Os seletores abaixo são tolerantes
  // porque a interface muda com frequência: procuramos o botão do seletor e os itens do menu que ele abre.
  function modelButton() {
    const direct = document.querySelector(
      "bard-mode-switcher button, [data-test-id='bard-mode-menu-button'], button.input-area-switch, button[aria-haspopup][class*='mode']"
    );
    if (direct) return direct;
    return buttons().find(b => b.getAttribute("aria-haspopup") &&
      /(modelo|model|modo|mode)/i.test(labelOf(b) + " " + (b.closest("[class]")?.className || "")) &&
      b.closest("input-area-v2, input-container, .input-area, chat-window"));
  }

  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const menuItems = () => [...document.querySelectorAll(
    ".cdk-overlay-container [role=menuitem], .cdk-overlay-container [role=menuitemradio], .cdk-overlay-container [role=option], .cdk-overlay-container button.mat-mdc-menu-item"
  )].filter(el => el.getBoundingClientRect().height > 0);

  function closeMenu() {
    document.querySelector(".cdk-overlay-backdrop")?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  }

  async function openMenu() {
    const btn = modelButton();
    if (!btn) throw new Error("Não encontrei o seletor de modelo do Gemini (a interface pode ter mudado).");
    if (!menuItems().length) {
      btn.click();
      for (let i = 0; i < 20 && !menuItems().length; i++) await sleep(100);
    }
    const items = menuItems();
    if (!items.length) { closeMenu(); throw new Error("O menu de modelos do Gemini não abriu."); }
    return items;
  }

  function describeItem(el) {
    const titleEl = el.querySelector(".mode-title, [class*='title'], .mat-mdc-menu-item-text > :first-child");
    const lines = (el.innerText || el.textContent || "").split("\n").map(clean).filter(Boolean)
      .filter(l => !/^(check|check_circle|done|lock|arrow_drop_down)$/i.test(l));
    const nome = clean(titleEl?.innerText || titleEl?.textContent) || lines[0] || "";
    const descricao = lines.filter(l => l !== nome).join(" — ");
    const icons = [...el.querySelectorAll("mat-icon, .google-symbols")].map(i => clean(i.textContent));
    const selecionado = el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true" ||
      /selected|is-selected|active/.test(el.className) || icons.some(i => /^(check|check_circle|done)$/.test(i));
    const desabilitado = el.disabled || el.getAttribute("aria-disabled") === "true";
    return { nome, descricao, selecionado, desabilitado };
  }

  function currentModel() {
    const btn = modelButton();
    return btn ? clean(btn.innerText || btn.textContent).replace(/\b(arrow_drop_down|expand_more|keyboard_arrow_down)\b/g, "").trim() : null;
  }

  async function listModels() {
    const items = await openMenu();
    const modelos = items.map(describeItem).filter(m => m.nome);
    closeMenu();
    await sleep(150);
    return { atual: currentModel(), modelos };
  }

  async function selectModel({ nome }) {
    const alvo = clean(nome).toLowerCase();
    const items = await openMenu();
    const item = items.find(el => describeItem(el).nome.toLowerCase() === alvo) ||
      items.find(el => describeItem(el).nome.toLowerCase().includes(alvo));
    if (!item) { closeMenu(); throw new Error(`Modelo "${nome}" não encontrado no menu do Gemini.`); }
    if (describeItem(item).desabilitado) { closeMenu(); throw new Error(`O modelo "${nome}" não está disponível nesta conta.`); }
    item.click();
    await sleep(400);
    if (menuItems().length) closeMenu();
    return { ok: true, atual: currentModel() };
  }

  let stopRequested = false;

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

    const before = responses().length;
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

    let btn;
    for (let i = 0; i < 40; i++) {
      btn = sendButton();
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") break;
      await sleep(250);
    }
    if (!btn) return { erro: "Botão de enviar do Gemini não encontrado (a interface pode ter mudado)." };
    btn.click();

    // Espera aparecer a nova resposta.
    const start = Date.now();
    while (responses().length <= before) {
      if (stopRequested) return { erro: "Interrompido." };
      if (Date.now() - start > 60000) return { erro: "O Gemini não começou a responder em 60 s." };
      await sleep(400);
    }
    // Espera terminar: sem botão de parar e texto estável.
    let lastText = "", stableSince = Date.now();
    while (Date.now() - start < 300000) {
      if (stopRequested) { stopButton()?.click(); break; }
      await sleep(500);
      const r = responses().at(-1);
      const t = r?.textContent || "";
      if (t !== lastText) { lastText = t; stableSince = Date.now(); continue; }
      if (!stopButton() && Date.now() - stableSince > 1200 && t.trim()) break;
    }
    const r = responses().at(-1);
    const md = r.querySelector("message-content .markdown, message-content") || r;
    return { texto: toText(md), acoes: extractActions(md), imagem_anexada: imageAttached };
  }

  browser.runtime.onMessage.addListener(msg => {
    if (!msg || msg.__gcBridge !== true) return undefined;
    switch (msg.cmd) {
      case "ping": return Promise.resolve({ ok: true });
      case "status": {
        const conta = account();
        return Promise.resolve({ ok: true, pronto: !!editor(), logado: !!conta || isLoggedIn(), conta, modelo: currentModel(), url: location.href });
      }
      case "list_models": return listModels().catch(e => ({ erro: e.message || String(e) }));
      case "select_model": return selectModel(msg.args || {}).catch(e => ({ erro: e.message || String(e) }));
      case "ask": return ask(msg.args).catch(e => ({ erro: e.message || String(e) }));
      case "stop": stopRequested = true; stopButton()?.click(); return Promise.resolve({ ok: true });
      default: return Promise.resolve({ erro: "comando desconhecido" });
    }
  });
})();
