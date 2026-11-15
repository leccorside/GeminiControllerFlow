// Clique no ícone da barra de ferramentas abre/fecha a barra lateral do Gemini.
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// O Gemini roda num iframe escondido DENTRO da barra lateral (sem aba nem janela). O Google proíbe ser
// incorporado (X-Frame-Options / CSP frame-ancestors); removemos essa proibição SÓ quando quem incorpora é a
// própria extensão (a barra lateral). Nenhum outro site ou quadro é afetado.
const ORIGEM_EXTENSAO = browser.runtime.getURL("");

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
