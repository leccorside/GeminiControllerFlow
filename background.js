// ---------- Fundo da extensão ----------
// Arquitetura (1.0.18): o assistente é um PAINEL DENTRO DA PÁGINA, só nas abas em que o usuário o abre.
//  • Este fundo hospeda o MOTOR (sidebar/sidebar.html?host=1 num iframe escondido): sessões por aba, loop do
//    agente, ferramentas e o Gemini (outro iframe escondido, logado na conta do usuário). Testado: aqui o Gemini
//    conta como página visível e enxerga os cookies do Firefox (sem isolamento).
//  • O painel (panel/panel.html) é só a interface; conversa com o motor por runtime.connect. Se a página navegar,
//    o painel some com ela e reaparece sozinho (content/panel-host.js), e a tarefa continua no motor.
//  • A barra lateral nativa não é usada: o Firefox não deixa a extensão fechá-la ao trocar de aba.

const ORIGEM_EXTENSAO = browser.runtime.getURL("");
const PANEL_URL = browser.runtime.getURL("panel/panel.html");

// O Google proíbe ser incorporado (X-Frame-Options / CSP frame-ancestors). Removemos essa proibição SÓ quando quem
// incorpora é a própria extensão (o motor escondido). Nenhum outro site ou quadro é afetado.
browser.webRequest.onHeadersReceived.addListener(d => {
  const quem = d.originUrl || d.documentUrl || "";
  if (!quem.startsWith(ORIGEM_EXTENSAO)) return {};
  const responseHeaders = d.responseHeaders.filter(h => {
    const n = h.name.toLowerCase();
    if (n === "x-frame-options") return false;
    if (n === "content-security-policy" && /frame-ancestors/i.test(h.value)) {
      h.value = h.value.split(";").filter(p => !/^\s*frame-ancestors/i.test(p)).join(";");
    }
    return true;
  });
  return { responseHeaders };
}, { urls: ["https://gemini.google.com/*"], types: ["sub_frame"] }, ["blocking", "responseHeaders"]);

// ---------- Motor escondido ----------
const motor = document.createElement("iframe");
motor.src = browser.runtime.getURL("sidebar/sidebar.html?host=1");
motor.style.cssText = "width:1200px;height:900px;border:0";
document.body.appendChild(motor);

// ---------- Painel por aba ----------
// tabId -> token. O token vai no endereço do painel (#token) e o motor só atende painéis com o token certo:
// um site não consegue embutir o painel por conta própria para induzir cliques.
const painelAberto = new Map();
window.gcfPainelToken = tabId => painelAberto.get(tabId) || null;

function novoToken() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}

async function abrirPainel(tab) {
  const token = novoToken();
  painelAberto.set(tab.id, token);
  const url = PANEL_URL + "#" + token;
  try {
    await browser.tabs.sendMessage(tab.id, { gcfPanel: "open", url });
  } catch (_) {
    // Aba aberta antes da instalação (sem o content script): injeta e tenta de novo.
    try {
      await browser.tabs.executeScript(tab.id, { file: "/content/panel-host.js" });
      await browser.tabs.sendMessage(tab.id, { gcfPanel: "open", url });
    } catch (e) {
      painelAberto.delete(tab.id);
      avisoSemPainel(tab.id);
      return;
    }
  }
  browser.browserAction.setBadgeText({ tabId: tab.id, text: "" });
}

async function fecharPainel(tabId) {
  painelAberto.delete(tabId);
  try { await browser.tabs.sendMessage(tabId, { gcfPanel: "close" }); } catch (_) { /* página sem o host */ }
}

// Páginas internas do Firefox (about:, addons.mozilla.org, leitor de PDF) não aceitam o painel.
function avisoSemPainel(tabId) {
  browser.browserAction.setBadgeBackgroundColor({ tabId, color: "#d33b4c" });
  browser.browserAction.setBadgeText({ tabId, text: "!" });
  browser.browserAction.setTitle({ tabId, title: "O Firefox não permite abrir o assistente nesta página." });
}

// Ícone da barra de ferramentas (e o atalho Ctrl+Shift+Y): abre/fecha o painel NESTA aba.
browser.browserAction.onClicked.addListener(tab => {
  if (painelAberto.has(tab.id)) fecharPainel(tab.id); else abrirPainel(tab);
});

browser.runtime.onMessage.addListener((m, sender) => {
  if (!m || !m.gcfPanel) return undefined;
  const tabId = sender.tab && sender.tab.id;
  // A página (re)carregou: o host pergunta se deve mostrar o painel.
  if (m.gcfPanel === "query") {
    const token = painelAberto.get(tabId);
    const acao = emAcao.has(tabId) ? { acao: true, label: emAcao.get(tabId) } : {};
    return Promise.resolve(token ? { open: true, url: PANEL_URL + "#" + token, ...acao } : { open: false, ...acao });
  }
  // Botão X do painel.
  if (m.gcfPanel === "closeMe" && tabId != null) { fecharPainel(tabId); return Promise.resolve({ ok: true }); }
  return undefined;
});

// ---------- "Gemini em Ação" ----------
// tabId -> rótulo. O motor liga ao começar uma tarefa e desliga ao terminar; a página mostra a borda verde e o
// aviso (content/panel-host.js). Guardado aqui para reaparecer quando a página navega no meio da tarefa.
const emAcao = new Map();
window.gcfAcao = (tabId, on, label) => {
  if (tabId == null) return;
  if (on) emAcao.set(tabId, label || "Gemini em Ação"); else emAcao.delete(tabId);
  browser.tabs.sendMessage(tabId, { gcfPanel: "acao", on: !!on, label }).catch(() => { /* página sem o host */ });
};

browser.tabs.onRemoved.addListener(tabId => { painelAberto.delete(tabId); emAcao.delete(tabId); });
