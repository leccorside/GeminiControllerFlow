// Declaração das ferramentas expostas ao Gemini e o executor de cada uma.
const S = "STRING", N = "NUMBER", I = "INTEGER", B = "BOOLEAN", O = "OBJECT";

const TOOL_DECLARATIONS = [
  {
    name: "get_page",
    description: "Lê a aba atual: URL, título, rolagem e a lista de elementos interativos visíveis, cada um com uma referência [n] para usar nas outras ferramentas. Use sempre antes de agir e depois de ações que mudam a página.",
    parameters: {
      type: O,
      properties: {
        query: { type: S, description: "Filtra elementos cujo nome/href contém este texto (busca na página inteira, não só na parte visível)." },
        include_text: { type: B, description: "Inclui o texto visível da página (até 12 mil caracteres). Use para ler conteúdo." },
        scope: { type: S, enum: ["viewport", "all"], description: "viewport (padrão): elementos na tela e meia tela abaixo; all: página inteira." }
      }
    }
  },
  {
    name: "get_text",
    description: "Lê o texto de um elemento específico (ou da página inteira se ref não for informado).",
    parameters: { type: O, properties: { ref: { type: I, description: "Referência [n] do elemento." } } }
  },
  {
    name: "screenshot",
    description: "Captura a área visível da aba. A imagem tem as mesmas dimensões do viewport em pixels CSS, então as coordenadas servem direto para click com x/y. Use quando a lista de elementos não bastar (imagens, canvas, layout).",
    parameters: { type: O, properties: {} }
  },
  {
    name: "click",
    description: "Clica em um elemento pela referência [n] ou em uma coordenada (x, y) do viewport.",
    parameters: {
      type: O,
      properties: {
        ref: { type: I, description: "Referência [n] do elemento." },
        x: { type: N, description: "Coordenada X no viewport (se não usar ref)." },
        y: { type: N, description: "Coordenada Y no viewport (se não usar ref)." },
        double: { type: B, description: "Clique duplo." }
      }
    }
  },
  {
    name: "type_text",
    description: "Digita texto em um campo (input, textarea ou editor contenteditable).",
    parameters: {
      type: O,
      properties: {
        ref: { type: I, description: "Referência [n] do campo." },
        text: { type: S, description: "Texto a digitar." },
        clear: { type: B, description: "Apaga o conteúdo atual antes (padrão true)." },
        submit: { type: B, description: "Pressiona Enter / envia o formulário depois de digitar." }
      },
      required: ["ref", "text"]
    }
  },
  {
    name: "select_option",
    description: "Escolhe uma opção em um <select> nativo pelo valor ou texto.",
    parameters: {
      type: O,
      properties: { ref: { type: I }, value: { type: S, description: "Valor ou texto da opção." } },
      required: ["ref", "value"]
    }
  },
  {
    name: "press_key",
    description: "Pressiona uma tecla (Enter, Escape, Tab, ArrowDown, Backspace, letras...) no elemento informado ou no elemento com foco.",
    parameters: {
      type: O,
      properties: {
        key: { type: S, description: "Nome da tecla, ex.: Enter, Escape, Tab, ArrowDown, a." },
        ref: { type: I, description: "Elemento alvo (opcional)." },
        ctrl: { type: B }, shift: { type: B }, alt: { type: B }, meta: { type: B }
      },
      required: ["key"]
    }
  },
  {
    name: "scroll",
    description: "Rola a página (ou o contêiner rolável do elemento ref).",
    parameters: {
      type: O,
      properties: {
        direction: { type: S, enum: ["down", "up", "left", "right", "top", "bottom", "to_element"], description: "to_element rola até o elemento ref." },
        amount: { type: N, description: "Pixels; omita para rolar ~1 tela." },
        ref: { type: I }
      }
    }
  },
  {
    name: "hover",
    description: "Passa o mouse sobre um elemento (abre menus e tooltips).",
    parameters: { type: O, properties: { ref: { type: I } }, required: ["ref"] }
  },
  {
    name: "navigate",
    description: "Navega a aba atual para uma URL, ou volta/avança/recarrega.",
    parameters: {
      type: O,
      properties: { url: { type: S, description: "URL completa, ou 'back', 'forward', 'reload'." } },
      required: ["url"]
    }
  },
  {
    name: "wait",
    description: "Espera alguns segundos (carregamento, animações).",
    parameters: { type: O, properties: { seconds: { type: N, description: "1 a 15." } }, required: ["seconds"] }
  },
  {
    name: "list_tabs",
    description: "Lista as abas abertas na janela.",
    parameters: { type: O, properties: {} }
  },
  {
    name: "switch_tab",
    description: "Passa a trabalhar em outra aba (e a ativa).",
    parameters: { type: O, properties: { tab_id: { type: I } }, required: ["tab_id"] }
  },
  {
    name: "open_tab",
    description: "Abre uma nova aba com a URL e passa a trabalhar nela.",
    parameters: { type: O, properties: { url: { type: S } }, required: ["url"] }
  },
  {
    name: "run_javascript",
    description: "Executa JavaScript na página. O código é o corpo de uma função assíncrona: use 'return' para devolver um valor serializável (uma expressão única sem return também é devolvida). Use para extrair dados ou para ações que as outras ferramentas não cobrem. Com page_context=true o código roda no contexto da PÁGINA (acessa variáveis do site como wp, jQuery) e deve ser síncrono.",
    parameters: {
      type: O,
      properties: {
        code: { type: S },
        page_context: { type: B, description: "true para acessar variáveis da página (wp, jQuery…). Código síncrono." }
      },
      required: ["code"]
    }
  },
  {
    name: "wordpress",
    description: "Habilidade WordPress: cria e edita páginas/posts pelo editor do próprio WordPress (Gutenberg ou clássico), sem precisar clicar no editor. NUNCA publica: salva só como rascunho.",
    parameters: {
      type: O,
      properties: {
        acao: { type: S, enum: ["info", "get_content", "set_title", "set_slug", "set_content", "set_seo", "upload_media", "save", "preview"],
          description: "info: editor, post e blocos; get_content; set_title; set_slug; set_content (html em blocos <!-- wp:... --> ou HTML); set_seo; upload_media (envia um anexo do usuário à Biblioteca de Mídia); save (rascunho); preview (lê a pré-visualização sem abrir aba)." },
        titulo: { type: S, description: "set_title" },
        slug: { type: S, description: "set_slug" },
        html: { type: S, description: "set_content: marcação de blocos do Gutenberg (preferida) ou HTML." },
        modo: { type: S, enum: ["substituir", "acrescentar"], description: "set_content: substituir (padrão) ou acrescentar no fim." },
        titulo_seo: { type: S, description: "set_seo" },
        descricao: { type: S, description: "set_seo: meta descrição" },
        anexo: { type: S, description: "upload_media: nome do arquivo anexado pelo usuário (ou o número dele na lista, começando em 1)." },
        alt: { type: S, description: "upload_media: texto alternativo da imagem." }
      },
      required: ["acao"]
    }
  }
];

