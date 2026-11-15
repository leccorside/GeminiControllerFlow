// Content script injetado sob demanda na aba alvo.
// Lê a página (lista de elementos interativos com referências numéricas) e executa ações.
(() => {
  if (window.__geminiControllerFlow) return;

  // Mensagens de erro no idioma escolhido na barra lateral (vem em cada mensagem).
  let LANG = "pt-BR";
  const MSG = {
    "pt-BR": {
      notFound: "Elemento [{ref}] não encontrado. A página pode ter mudado; chame get_page de novo.",
      noElAt: "Nenhum elemento na coordenada ({x}, {y}).", refOrXY: "Informe ref ou x/y.",
      fieldRef: "Informe o ref do campo.", notEditable: "O elemento não é um campo de texto editável.",
      notSelect: "O elemento não é um <select>. Para menus customizados, clique na opção.",
      noOption: "Opção \"{v}\" não encontrada.", unknown: "Comando desconhecido: {c}"
    },
    en: {
      notFound: "Element [{ref}] not found. The page may have changed; call get_page again.",
      noElAt: "No element at coordinate ({x}, {y}).", refOrXY: "Provide ref or x/y.",
      fieldRef: "Provide the field ref.", notEditable: "The element is not an editable text field.",
      notSelect: "The element is not a <select>. For custom menus, click the option.",
      noOption: "Option \"{v}\" not found.", unknown: "Unknown command: {c}"
    },
    es: {
      notFound: "Elemento [{ref}] no encontrado. La página puede haber cambiado; llama a get_page de nuevo.",
      noElAt: "Ningún elemento en la coordenada ({x}, {y}).", refOrXY: "Indica ref o x/y.",
      fieldRef: "Indica el ref del campo.", notEditable: "El elemento no es un campo de texto editable.",
      notSelect: "El elemento no es un <select>. Para menús personalizados, haz clic en la opción.",
      noOption: "Opción \"{v}\" no encontrada.", unknown: "Comando desconocido: {c}"
    }
  };
  const tr = (k, vars = {}) => ((MSG[LANG] || MSG["pt-BR"])[k] || k).replace(/\{(\w+)\}/g, (m, x) => (vars[x] != null ? vars[x] : m));

  const REF_ATTR = "data-gc-ref";
  const refs = new Map(); // ref -> Element
  let nextRef = 1;

  const INTERACTIVE_SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "textarea", "select", "summary", "label[for]",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=tab]", "[role=menuitem]",
    "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=option]", "[role=switch]", "[role=textbox]",
    "[role=combobox]", "[role=searchbox]", "[role=slider]", "[role=treeitem]", "[role=gridcell]",
    "[contenteditable='']", "[contenteditable=true]", "[onclick]", "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  const clean = (s, max = 100) => {
    if (!s) return "";
    s = String(s).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  };

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  }

  function inViewport(el, margin = 0) {
    const r = el.getBoundingClientRect();
    return r.bottom > -margin && r.top < innerHeight + margin && r.right > 0 && r.left < innerWidth;
  }

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "checkbox" || t === "radio") return t;
      return `input[${t}]`;
    }
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (el.isContentEditable) return "editable";
    return tag;
  }

  function nameOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const txt = labelledby.split(/\s+/).map(id => document.getElementById(id)?.innerText || "").join(" ");
      if (clean(txt)) return clean(txt);
    }
    if (el.id && (el.matches("input,textarea,select"))) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && clean(lab.innerText)) return clean(lab.innerText);
    }
    const alt = el.getAttribute("alt") || el.querySelector?.("img[alt]")?.getAttribute("alt");
    const text = el.matches("input,textarea,select") ? "" : el.innerText;
    return clean(text) || clean(alt) || clean(el.getAttribute("title")) ||
      clean(el.getAttribute("placeholder")) || clean(el.getAttribute("name")) ||
      (el.tagName === "INPUT" ? clean(el.value) : "");
  }

  // Identidade de cada referência (tipo, papel, nome): sites como o LinkedIn recriam elementos (ex.: o campo de
  // busca) entre a leitura e a ação; com ela achamos o equivalente na página nova.
  const refInfo = new Map();

  function refFor(el) {
    let ref = el.getAttribute(REF_ATTR);
    if (!ref || refs.get(Number(ref)) !== el) {
      ref = String(nextRef++);
      el.setAttribute(REF_ATTR, ref);
      refs.set(Number(ref), el);
    }
    refInfo.set(Number(ref), { tag: el.tagName, role: roleOf(el), name: nameOf(el),
      id: el.id || "", nameAttr: el.getAttribute("name") || "", placeholder: el.getAttribute("placeholder") || "" });
    return Number(ref);
  }

  function findEquivalent(info) {
    const cands = [...document.querySelectorAll(INTERACTIVE_SELECTOR)].filter(e => e.tagName === info.tag && isVisible(e));
    const score = e => (info.id && e.id === info.id ? 4 : 0) +
      (info.nameAttr && e.getAttribute("name") === info.nameAttr ? 2 : 0) +
      (info.placeholder && e.getAttribute("placeholder") === info.placeholder ? 2 : 0) +
      (roleOf(e) === info.role ? 1 : 0) + (info.name && nameOf(e) === info.name ? 3 : 0);
    let best = null, bestScore = 0;
    for (const e of cands) { const sc = score(e); if (sc > bestScore) { best = e; bestScore = sc; } }
    return bestScore >= 3 ? best : null; // exige nome, id ou name+papel batendo — evita agir no elemento errado
  }

  function getEl(ref) {
    const n = Number(ref);
    let el = refs.get(n);
    if (!el || !el.isConnected) {
      el = document.querySelector(`[${REF_ATTR}="${n}"]`);
      if (!el && refInfo.has(n)) {
        el = findEquivalent(refInfo.get(n));
        if (el) el.setAttribute(REF_ATTR, String(n));
      }
      if (el) refs.set(n, el);
    }
    if (!el) throw new Error(tr("notFound", { ref }));
    return el;
  }

  function describe(el) {
    const ref = refFor(el);
    const role = roleOf(el);
    const name = nameOf(el);
    const extra = [];
    if (el.matches("input,textarea") && el.type !== "password" && el.value) extra.push(`valor="${clean(el.value, 60)}"`);
    if (el.type === "password") extra.push("senha");
    if (el.matches("input[type=checkbox],input[type=radio]")) extra.push(el.checked ? "marcado" : "desmarcado");
    const ariaChecked = el.getAttribute("aria-checked");
    if (ariaChecked) extra.push(`aria-checked=${ariaChecked}`);
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) extra.push(`expandido=${expanded}`);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") extra.push("desabilitado");
    if (el.tagName === "SELECT") {
      const opts = [...el.options].slice(0, 15).map(o => clean(o.text, 30));
      extra.push(`opções=[${opts.join(" | ")}]`);
      extra.push(`selecionado="${clean(el.selectedOptions[0]?.text, 40)}"`);
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href") || "";
      if (href && !href.startsWith("javascript:")) extra.push(`href=${clean(href, 80)}`);
    }
    if (!inViewport(el)) extra.push("fora da tela");
    return `[${ref}] ${role} "${name}"${extra.length ? " " + extra.join(" ") : ""}`;
  }

  // Plataforma do site (usado para ativar habilidades, ex.: WordPress).
  function plataforma() {
    const wp = !!(document.querySelector("meta[name=generator][content*='WordPress' i]") ||
      document.querySelector("link[href*='/wp-content/'], script[src*='/wp-includes/'], script[src*='/wp-content/']") ||
      document.getElementById("wpadminbar") || document.body?.classList.contains("wp-admin") ||
      /\/wp-admin\//.test(location.pathname));
    return wp ? { wordpress: true, painel: /\/wp-admin\//.test(location.pathname) } : {};
  }

  function pageInfo() {
    return {
      url: location.href,
      titulo: document.title,
      plataforma: plataforma(),
      rolagem: { y: Math.round(scrollY), altura_total: document.documentElement.scrollHeight },
      viewport: { largura: innerWidth, altura: innerHeight }
    };
  }

  function getPage({ query = "", include_text = false, scope = "viewport", max_elements = 250 } = {}) {
    const all = [...document.querySelectorAll(INTERACTIVE_SELECTOR)].filter(isVisible);
    const q = clean(query).toLowerCase();
    let list = all;
    if (q) {
      list = all.filter(el => (nameOf(el) + " " + (el.getAttribute("href") || "") + " " + (el.getAttribute("placeholder") || "")).toLowerCase().includes(q));
    } else if (scope !== "all") {
      list = all.filter(el => inViewport(el, innerHeight * 0.5));
    }
    // Evita repetir filhos interativos com o mesmo nome do pai interativo.
    const set = new Set(list);
    list = list.filter(el => {
      let p = el.parentElement;
      while (p) {
        if (set.has(p) && nameOf(p) === nameOf(el)) return false;
        p = p.parentElement;
      }
      return true;
    });
    const total = list.length;
    list = list.slice(0, max_elements);
    const out = { ...pageInfo(), elementos: list.map(describe).join("\n") || "(nenhum elemento interativo encontrado)" };
    if (total > list.length) out.aviso = `Mostrando ${list.length} de ${total} elementos. Use query para filtrar ou role a página.`;
    if (include_text) {
      const t = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n");
      out.texto = t.length > 12000 ? t.slice(0, 12000) + "\n…(texto truncado)" : t;
    }
    if (q && !list.length) {
      // Procura no texto visível quando não há elemento interativo com esse nome.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (walker.nextNode() && hits.length < 10) {
        const node = walker.currentNode;
        if (node.textContent.toLowerCase().includes(q) && node.parentElement && isVisible(node.parentElement)) {
          hits.push(describe(node.parentElement));
        }
      }
      if (hits.length) out.textos_encontrados = hits.join("\n");
    }
    return out;
  }

  function highlight(el) {
    try {
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed", left: r.left - 3 + "px", top: r.top - 3 + "px",
        width: r.width + 6 + "px", height: r.height + 6 + "px",
        border: "2px solid #8b5cf6", borderRadius: "6px", background: "rgba(139,92,246,0.12)",
        zIndex: 2147483647, pointerEvents: "none", transition: "opacity 0.6s ease"
      });
      document.documentElement.appendChild(box);
      setTimeout(() => { box.style.opacity = "0"; }, 700);
      setTimeout(() => box.remove(), 1400);
    } catch (_) { /* sem destaque */ }
  }

  function prepare(el) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    highlight(el);
  }

  function mouse(el, type, x, y, extra = {}) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: type.endsWith("down") ? 1 : 0,
      pointerId: 1, pointerType: "mouse", isPrimary: true, ...extra
    }));
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  function click({ ref, x, y, double = false }) {
    let el;
    if (ref != null) {
      el = getEl(ref);
      prepare(el);
      [x, y] = center(el);
      // Se outro elemento cobre o centro (ex.: rótulo), clica nele mesmo — é o que um clique real faria.
      // Ícones SVG (comuns no LinkedIn) não têm .click(): nesse caso mantém o próprio elemento interativo.
      const top = document.elementFromPoint(x, y);
      if (top && el.contains(top) && top instanceof HTMLElement) el = top;
    } else if (x != null && y != null) {
      el = document.elementFromPoint(x, y);
      if (!el) throw new Error(tr("noElAt", { x, y }));
      // Clique por coordenada caindo num ícone SVG: sobe para o elemento HTML clicável que o contém.
      if (!(el instanceof HTMLElement)) el = el.closest(INTERACTIVE_SELECTOR) || el.closest("*:not(svg):not(path):not(use):not(g)") || el;
      highlight(el);
    } else {
      throw new Error(tr("refOrXY"));
    }
    const doClick = () => {
      if (typeof el.click === "function") el.click();
      else mouse(el, "click", x, y, { detail: 1 });
    };
    mouse(el, "pointerover", x, y); mouse(el, "mouseover", x, y);
    mouse(el, "pointerdown", x, y); mouse(el, "mousedown", x, y);
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    mouse(el, "pointerup", x, y); mouse(el, "mouseup", x, y);
    doClick();
    if (double) {
      doClick();
      mouse(el, "dblclick", x, y, { detail: 2 });
    }
    return { ok: true, clicou: describe(el.closest(INTERACTIVE_SELECTOR) || el) };
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype :
      el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
  }

  const KEY_CODES = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, " ": 32, Space: 32,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34
  };

  function key(target, keyName, mods = {}) {
    const k = keyName === "Space" ? " " : keyName;
    const code = KEY_CODES[keyName] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
    const init = {
      key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : keyName, keyCode: code, which: code,
      bubbles: true, cancelable: true, composed: true, ...mods
    };
    const down = target.dispatchEvent(new KeyboardEvent("keydown", init));
    if (k.length === 1 || k === "Enter") target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    return down; // false se a página cancelou o keydown
  }

  function submitFrom(el) {
    const notPrevented = key(el, "Enter");
    const form = el.form || el.closest?.("form");
    if (notPrevented && form && el.tagName === "INPUT") {
      if (typeof form.requestSubmit === "function") form.requestSubmit(); else form.submit();
    }
  }

  function typeText({ ref, text = "", clear = true, submit = false }) {
    const el = ref != null ? getEl(ref) : document.activeElement;
    if (!el || el === document.body) throw new Error(tr("fieldRef"));
    prepare(el);
    el.focus();
    if (el.matches("input,textarea")) {
      setNativeValue(el, clear ? text : el.value + text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // contenteditable (editores como Lexical/Draft/ProseMirror) — usa execCommand para o editor perceber.
      const editable = el.isContentEditable ? el : el.querySelector("[contenteditable=true],[contenteditable='']");
      if (!editable) throw new Error(tr("notEditable"));
      editable.focus();
      if (clear) {
        const sel = getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        sel.removeAllRanges(); sel.addRange(range);
      } else {
        const sel = getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel.removeAllRanges(); sel.addRange(range);
      }
      const ok = document.execCommand("insertText", false, text);
      if (!ok) {
        editable.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
        if (clear) editable.textContent = text; else editable.append(text);
        editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }
    if (submit) submitFrom(el);
    const val = el.matches("input,textarea") ? el.value : el.innerText;
    return { ok: true, campo: describe(el), conteudo_atual: el.type === "password" ? "(oculto)" : clean(val, 300) };
  }

  function selectOption({ ref, value }) {
    const el = getEl(ref);
    prepare(el);
    if (el.tagName !== "SELECT") throw new Error(tr("notSelect"));
    const v = String(value).toLowerCase();
    const opt = [...el.options].find(o => o.value.toLowerCase() === v) ||
      [...el.options].find(o => o.text.trim().toLowerCase() === v) ||
      [...el.options].find(o => o.text.toLowerCase().includes(v));
    if (!opt) throw new Error(tr("noOption", { v: value }));
    setNativeValue(el, opt.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, selecionado: opt.text.trim() };
  }

  function pressKey({ key: keyName, ref, ctrl = false, shift = false, alt = false, meta = false }) {
    const target = ref != null ? getEl(ref) : (document.activeElement || document.body);
    if (ref != null) { prepare(target); target.focus?.(); }
    const mods = { ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta };
    if (keyName === "Enter" && !ctrl && !shift && !alt && !meta) submitFrom(target);
    else key(target, keyName, mods);
    return { ok: true, alvo: target === document.body ? "body" : describe(target) };
  }

  function scrollable(el) {
    let p = el;
    while (p && p !== document.documentElement) {
      const st = getComputedStyle(p);
      if (/(auto|scroll)/.test(st.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
      p = p.parentElement;
    }
    return null;
  }

  function scroll({ direction = "down", amount, ref }) {
    if (ref != null && !direction) {
      prepare(getEl(ref));
      return { ok: true, ...pageInfo() };
    }
    const target = ref != null ? (scrollable(getEl(ref)) || window) : window;
    const page = target === window ? innerHeight : target.clientHeight;
    const px = amount == null || amount === "page" ? Math.round(page * 0.85) : Number(amount);
    const map = { down: [0, px], up: [0, -px], right: [px, 0], left: [-px, 0] };
    if (direction === "top") target.scrollTo({ top: 0, behavior: "instant" });
    else if (direction === "bottom") target.scrollTo({ top: 1e9, behavior: "instant" });
    else if (direction === "to_element") { prepare(getEl(ref)); }
    else {
      const [dx, dy] = map[direction] || map.down;
      target.scrollBy({ left: dx, top: dy, behavior: "instant" });
    }
    return { ok: true, ...pageInfo() };
  }

  function hover({ ref }) {
    const el = getEl(ref);
    prepare(el);
    const [x, y] = center(el);
    for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) mouse(el, t, x, y);
    return { ok: true, alvo: describe(el) };
  }

  function getText({ ref }) {
    const el = ref != null ? getEl(ref) : document.body;
    const t = (el.innerText || "").replace(/\n{3,}/g, "\n\n");
    return { ...pageInfo(), texto: t.length > 15000 ? t.slice(0, 15000) + "\n…(truncado)" : t };
  }

  // ---------- Contexto da página ----------
  // O content script não enxerga as variáveis da página (wp, jQuery…). Executamos código no contexto da página
  // pelo eval DA PÁGINA (window.wrappedJSObject.eval, no Firefox); o código devolve sempre uma string JSON.
  function pageEval(code) {
    const w = window.wrappedJSObject;
    const r = w && typeof w.eval === "function" ? w.eval(code) : window.eval(code);
    try { return typeof r === "string" ? JSON.parse(r) : r; } catch (_) { return r; }
  }
  // Para operações assíncronas da página: o código grava o resultado em window.__gcfJobs[id]; aqui esperamos.
  async function pageJob(body, timeoutMs = 60000) {
    const id = "j" + Date.now() + Math.random().toString(36).slice(2, 7);
    pageEval(`(function(){ window.__gcfJobs = window.__gcfJobs || {}; var __id = ${JSON.stringify(id)};
      window.__gcfJobs[__id] = null;
      Promise.resolve().then(function(){ return (async function(){ ${body} })(); })
        .then(function(v){ window.__gcfJobs[__id] = { ok: true, v: v === undefined ? null : v }; },
              function(e){ window.__gcfJobs[__id] = { ok: false, erro: String(e && (e.message || e.code) || e) }; });
      return "1"; })()`);
    const fim = Date.now() + timeoutMs;
    while (Date.now() < fim) {
      await new Promise(r => setTimeout(r, 250));
      const r = pageEval(`JSON.stringify((window.__gcfJobs || {})[${JSON.stringify(id)}] || null)`);
      if (r) {
        pageEval(`(function(){ delete window.__gcfJobs[${JSON.stringify(id)}]; return "1"; })()`);
        if (!r.ok) throw new Error(r.erro);
        return r.v;
      }
    }
    throw new Error("A operação na página não terminou a tempo.");
  }

  // ---------- Habilidade WordPress ----------
  // Usa a API do próprio editor (wp.data / wp.blocks), muito mais confiável que clicar no editor de blocos.
  const WP_INFO = `(function(){
    var r = { wordpress: !!window.wp || !!document.getElementById("wpadminbar") || document.body.classList.contains("wp-admin"), editor: null };
    var ed = window.wp && wp.data && wp.data.select && wp.data.select("core/editor");
    if (window.elementor || document.body.classList.contains("elementor-editor-active")) r.editor = "elementor";
    else if (window.ET_Builder || document.getElementById("et-fb-app") || document.body.classList.contains("et-fb")) r.editor = "divi";
    else if (window.vc || document.getElementById("wpb_visual_composer")) r.editor = "wpbakery";
    else if (ed && ed.getCurrentPostType && ed.getCurrentPostType()) r.editor = "gutenberg";
    else if (document.getElementById("post") && (document.getElementById("content") || window.tinymce)) r.editor = "classic";
    if (r.editor === "gutenberg") {
      r.tipo = ed.getCurrentPostType(); r.id = ed.getCurrentPostId();
      r.titulo = ed.getEditedPostAttribute("title"); r.slug = ed.getEditedPostAttribute("slug");
      r.status = ed.getEditedPostAttribute("status"); r.link = ed.getPermalink ? ed.getPermalink() : null;
      var be = wp.data.select("core/block-editor");
      r.blocos = (be.getBlocks() || []).map(function(b){ return b.name; }).slice(0, 80);
      r.blocosDisponiveis = (wp.blocks.getBlockTypes() || []).length;
      r.temCover = !!wp.blocks.getBlockType("core/cover"); r.temColunas = !!wp.blocks.getBlockType("core/columns");
    }
    if (document.querySelector("#elementor-switch-mode, #elementor-go-to-edit-page-link")) r.elementorDisponivel = true;
    r.seo = window.wpseoScriptData || document.getElementById("wpseo_meta") || (window.wp && wp.data && wp.data.select("yoast-seo/editor")) ? "yoast"
      : (window.rankMath || (window.wp && wp.data && wp.data.select("rank-math"))) ? "rankmath" : null;
    var tema = document.body.className.match(/theme-([\\w-]+)/) || [];
    r.temaClasse = tema[1] || null;
    r.adminUrl = (window.ajaxurl || "").replace(/admin-ajax\\.php.*$/, "") || null;
    return JSON.stringify(r); })()`;

  function wpEditor() {
    const r = pageEval(WP_INFO);
    if (r.editor !== "gutenberg" && r.editor !== "classic") {
      throw new Error(r.editor ? `Editor "${r.editor}" detectado: a ferramenta wordpress só edita Gutenberg/clássico. Pergunte ao usuário como prosseguir.`
        : "Não estou num editor do WordPress. Abra {site}/wp-admin/post-new.php?post_type=page (ou a tela de edição da página).");
    }
    return r.editor;
  }

  async function wordpress(a = {}) {
    const acao = a.acao || a.action;
    const S = v => JSON.stringify(v == null ? "" : String(v));
    switch (acao) {
      case "info": {
        const r = pageEval(WP_INFO);
        if (r.editor === "gutenberg") {
          try { r.tema = await pageJob(`var t = await wp.apiFetch({ path: "/wp/v2/themes?status=active" }); return t && t[0] ? (t[0].name && (t[0].name.rendered || t[0].name)) : null;`, 15000); }
          catch (_) { /* sem permissão para listar temas */ }
        }
        return { ok: true, ...r };
      }
      case "get_content": {
        const ed = wpEditor();
        const html = ed === "gutenberg"
          ? pageEval(`JSON.stringify(wp.data.select("core/editor").getEditedPostContent())`)
          : pageEval(`JSON.stringify(window.tinymce && tinymce.get("content") && !tinymce.get("content").isHidden() ? tinymce.get("content").getContent() : (document.getElementById("content") || {}).value || "")`);
        return { ok: true, editor: ed, conteudo: html.length > 30000 ? html.slice(0, 30000) + "\n…(truncado)" : html };
      }
      case "set_title": {
        const ed = wpEditor();
        if (ed === "gutenberg") pageEval(`(function(){ wp.data.dispatch("core/editor").editPost({ title: ${S(a.titulo)} }); return "1"; })()`);
        else pageEval(`(function(){ var t = document.getElementById("title"); t.value = ${S(a.titulo)}; t.dispatchEvent(new Event("input", { bubbles: true })); return "1"; })()`);
        return { ok: true, titulo: a.titulo };
      }
      case "set_slug": {
        if (wpEditor() !== "gutenberg") throw new Error("set_slug só no editor de blocos; no clássico use o campo Slug da tela.");
        pageEval(`(function(){ wp.data.dispatch("core/editor").editPost({ slug: ${S(a.slug)} }); return "1"; })()`);
        return { ok: true, slug: a.slug };
      }
      case "set_content": {
        const ed = wpEditor();
        const html = String(a.html || "");
        if (!html.trim()) throw new Error("Informe o html (marcação de blocos ou HTML).");
        if (ed === "classic") {
          const modo = a.modo === "acrescentar" ? "append" : "set";
          pageEval(`(function(){ var h = ${S(html)}; var mce = window.tinymce && tinymce.get("content");
            if (mce && !mce.isHidden()) { mce.setContent(${modo === "append" ? 'mce.getContent() + h' : 'h'}); mce.save(); }
            else { var c = document.getElementById("content"); c.value = ${modo === "append" ? 'c.value + h' : 'h'}; }
            return "1"; })()`);
          return { ok: true, editor: ed, modo: a.modo || "substituir" };
        }
        const r = pageEval(`(function(){ var h = ${S(html)};
          var blocks = /<!--\\s*wp:/.test(h) ? wp.blocks.parse(h) : wp.blocks.rawHandler({ HTML: h });
          blocks = (blocks || []).filter(function(b){ return !(b.name === "core/freeform" && !String((b.attributes||{}).content||"").trim()); });
          if (${JSON.stringify(a.modo === "acrescentar")}) wp.data.dispatch("core/block-editor").insertBlocks(blocks);
          else wp.data.dispatch("core/block-editor").resetBlocks(blocks);
          var invalid = []; (function walk(list){ list.forEach(function(b){ if (b.isValid === false) invalid.push(b.name); walk(b.innerBlocks || []); }); })(blocks);
          return JSON.stringify({ blocos: blocks.length, tipos: blocks.map(function(b){ return b.name; }).slice(0, 40), invalidos: invalid }); })()`);
        return { ok: true, editor: ed, modo: a.modo || "substituir", ...r,
          aviso: r.invalidos && r.invalidos.length ? "Alguns blocos ficaram inválidos (marcação diferente da esperada pelo bloco); confira com get_content." : undefined };
      }
      case "set_seo": {
        if (wpEditor() !== "gutenberg") throw new Error("set_seo só no editor de blocos.");
        const r = pageEval(`(function(){ var t = ${S(a.titulo_seo)}, d = ${S(a.descricao)}, feitos = [];
          try { var y = wp.data.dispatch("yoast-seo/editor"); if (y) {
            if (t && y.updateData) { y.updateData({ title: t }); feitos.push("yoast:titulo"); }
            if (d && y.updateData) { y.updateData({ description: d }); feitos.push("yoast:descricao"); } } } catch (e) {}
          try { var rm = wp.data.dispatch("rank-math"); if (rm) {
            if (t && rm.updateTitle) { rm.updateTitle(t); feitos.push("rankmath:titulo"); }
            if (d && rm.updateDescription) { rm.updateDescription(d); feitos.push("rankmath:descricao"); } } } catch (e) {}
          try { if (!feitos.length && (t || d)) { var m = {}; if (t) { m._yoast_wpseo_title = t; m.rank_math_title = t; } if (d) { m._yoast_wpseo_metadesc = d; m.rank_math_description = d; }
            wp.data.dispatch("core/editor").editPost({ meta: m }); feitos.push("meta"); } } catch (e) {}
          return JSON.stringify({ feitos: feitos }); })()`);
        return { ok: r.feitos.length > 0, ...r, aviso: r.feitos.length ? undefined : "Nenhum plugin de SEO respondeu; preencha pelos campos do plugin na tela, se existirem." };
      }
      case "upload_media": {
        if (!a.arquivo || !a.arquivo.data) throw new Error("Anexo não encontrado para enviar.");
        const f = a.arquivo;
        const r = await pageJob(`
          var bin = atob(${S(f.data)}); var bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var fd = new FormData(); fd.append("file", new Blob([bytes], { type: ${S(f.type)} }), ${S(f.name)});
          var m;
          if (window.wp && wp.apiFetch) m = await wp.apiFetch({ path: "/wp/v2/media", method: "POST", body: fd });
          else {
            var nonce = (window.wpApiSettings && wpApiSettings.nonce) || "";
            var root = (window.wpApiSettings && wpApiSettings.root) || (location.origin + "/wp-json/");
            var res = await fetch(root + "wp/v2/media", { method: "POST", body: fd, credentials: "same-origin", headers: nonce ? { "X-WP-Nonce": nonce } : {} });
            if (!res.ok) throw new Error("HTTP " + res.status + " ao enviar a mídia");
            m = await res.json();
          }
          var alt = ${S(a.alt)};
          if (alt && window.wp && wp.apiFetch) { try { await wp.apiFetch({ path: "/wp/v2/media/" + m.id, method: "POST", data: { alt_text: alt } }); } catch (e) {} }
          return { id: m.id, url: m.source_url, alt: alt };`, 120000);
        return { ok: true, ...r };
      }
      case "save": {
        const ed = wpEditor();
        if (ed === "classic") {
          pageEval(`(function(){ var b = document.getElementById("save-post"); if (!b) throw new Error("Botão Salvar rascunho não encontrado (a página pode já estar publicada)."); b.click(); return "1"; })()`);
          return { ok: true, editor: ed, aviso: "Rascunho salvo pelo botão do editor clássico; a página vai recarregar." };
        }
        const r = await pageJob(`
          var sel = wp.data.select("core/editor"), dis = wp.data.dispatch("core/editor");
          var st = sel.getEditedPostAttribute("status");
          if (st === "publish" || st === "future" || st === "private") throw new Error("Esta página já está publicada (" + st + "): salvar mexeria numa página existente. Peça autorização ao usuário.");
          if (st !== "draft") dis.editPost({ status: "draft" });
          await dis.savePost();
          for (var i = 0; i < 120 && sel.isSavingPost(); i++) await new Promise(function(r){ setTimeout(r, 250); });
          if (sel.didPostSaveRequestFail && sel.didPostSaveRequestFail()) throw new Error("O WordPress recusou o salvamento.");
          return { id: sel.getCurrentPostId(), status: sel.getEditedPostAttribute("status"),
            preview: sel.getEditedPostPreviewLink ? sel.getEditedPostPreviewLink() : null,
            editar: location.origin + location.pathname.replace(/post-new\\.php$/, "post.php") + "?post=" + sel.getCurrentPostId() + "&action=edit" };`, 60000);
        return { ok: true, editor: ed, ...r };
      }
      case "preview": {
        if (wpEditor() !== "gutenberg") throw new Error("preview só no editor de blocos; use o link de pré-visualização da tela.");
        const link = pageEval(`JSON.stringify(wp.data.select("core/editor").getEditedPostPreviewLink() || "")`);
        if (!link) throw new Error("Salve o rascunho antes (acao save) para ter a pré-visualização.");
        const res = await fetch(link, { credentials: "include" });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        // Só o conteúdo principal (sem cabeçalho/rodapé do tema), na ordem de preferência.
        const main = ["main", ".entry-content", "article", ".wp-site-blocks"].map(s => doc.querySelector(s)).find(Boolean) || doc.body;
        const texto = s => (s || "").replace(/\s+/g, " ").trim();
        const h1 = main.querySelectorAll("h1").length;
        return {
          ok: res.ok, link, http: res.status,
          avisoH1: h1 > 1 ? `${h1} títulos H1 na página: o tema já mostra o título da página como H1; use H2 no topo/hero (ou oculte o título) para ficar com um só.` : undefined,
          titulos: [...main.querySelectorAll("h1, h2, h3")].slice(0, 60).map(h => `${h.tagName}: ${texto(h.textContent).slice(0, 90)}`),
          imagens: [...main.querySelectorAll("img")].slice(0, 30).map(i => ({ src: (i.getAttribute("src") || "").slice(-80), alt: i.getAttribute("alt") || "" })),
          botoes: [...main.querySelectorAll(".wp-block-button a, a.wp-element-button")].slice(0, 30).map(b => `${texto(b.textContent)} → ${b.getAttribute("href")}`),
          revisar: (texto(main.textContent).match(/\[REVISAR\][^.\n]{0,60}/g) || []).slice(0, 30),
          colunas: main.querySelectorAll(".wp-block-columns").length,
          colunasEmpilhamNoCelular: main.querySelectorAll(".wp-block-columns:not(.is-not-stacked-on-mobile)").length
        };
      }
      default:
        throw new Error(`Ação desconhecida: ${acao}. Use info, get_content, set_title, set_slug, set_content, set_seo, upload_media, save ou preview.`);
    }
  }

  // ---------- Habilidade WordPress: Elementor ----------
  // Usa a API de comandos do próprio editor do Elementor ($e.run). Funciona no modo Containers (Elementor atual)
  // e no modo Seções/Colunas (antigo). A página é descrita em "secoes" (ver skills.js) e montada aqui.
  const EL_READY = `!!(window.elementor && window.$e && elementor.documents && elementor.documents.getCurrent && elementor.documents.getCurrent() && elementor.getPreviewContainer && elementor.getPreviewContainer())`;

  async function elementorReady() {
    for (let i = 0; i < 120; i++) {
      if (pageEval(`JSON.stringify(${EL_READY})`) === true) return;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error("O editor do Elementor não está aberto (ou não terminou de carregar). Abra {site}/wp-admin/post.php?post=ID&action=elementor.");
  }

  // Monta os modelos dos widgets a partir da descrição simples usada pelo agente.
  const EL_WIDGETS = `
    function px(n){ return { unit: "px", size: Number(n) }; }
    function alinha(a){ return ({ esquerda: "left", centro: "center", direita: "right", justificado: "justify" })[a] || a || undefined; }
    function limpa(o){ Object.keys(o).forEach(function(k){ if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k]; }); return o; }
    function widgetModel(w){
      var t = String(w.tipo || w.type || "").toLowerCase(), s;
      if (t === "titulo" || t === "heading") {
        s = limpa({ title: w.texto, header_size: w.nivel || "h2", align: alinha(w.alinhamento), title_color: w.cor });
        if (w.tamanho) { s.typography_typography = "custom"; s.typography_font_size = px(w.tamanho); }
        return { elType: "widget", widgetType: "heading", settings: s };
      }
      if (t === "texto" || t === "text") return { elType: "widget", widgetType: "text-editor", settings: limpa({ editor: w.html || ("<p>" + (w.texto || "") + "</p>"), align: alinha(w.alinhamento), text_color: w.cor }) };
      if (t === "imagem" || t === "image") return { elType: "widget", widgetType: "image", settings: limpa({ image: { id: w.id || "", url: w.url || "", alt: w.alt || "" }, image_size: w.tamanho || "large", align: alinha(w.alinhamento) }) };
      if (t === "botao" || t === "button") return { elType: "widget", widgetType: "button", settings: limpa({ text: w.texto, link: { url: w.link || "#", is_external: "", nofollow: "" }, align: alinha(w.alinhamento), background_color: w.cor_fundo, button_text_color: w.cor_texto, size: w.tamanho }) };
      if (t === "espaco" || t === "spacer") return { elType: "widget", widgetType: "spacer", settings: { space: px(w.altura || 40) } };
      if (t === "divisor" || t === "divider") return { elType: "widget", widgetType: "divider", settings: limpa({ color: w.cor }) };
      if (t === "lista" || t === "icon-list") return { elType: "widget", widgetType: "icon-list", settings: { icon_list: (w.itens || []).map(function(x, i){ return { _id: "gcf" + i + Math.random().toString(36).slice(2, 6), text: String(x), selected_icon: { value: w.icone || "fas fa-check", library: "fa-solid" } }; }) } };
      if (t === "video") return { elType: "widget", widgetType: "video", settings: { youtube_url: w.url || "" } };
      if (t === "html") return { elType: "widget", widgetType: "html", settings: { html: w.html || "" } };
      if (t === "widget" && w.widgetType) return { elType: "widget", widgetType: w.widgetType, settings: w.settings || {} };
      return null;
    }`;

  async function elementorTool(a = {}) {
    const acao = a.acao || a.action;
    const S = v => JSON.stringify(v == null ? "" : String(v));
    if (acao !== "info") await elementorReady();
    switch (acao) {
      case "info": {
        const pronto = pageEval(`JSON.stringify(${EL_READY})`) === true;
        if (!pronto) return { ok: true, editorAberto: false, aviso: "Editor do Elementor não está aberto nesta aba." };
        return { ok: true, editorAberto: true, ...pageEval(`(function(){ var d = elementor.documents.getCurrent(); var c = d.config || {};
          var exp = (window.elementorCommon && elementorCommon.config && elementorCommon.config.experimentalFeatures) || {};
          var root = elementor.getPreviewContainer();
          var tipos = Object.keys((elementor.widgetsCache) || (elementor.config && elementor.config.widgets) || {});
          return JSON.stringify({ versao: (elementor.config && elementor.config.version) || (window.ElementorConfig && ElementorConfig.version) || null,
            modo: exp.container ? "containers" : "secoes",
            id: c.id, titulo: d.container && d.container.settings && d.container.settings.get("post_title"),
            status: c.status && c.status.value, tipo: c.type,
            elementosNoTopo: (root.children || []).length,
            widgetsDisponiveis: tipos.length,
            pro: !!window.elementorPro,
            preview: c.urls && (c.urls.wp_preview || c.urls.permalink) });
        })()`) };
      }
      case "get_structure": {
        return { ok: true, estrutura: pageEval(`(function(){
          function txt(s){ var v = s && (s.get("title") || s.get("editor") || s.get("text") || ""); return String(v || "").replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim().slice(0, 80); }
          function walk(c, d){ return (c.children || []).map(function(x){ var m = x.model; var o = { tipo: m.get("elType") === "widget" ? m.get("widgetType") : m.get("elType") };
            var t = txt(x.settings); if (t) o.texto = t; if (x.children && x.children.length && d < 4) o.filhos = walk(x, d + 1); return o; }); }
          return JSON.stringify(walk(elementor.getPreviewContainer(), 0)); })()`) };
      }
      case "set_title": {
        // ocultar_titulo: esconde o título que o tema mostra como H1 (evita dois H1 quando o topo já tem um).
        const settings = {};
        if (a.titulo) settings.post_title = String(a.titulo);
        if (a.ocultar_titulo != null) settings.hide_title = a.ocultar_titulo ? "yes" : "";
        pageEval(`(function(){ $e.run("document/elements/settings", { container: elementor.documents.getCurrent().container, settings: ${JSON.stringify(settings)}, options: { external: true } }); return "1"; })()`);
        return { ok: true, titulo: a.titulo, ocultar_titulo: !!a.ocultar_titulo };
      }
      case "build": {
        let secoes = a.secoes;
        if (!secoes && a.secoes_json) { try { secoes = JSON.parse(a.secoes_json); } catch (e) { throw new Error("secoes_json não é um JSON válido: " + e.message); } }
        if (!Array.isArray(secoes) || !secoes.length) throw new Error("Informe secoes (lista de seções) ou secoes_json.");
        const r = pageEval(`(function(){ ${EL_WIDGETS}
          var secoes = ${JSON.stringify(secoes)}, acrescentar = ${JSON.stringify(a.modo === "acrescentar")};
          var exp = (window.elementorCommon && elementorCommon.config && elementorCommon.config.experimentalFeatures) || {};
          var containers = !!exp.container;
          var root = elementor.getPreviewContainer();
          if (!acrescentar) $e.run("document/elements/empty", { force: true });
          var feito = { modo: containers ? "containers" : "secoes", secoes: 0, widgets: 0, ignorados: [] };
          secoes.forEach(function(sec){
            var cols = sec.colunas && sec.colunas.length ? sec.colunas : [sec.widgets || []];
            var st = {};
            if (sec.fundo) { st.background_background = "classic"; st.background_color = sec.fundo; }
            if (sec.imagem_fundo) { st.background_background = "classic"; st.background_image = { id: sec.imagem_fundo.id || "", url: sec.imagem_fundo.url || sec.imagem_fundo }; st.background_size = "cover"; st.background_position = "center center"; }
            if (sec.padding != null) st.padding = { unit: "px", top: String(sec.padding), right: "20", bottom: String(sec.padding), left: "20", isLinked: false };
            if (sec.altura_minima) st.min_height = { unit: "px", size: Number(sec.altura_minima) };
            var alvos = [];
            if (containers) {
              st.content_width = sec.largura === "total" ? "full" : "boxed";
              st.flex_direction = cols.length > 1 ? "row" : "column";
              st.flex_direction_mobile = "column";
              if (sec.alinhamento_vertical === "centro") st.flex_justify_content = "center";
              var box = $e.run("document/elements/create", { container: root, model: { elType: "container", settings: st }, options: { edit: false } });
              if (cols.length > 1) cols.forEach(function(){
                alvos.push($e.run("document/elements/create", { container: box, model: { elType: "container", isInner: true,
                  settings: { content_width: "full", flex_direction: "column", width: { unit: "%", size: Math.floor(100 / cols.length) - 1 }, width_mobile: { unit: "%", size: 100 } } }, options: { edit: false } }));
              });
              else alvos.push(box);
            } else {
              var secao = $e.run("document/elements/create", { container: root, model: { elType: "section", settings: st }, columns: cols.length, options: { edit: false } });
              alvos = (secao.children || []).slice();
              while (alvos.length < cols.length) alvos.push($e.run("document/elements/create", { container: secao, model: { elType: "column" }, options: { edit: false } }));
            }
            cols.forEach(function(lista, i){ (lista || []).forEach(function(w){
              var m = widgetModel(w); if (!m) { feito.ignorados.push(w.tipo || w.type || "?"); return; }
              $e.run("document/elements/create", { container: alvos[i], model: m, options: { edit: false } }); feito.widgets++;
            }); });
            feito.secoes++;
          });
          feito.elementosNoTopo = (root.children || []).length;
          return JSON.stringify(feito); })()`);
        return { ok: true, ...r, aviso: r.ignorados && r.ignorados.length ? "Widgets com tipo desconhecido foram ignorados: " + r.ignorados.join(", ") : undefined };
      }
      case "save": {
        const r = await pageJob(`
          var d = elementor.documents.getCurrent(), st = d.config && d.config.status && d.config.status.value;
          if (st === "publish" || st === "future" || st === "private") throw new Error("Esta página já está publicada (" + st + "): salvar mexeria numa página existente. Peça autorização ao usuário.");
          await $e.run("document/save/draft");
          var c = d.config || {};
          return { id: c.id, status: (c.status && c.status.value) || "draft", preview: c.urls && (c.urls.wp_preview || c.urls.permalink),
            editar: location.href };`, 90000);
        return { ok: true, editor: "elementor", ...r };
      }
      case "preview": {
        const link = pageEval(`JSON.stringify((function(){ var c = elementor.documents.getCurrent().config || {}; return (c.urls && (c.urls.wp_preview || c.urls.permalink)) || ""; })())`);
        if (!link) throw new Error("Salve o rascunho antes (acao save) para ter a pré-visualização.");
        return analisarPreview(link, ["[data-elementor-type=wp-page]", "[data-elementor-type]", "main", ".entry-content", "article"]);
      }
      default:
        throw new Error(`Ação desconhecida: ${acao}. Use info, get_structure, set_title, build, save ou preview.`);
    }
  }

  // Lê a pré-visualização (sem abrir aba) e resume a estrutura do conteúdo principal.
  async function analisarPreview(link, seletores) {
    const res = await fetch(link, { credentials: "include" });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const main = seletores.map(s => doc.querySelector(s)).find(Boolean) || doc.body;
    const texto = s => (s || "").replace(/\s+/g, " ").trim();
    const h1 = doc.querySelectorAll("h1").length;
    return {
      ok: res.ok, link, http: res.status,
      avisoH1: h1 > 1 ? `${h1} títulos H1 na página: o tema já mostra o título da página como H1; use H2 no topo/hero (ou oculte o título) para ficar com um só.` : undefined,
      titulos: [...main.querySelectorAll("h1, h2, h3")].slice(0, 60).map(h => `${h.tagName}: ${texto(h.textContent).slice(0, 90)}`),
      imagens: [...main.querySelectorAll("img")].slice(0, 30).map(i => ({ src: (i.getAttribute("src") || "").slice(-80), alt: i.getAttribute("alt") || "" })),
      botoes: [...main.querySelectorAll(".wp-block-button a, a.wp-element-button, a.elementor-button")].slice(0, 30).map(b => `${texto(b.textContent)} → ${b.getAttribute("href")}`),
      revisar: (texto(main.textContent).match(/\[REVISAR\][^.\n]{0,60}/g) || []).slice(0, 30),
      colunas: main.querySelectorAll(".wp-block-columns > .wp-block-column, .e-con > .e-con, .e-con-inner > .e-con, .elementor-column").length
    };
  }

  const handlers = {
    ping: () => ({ ok: true }),
    page_info: pageInfo,
    get_page: getPage,
    click, type_text: typeText, select_option: selectOption, press_key: pressKey,
    scroll, hover, get_text: getText,
    wordpress,
    elementor: elementorTool
  };

  window.__geminiControllerFlow = true;
  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.__gc !== true) return undefined;
    if (msg.lang) LANG = msg.lang;
    const fn = handlers[msg.cmd];
    if (!fn) return Promise.resolve({ erro: tr("unknown", { c: msg.cmd }) });
    // Erros (inclusive de funções assíncronas) voltam como { erro } — nunca como promise rejeitada, que faria a
    // barra lateral reinjetar o script e REPETIR a ação (ex.: enviar a mesma mídia duas vezes).
    return Promise.resolve().then(() => fn(msg.args || {})).catch(e => ({ erro: e.message || String(e) }));
  });
})();
