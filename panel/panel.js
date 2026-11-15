// Painel do assistente dentro da página. Só interface: a conversa, o loop do agente e o Gemini rodam no motor
// (fundo da extensão). O painel se conecta por runtime.connect("gcf-panel") com o token recebido no endereço.
const $ = id => document.getElementById(id);
const TOKEN = location.hash.slice(1);
const DEFAULTS = { lang: "", engine: "web", apiKey: "", model: "gemini-2.5-flash", apiLevel: "", webModel: "", webLevel: "",
  confirmMode: "js", maxSteps: 40, skillsOff: [] };
let settings = { ...DEFAULTS };
let estado = { engine: "web", account: null, modelName: "", modelLevel: "", busyTab: null, aqui: false };
const view = $("view");
const chatBox = $("chat");

// ---------- Conexão com o motor ----------
// Reconecta sozinho se o motor ainda estiver carregando (ex.: logo depois de o Firefox abrir).
let port = null;
let rpcSeq = 0;
const rpcPend = new Map();
function rpc(fn, args) {
  const id = ++rpcSeq;
  return new Promise((ok, fail) => {
    if (!port) { fail(new Error(t("geminiTabGone"))); return; }
    rpcPend.set(id, { ok, fail });
    port.postMessage({ type: "rpc", id, fn, args });
  });
}
function postar(msg) { if (port) port.postMessage(msg); else toast(t("geminiTabGone")); }
function conectar(tentativa = 0) {
  const p = browser.runtime.connect({ name: "gcf-panel" });
  let atendido = false;
  p.onMessage.addListener(m => {
    if (!m) return;
    atendido = true;
    if (m.t === "html") { setHtml(view, m.html); chatBox.scrollTop = chatBox.scrollHeight; return; }
    if (m.t === "state") { estado = m; renderState(); return; }
    if (m.t === "toast") { toast(m.text); return; }
    if (m.t === "rpc") { const q = rpcPend.get(m.id); if (q) { rpcPend.delete(m.id); m.ok ? q.ok(m.result) : q.fail(new Error(m.erro)); } }
  });
  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
    for (const [id, q] of rpcPend) { rpcPend.delete(id); q.fail(new Error(t("geminiTabGone"))); }
    if (tentativa < 20) setTimeout(() => conectar(atendido ? 0 : tentativa + 1), 800);
  });
  port = p;
  p.postMessage({ type: "hello", token: TOKEN });
}
conectar();

// HTML espelhado do motor (gerado por ele: Markdown já escapado, textos do usuário via textContent).
function setHtml(el, html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  el.replaceChildren(...doc.body.childNodes);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let toastTimer = null;
function toast(text) {
  const box = $("toast");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 6000);
}

// ---------- Estado vindo do motor ----------
function renderState() {
  const ocupadoAqui = !!estado.aqui;
  $("btnSend").hidden = ocupadoAqui;
  $("btnStop").hidden = !ocupadoAqui;
  $("modelPicker").disabled = estado.busyTab != null;
  $("modelPickerLabel").textContent = estado.modelName || t("modelDefault");
  $("modelPickerLevel").textContent = estado.modelLevel || "";
  $("modelPickerLevel").hidden = !estado.modelLevel;
  $("modelPicker").title = `${t("modelPickerTitle")}: ${estado.modelName || ""}${estado.modelLevel ? " " + estado.modelLevel : ""}`;
  updateBadge();
}

function updateBadge() {
  const badge = $("modelBadge");
  badge.replaceChildren();
  badge.classList.remove("connected", "disconnected");
  badge.onclick = null;
  if ((estado.engine || settings.engine) !== "web") {
    badge.textContent = settings.model;
    badge.title = t("apiModelTitle");
    return;
  }
  const conta = estado.account;
  if (conta) {
    if (conta.foto) {
      const img = document.createElement("img");
      img.src = conta.foto; img.alt = ""; img.className = "avatar"; img.referrerPolicy = "no-referrer";
      img.onerror = () => img.remove();
      badge.appendChild(img);
    }
    badge.appendChild(el("span", "", conta.email));
    badge.classList.add("connected");
    badge.title = t("connectedAs", { conta: `${conta.nome ? conta.nome + " — " : ""}${conta.email}` });
  } else {
    badge.textContent = t("notConnected");
    badge.classList.add("disconnected");
    badge.title = t("notConnectedTitle");
    badge.onclick = () => rpc("login").catch(e => toast(e.message));
  }
}

