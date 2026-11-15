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
        return Promise.resolve({ ok: true, pronto: !!editor(), logado: !!conta || isLoggedIn(), conta, modelo: currentModel(),
          nivel: lastSelected && lastSelected.botao === buttonText() ? lastSelected.nivel || "" : "", url: location.href });
      }
      case "list_models": return listModels().catch(e => ({ erro: e.message || String(e) }));
      case "select_model": return selectModel(msg.args || {}).catch(e => ({ erro: e.message || String(e) }));
      case "ask": return ask(msg.args).catch(e => ({ erro: e.message || String(e) }));
      case "stop": stopRequested = true; stopButton()?.click(); return Promise.resolve({ ok: true });
      default: return Promise.resolve({ erro: "comando desconhecido" });
    }
  });
})();
