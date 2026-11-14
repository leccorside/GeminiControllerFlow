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
  const tr = (k, vars = {}) => ((MSG[LANG] || MSG["pt-BR"])[k] || k).replace(/{(w+)}/g, (m, x) => (vars[x] != null ? vars[x] : m));

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

  function refFor(el) {
    let ref = el.getAttribute(REF_ATTR);
    if (!ref || refs.get(Number(ref)) !== el) {
      ref = String(nextRef++);
      el.setAttribute(REF_ATTR, ref);
      refs.set(Number(ref), el);
    }
    return Number(ref);
  }

  function getEl(ref) {
    const n = Number(ref);
    let el = refs.get(n);
    if (!el || !el.isConnected) {
      el = document.querySelector(`[${REF_ATTR}="${n}"]`);
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

  function pageInfo() {
    return {
      url: location.href,
      titulo: document.title,
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
      const top = document.elementFromPoint(x, y);
      if (top && (el.contains(top))) el = top;
    } else if (x != null && y != null) {
      el = document.elementFromPoint(x, y);
      if (!el) throw new Error(tr("noElAt", { x, y }));
      highlight(el);
    } else {
      throw new Error(tr("refOrXY"));
    }
    mouse(el, "pointerover", x, y); mouse(el, "mouseover", x, y);
    mouse(el, "pointerdown", x, y); mouse(el, "mousedown", x, y);
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    mouse(el, "pointerup", x, y); mouse(el, "mouseup", x, y);
    el.click();
    if (double) {
      el.click();
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

  const handlers = {
    ping: () => ({ ok: true }),
    page_info: pageInfo,
    get_page: getPage,
    click, type_text: typeText, select_option: selectOption, press_key: pressKey,
    scroll, hover, get_text: getText
  };

  window.__geminiControllerFlow = true;
  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.__gc !== true) return undefined;
    if (msg.lang) LANG = msg.lang;
    const fn = handlers[msg.cmd];
    if (!fn) return Promise.resolve({ erro: tr("unknown", { c: msg.cmd }) });
    try {
      return Promise.resolve(fn(msg.args || {}));
    } catch (e) {
      return Promise.resolve({ erro: e.message || String(e) });
    }
  });
})();