// ---------- Configurações (salvas no storage; o motor recarrega sozinho) ----------
async function loadSettings() {
  settings = { ...DEFAULTS, ...(await browser.storage.local.get(Object.keys(DEFAULTS))) };
  if (!settings.lang) settings.lang = detectLang();
  setLang(settings.lang);
  $("lang").value = LANG;
  applyI18n();
  $("engine").value = settings.engine;
  $("apiKey").value = settings.apiKey;
  $("model").value = settings.model;
  $("confirmMode").value = settings.confirmMode;
  $("maxSteps").value = settings.maxSteps;
  renderSkillsSettings();
  refreshEngineFields();
  renderState();
}

function refreshEngineFields() {
  const web = $("engine").value === "web";
  $("webFields").hidden = !web;
  $("apiFields").hidden = web;
  $("engineHelp").textContent = web ? t("engineHelpWeb") : t("engineHelpApi");
}

function renderSkillsSettings() {
  $("skillsList").replaceChildren(...SKILLS.map(sk => {
    const lab = el("label", "skill-item");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = "skill_" + sk.id; cb.checked = !(settings.skillsOff || []).includes(sk.id);
    lab.append(cb, el("span", "", sk.nome), el("small", "", t("skillDesc_" + sk.id)));
    return lab;
  }));
}

async function saveSettings() {
  const novo = {
    ...settings,
    lang: $("lang").value,
    engine: $("engine").value,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULTS.model,
    confirmMode: $("confirmMode").value,
    maxSteps: Math.min(Math.max(Number($("maxSteps").value) || DEFAULTS.maxSteps, 5), 200),
    skillsOff: SKILLS.filter(sk => { const c = $("skill_" + sk.id); return c && !c.checked; }).map(sk => sk.id)
  };
  await browser.storage.local.set(novo);
  $("settings").hidden = true;
  await loadSettings();
}

async function loadApiModels() {
  const key = $("apiKey").value.trim();
  const status = $("modelsStatus");
  if (!key) { status.textContent = t("needKeyFirst"); return; }
  status.textContent = t("loading");
  try {
    const models = await rpc("loadApiModels", { key });
    $("modelList").replaceChildren(...models.map(m => { const o = document.createElement("option"); o.value = m.id; o.label = m.nome; return o; }));
    status.textContent = t("modelsLoaded", { n: models.length });
  } catch (e) { status.textContent = e.message; }
}

// ---------- Seletor de modelo ----------
function closeModelMenu() { $("modelMenu").hidden = true; }
function modelMenuStatus(text) { $("modelList2").replaceChildren(el("div", "model-status", text)); }

function renderModelItems(items) {
  if (!items.length) { modelMenuStatus(t("modelNone")); return; }
  $("modelList2").replaceChildren(...items.map(m => {
    const row = el("div", "model-row");
    const b = el("button", "model-item");
    b.type = "button"; b.disabled = !!m.desabilitado;
    const txt = el("span", "mi-text");
    const name = el("span", "mi-name", m.nome);
    if (m.nivel) name.appendChild(el("span", "mi-level", m.nivel));
    if (m.selo) name.appendChild(el("span", "mi-badge", m.selo));
    if (m.desabilitado) { const lk = el("span", "mi-lock", "🔒"); lk.title = t("modelLocked"); name.appendChild(lk); }
    txt.appendChild(name);
    if (m.descricao) txt.appendChild(el("span", "mi-desc", m.descricao));
    b.append(txt, el("span", "mi-check", m.selecionado ? "✓" : ""));
    b.onclick = () => escolher(m, m.nivelId ?? null);
    row.appendChild(b);
    if (m.niveis && m.niveis.length && !m.desabilitado) {
      const chev = el("button", "mi-chevron", "›");
      chev.type = "button"; chev.title = t("levelTitle");
      const sub = el("div", "model-levels"); sub.hidden = true;
      sub.appendChild(el("div", "model-levels-title", t("levelTitle")));
      for (const lv of m.niveis) {
        const lb = el("button", "level-item");
        lb.type = "button"; lb.disabled = !!lv.desabilitado;
        lb.append(el("span", "", lv.nome), el("span", "mi-check", lv.selecionado && m.selecionado ? "✓" : ""));
        lb.onclick = () => escolher(m, lv.id ?? lv.nome);
        sub.appendChild(lb);
      }
      chev.onclick = () => { sub.hidden = !sub.hidden; chev.classList.toggle("open", !sub.hidden); };
      row.append(chev, sub);
    }
    return row;
  }));
}

async function openModelMenu() {
  if (!$("modelMenu").hidden) { closeModelMenu(); return; }
  $("modelMenu").hidden = false;
  modelMenuStatus(t("modelLoading"));
  try { renderModelItems(await rpc("listModels")); }
  catch (e) { modelMenuStatus(t("modelListError", { e: e.message })); }
}

