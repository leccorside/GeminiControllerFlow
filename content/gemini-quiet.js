// Silencia as notificações do Gemini no quadro escondido da extensão.
// Como o quadro conta como "fora de vista", o Gemini avisa por notificação do sistema quando a resposta fica pronta
// (o aviso trazia o bloco de ação, ex.: {"tool": "elementor", ...}). O usuário não quer esses avisos: a resposta já
// aparece no painel. Roda em document_start, antes dos scripts do Gemini, e SÓ no quadro da extensão
// (window.name "gcf-bridge:..."): a aba normal do Gemini do usuário não é alterada.
(() => {
  if (!/^gcf-bridge:/.test(window.name || "")) return;
  const w = window.wrappedJSObject;
  const negado = () => "denied";
  try {
    const N = w.Notification;
    if (N) {
      Object.defineProperty(N, "permission", { configurable: true, get: exportFunction(negado, w) });
      N.requestPermission = exportFunction(() => w.Promise.resolve("denied"), w);
    }
  } catch (_) { /* segue sem o ajuste */ }
  try {
    // Notificações pelo service worker (registration.showNotification): resolve sem mostrar nada.
    const proto = w.ServiceWorkerRegistration && w.ServiceWorkerRegistration.prototype;
    if (proto && proto.showNotification) {
      Object.defineProperty(proto, "showNotification", { configurable: true, writable: true,
        value: exportFunction(() => w.Promise.resolve(), w) });
    }
  } catch (_) { /* segue sem o ajuste */ }
  try {
    // permissions.query({name: "notifications"}) também responde "negado".
    const perms = w.navigator.permissions;
    const original = perms && perms.query;
    if (original) {
      const query = function (desc) {
        if (desc && desc.name === "notifications") return w.Promise.resolve(cloneInto({ state: "denied", name: "notifications" }, w));
        return original.call(perms, desc);
      };
      Object.defineProperty(perms, "query", { configurable: true, writable: true, value: exportFunction(query, w) });
    }
  } catch (_) { /* segue sem o ajuste */ }
})();
