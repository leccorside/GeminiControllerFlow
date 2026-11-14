// Clique no ícone da barra de ferramentas abre/fecha a barra lateral do Gemini.
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});