async function escolher(m, nivel) {
  closeModelMenu();
  try { await rpc("chooseModel", { modelo: m, nivel }); }
  catch (e) { toast(t("modelError", { e: e.message })); }
}

// ---------- Anexos ----------
const MAX_FILES = 20;
const MAX_MB = 25;
let pendingFiles = [];
const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const readAsDataURL = file => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(file); });

async function addFiles(lista) {
  for (const f of [...(lista || [])]) {
    if (pendingFiles.length >= MAX_FILES) { toast(t("attachTooMany", { n: MAX_FILES })); break; }
    if (f.size > MAX_MB * 1048576) { toast(t("attachTooBig", { nome: f.name, mb: MAX_MB })); continue; }
    try {
      const url = await readAsDataURL(f);
      pendingFiles.push({ name: f.name || "arquivo", type: f.type || "application/octet-stream", size: f.size,
        data: url.slice(url.indexOf(",") + 1), thumb: /^image\//.test(f.type) ? url : null });
    } catch (e) { toast(`${f.name}: ${e.message || e}`); }
  }
  renderPending();
}

function renderPending() {
  const list = $("attachList");
  list.hidden = !pendingFiles.length;
  const box = el("div", "attach-chips");
  pendingFiles.forEach((f, i) => {
    const chip = el("div", "attach-chip");
    chip.title = `${f.name} — ${fmtSize(f.size)}`;
    if (f.thumb) { const img = document.createElement("img"); img.src = f.thumb; img.alt = ""; chip.appendChild(img); }
    else chip.appendChild(el("span", "attach-ext", (f.name.split(".").pop() || "?").slice(0, 4).toUpperCase()));
    chip.appendChild(el("span", "attach-name", f.name));
    const x = el("button", "attach-x", "✕");
    x.type = "button"; x.title = t("attachRemove");
    x.onclick = () => { pendingFiles.splice(i, 1); renderPending(); };
    chip.appendChild(x);
    box.appendChild(chip);
  });
  list.replaceChildren(...(pendingFiles.length ? [box] : []));
}

// ---------- Envio ----------
function send(textoForcado) {
  const input = $("input");
  let text = (textoForcado != null ? textoForcado : input.value).trim();
  if (estado.busyTab != null) { if (!estado.aqui) toast(t("busyOtherTab")); return; }
  if (!text && !pendingFiles.length) return;
  if (!text) text = t("attachOnlyPrompt");
  // Miniaturas não vão ao motor (só os dados); ele mostra os chips na mensagem.
  const files = pendingFiles.map(({ thumb, ...f }) => ({ ...f, thumb }));
  pendingFiles = [];
  renderPending();
  if (textoForcado == null) { input.value = ""; autoresize(); }
  postar({ type: "send", text, files });
}

function autoresize() {
  const ta = $("input");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
}

// ---------- Eventos ----------
$("input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$("input").addEventListener("input", autoresize);
$("input").addEventListener("paste", e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
$("btnSend").addEventListener("click", () => send());
$("btnStop").addEventListener("click", () => postar({ type: "stop" }));
$("btnNew").addEventListener("click", () => postar({ type: "new" }));
$("btnClose").addEventListener("click", () => browser.runtime.sendMessage({ gcfPanel: "closeMe" }));
$("btnSettings").addEventListener("click", () => { $("settings").hidden = !$("settings").hidden; });
$("btnCloseSettings").addEventListener("click", () => { $("settings").hidden = true; });
$("btnSaveSettings").addEventListener("click", saveSettings);
$("btnLoadModels").addEventListener("click", loadApiModels);
$("btnOpenGemini").addEventListener("click", () => rpc("login").catch(e => toast(e.message)));
$("engine").addEventListener("change", refreshEngineFields);
$("btnAttach").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
$("modelPicker").addEventListener("click", e => { e.stopPropagation(); openModelMenu(); });
$("modelMenu").addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", closeModelMenu);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModelMenu(); });
document.body.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); $("inputWrap").classList.add("drop"); } });
document.body.addEventListener("dragleave", e => { if (!e.relatedTarget) $("inputWrap").classList.remove("drop"); });
document.body.addEventListener("drop", e => { $("inputWrap").classList.remove("drop"); if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
// Cliques na conversa espelhada: sugestões viram pedido; botões do motor (ex.: Permitir/Recusar) são repassados.
view.addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (chip) { send(chip.dataset.prompt || chip.textContent); return; }
  const acao = e.target.closest("[data-gcf-id]");
  if (acao) postar({ type: "click", id: acao.dataset.gcfId });
});
browser.storage.onChanged.addListener((mudou, area) => { if (area === "local") loadSettings(); });

loadSettings().then(() => $("input").focus());