// Ferramentas que alteram algo e podem pedir confirmação.
const ACTION_TOOLS = new Set(["click", "type_text", "select_option", "press_key", "navigate", "open_tab", "run_javascript", "wordpress"]);
// Ações da ferramenta wordpress que só leem (não pedem confirmação).
const WP_READ_ONLY = new Set(["info", "get_content", "preview"]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

class ToolRunner {
  constructor(windowId) {
    this.windowId = windowId;
    this.tabId = null;
  }

  async syncActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, windowId: this.windowId });
    this.tabId = tab ? tab.id : null;
    return tab;
  }

  async waitLoad(timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    await sleep(300);
    while (Date.now() < end) {
      const tab = await browser.tabs.get(this.tabId);
      if (tab.status === "complete") break;
      await sleep(250);
    }
    await sleep(400);
  }

  async content(cmd, args = {}) {
    if (this.tabId == null) throw new Error(t("eNoTarget"));
    const send = () => browser.tabs.sendMessage(this.tabId, { __gc: true, cmd, args, lang: LANG });
    let res;
    try {
      res = await send();
      if (res === undefined) throw new Error("sem resposta");
    } catch (_) {
      try {
        await browser.tabs.executeScript(this.tabId, { file: "/content/agent.js", runAt: "document_idle" });
      } catch (e) {
        throw new Error(t("eNoAccess", { erro: e.message }));
      }
      res = await send();
    }
    if (res && res.erro) throw new Error(res.erro);
    return res;
  }

  // Descrição curta exibida na interface.
  static label(name, a = {}) {
    switch (name) {
      case "get_page": return a.query ? t("lGetPageQuery", { q: a.query }) : t(a.include_text ? "lGetPageText" : "lGetPage");
      case "get_text": return a.ref != null ? t("lGetTextRef", { ref: a.ref }) : t("lGetText");
      case "screenshot": return t("lScreenshot");
      case "click": return a.ref != null ? t("lClickRef", { ref: a.ref }) : t("lClickXY", { x: a.x, y: a.y });
      case "type_text": return t(a.submit ? "lTypeSubmit" : "lType", { texto: (a.text || "").slice(0, 60), ref: a.ref });
      case "select_option": return t("lSelect", { valor: a.value, ref: a.ref });
      case "press_key": return t("lKey", { tecla: [a.ctrl && "Ctrl", a.shift && "Shift", a.alt && "Alt", a.key].filter(Boolean).join("+") });
      case "scroll": return t("lScroll", { dir: a.direction || "down" });
      case "hover": return t("lHover", { ref: a.ref });
      case "navigate": return t("lNavigate", { url: a.url });
      case "wait": return t("lWait", { s: a.seconds });
      case "list_tabs": return t("lListTabs");
      case "switch_tab": return t("lSwitchTab", { id: a.tab_id });
      case "open_tab": return t("lOpenTab", { url: a.url });
      case "run_javascript": return t("lJs");
      case "wordpress": return t("lWp_" + (a.acao || "info"), { titulo: a.titulo, slug: a.slug, anexo: a.anexo });
      default: return name;
    }
  }

  // Retorna { response: objeto JSON, image?: {mimeType, data} }
  async run(name, a = {}) {
    switch (name) {
      case "get_page":
      case "get_text":
      case "scroll":
      case "hover":
      case "select_option":
        return { response: await this.content(name, a) };

      case "click":
      case "type_text":
      case "press_key": {
        const before = (await browser.tabs.get(this.tabId)).url;
        const r = await this.content(name, a);
        await sleep(500);
        const tab = await browser.tabs.get(this.tabId);
        if (tab.status === "loading" || tab.url !== before) await this.waitLoad();
        const after = await browser.tabs.get(this.tabId);
        if (after.url !== before) r.navegou_para = after.url;
        return { response: r };
      }

      case "screenshot": {
        const tab = await browser.tabs.get(this.tabId);
        if (!tab.active) { await browser.tabs.update(this.tabId, { active: true }); await sleep(300); }
        let vp = null;
        try { vp = (await this.content("page_info")).viewport; } catch (_) { /* página sem acesso */ }
        const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
        const img = await scaleImage(dataUrl, vp ? vp.largura : null);
        return {
          response: { ok: true, largura: img.width, altura: img.height, nota: "Imagem anexada em seguida. Coordenadas em pixels CSS do viewport." },
          image: { mimeType: "image/jpeg", data: img.base64 }
        };
      }

      case "navigate": {
        const u = String(a.url || "").trim();
        if (u === "back") await browser.tabs.goBack(this.tabId);
        else if (u === "forward") await browser.tabs.goForward(this.tabId);
        else if (u === "reload") await browser.tabs.reload(this.tabId);
        else await browser.tabs.update(this.tabId, { url: normalizeUrl(u) });
        await this.waitLoad();
        const tab = await browser.tabs.get(this.tabId);
        return { response: { ok: true, url: tab.url, titulo: tab.title } };
      }

      case "wait": {
        const s = Math.min(Math.max(Number(a.seconds) || 1, 0.2), 15);
        await sleep(s * 1000);
        return { response: { ok: true } };
      }

      case "list_tabs": {
        const tabs = await browser.tabs.query({ windowId: this.windowId });
        return {
          response: {
            aba_atual: this.tabId,
            abas: tabs.map(t => ({ tab_id: t.id, titulo: t.title, url: t.url, ativa: t.active }))
          }
        };
      }

      case "switch_tab": {
        const tab = await browser.tabs.update(Number(a.tab_id), { active: true });
        this.tabId = tab.id;
        return { response: { ok: true, url: tab.url, titulo: tab.title } };
      }

      case "open_tab": {
        const tab = await browser.tabs.create({ url: normalizeUrl(a.url), active: true, windowId: this.windowId });
        this.tabId = tab.id;
        await this.waitLoad();
        const t = await browser.tabs.get(this.tabId);
        return { response: { ok: true, tab_id: t.id, url: t.url, titulo: t.title } };
      }

      case "wordpress": {
        const args = { ...a };
        if (args.acao === "upload_media") {
          // Resolve o anexo pelo nome (ou número) entre os anexos do pedido atual.
          const lista = this.anexos || [];
          const chave = String(args.anexo || "").trim().toLowerCase();
          const idx = /^\d+$/.test(chave) ? Number(chave) - 1 : -1;
          const f = idx >= 0 ? lista[idx] : lista.find(x => x.name.toLowerCase() === chave) || lista.find(x => x.name.toLowerCase().includes(chave));
          if (!f) throw new Error(t("eNoAttachment", { nome: args.anexo || "?", lista: lista.map(x => x.name).join(", ") || "-" }));
          args.arquivo = { name: f.name, type: f.type, data: f.data };
        }
        const r = await this.content("wordpress", args);
        return { response: r };
      }

      case "run_javascript": {
        if (a.page_context) {
          // Contexto da página: eval da página (Firefox: window.wrappedJSObject.eval). Código síncrono.
          let body = String(a.code || "").trim();
          const single = !/\breturn\b/.test(body) && !body.includes("\n") && !/;\s*\S/.test(body) &&
            !/^(const|let|var|if|for|while|try|function|class)\b/.test(body);
          if (single) body = `return (${body.replace(/;\s*$/, "")});`;
          const src = `(function(){ try { var __v = (function(){\n${body}\n})(); return JSON.stringify({ ok: true, v: __v === undefined ? null : __v }); }
            catch (e) { return JSON.stringify({ ok: false, erro: String(e && e.message || e) }); } })()`;
          const pageCode = `(() => { const w = window.wrappedJSObject; const r = JSON.parse(w ? w.eval(${JSON.stringify(src)}) : eval(${JSON.stringify(src)}));
            return r.ok ? r.v : { erro: r.erro }; })()`;
          const [result] = await browser.tabs.executeScript(this.tabId, { code: pageCode });
          if (result && result.erro) throw new Error(result.erro);
          let out = result;
          const s = typeof out === "string" ? out : JSON.stringify(out);
          if (s && s.length > 15000) out = s.slice(0, 15000) + "…(truncado)";
          return { response: { ok: true, resultado: out } };
        }
        const code = `(async () => { return (${wrapAsExpression(a.code)}); })().then(v => {
          try { return typeof v === "string" ? v : JSON.parse(JSON.stringify(v === undefined ? null : v)); }
          catch (e) { return String(v); }
        }, e => ({ erro: String(e && e.message || e) }))`;
        const [result] = await browser.tabs.executeScript(this.tabId, { code });
        if (result && result.erro) throw new Error(result.erro);
        let out = result;
        const s = typeof out === "string" ? out : JSON.stringify(out);
        if (s && s.length > 15000) out = s.slice(0, 15000) + "…(truncado)";
        return { response: { ok: true, resultado: out } };
      }

      default:
        throw new Error(t("eUnknownTool", { nome: name }));
    }
  }
}

// O código é o corpo de uma função assíncrona. Uma expressão única sem "return" vira retorno.
function wrapAsExpression(code) {
  let c = String(code || "").trim();
  const single = !/\breturn\b/.test(c) && !c.includes("\n") && !/;\s*\S/.test(c) &&
    !/^(const|let|var|if|for|while|try|function|class)\b/.test(c);
  if (single) c = `return (${c.replace(/;\s*$/, "")});`;
  return `await (async () => {\n${c}\n})()`;
}

function normalizeUrl(u) {
  u = String(u || "").trim();
  if (!u) throw new Error(t("eEmptyUrl"));
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(u)) return "https://" + u;
  return "https://www.google.com/search?q=" + encodeURIComponent(u);
}

async function scaleImage(dataUrl, targetWidth) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  let w = img.naturalWidth, h = img.naturalHeight;
  const tw = Math.min(targetWidth || w, 1600);
  if (tw && tw !== w) { h = Math.round(h * tw / w); w = tw; }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.75);
  return { width: w, height: h, base64: out.split(",")[1] };
}
