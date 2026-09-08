// freeagent: your boxes, on your own GitHub or Hugging Face account, driven from your phone.
// Boxes-first page modelled on the crux-android deployments screen. No backend of ours: tokens
// live in this browser, boxes are read live from the providers, and the only server code is
// functions/api/auth/[provider]/[action].js (OAuth code → token, because those endpoints send no
// CORS headers and need the app secret).

const CFG = window.FREEAGENT;
const API = { github: "https://api.github.com", hf: "https://huggingface.co" };
const LABEL = { github: "GitHub", hf: "Hugging Face" };
const SCOPE = { github: "codespace repo", hf: "openid profile manage-repos" };
const SCOPE_TAG = { github: "v2", hf: "v1" }; // bump when a scope changes so older tokens are dropped

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);

// ---- Local state -----------------------------------------------------------------------------------
const LS = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};
const tokenOf = (p) => (LS.get(`freeagent:${p}:scope`) === SCOPE_TAG[p] ? LS.get(`freeagent:${p}`) : null);
const storeToken = (p, t) => { LS.set(`freeagent:${p}`, t); LS.set(`freeagent:${p}:scope`, SCOPE_TAG[p]); };
const dropToken = (p) => { LS.del(`freeagent:${p}`); LS.del(`freeagent:${p}:scope`); delete user[p]; };
// Per-box facts the providers do not keep for us: the repo it started from, an HF box's Collie token.
const boxMeta = (id) => JSON.parse(LS.get(`freeagent:box:${id}`) ?? "{}");
const setBoxMeta = (id, patch) => LS.set(`freeagent:box:${id}`, JSON.stringify({ ...boxMeta(id), ...patch }));

const config = {}; // provider -> /config reply, when this host has that provider's secrets
const user = {}; // provider -> username
let boxes = [];
let busy = {}; // box id -> note shown on the card
let pollTimer = null;
let openMenu = null;

// ---- Toast -------------------------------------------------------------------------------------------
let toastTimer;
function toast(text) {
  const el = $("toast"); el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

// ---- Sign in / out -------------------------------------------------------------------------------------
async function detect(p) {
  const res = await fetch(`/api/auth/${p}/config`).catch(() => null);
  config[p] = res?.ok ? await res.json() : null;
}

function signIn(p, intent = "home") {
  if (!config[p]) return toast(`${LABEL[p]} sign-in is not configured here.`);
  const state = randomToken();
  sessionStorage.setItem("oauth", JSON.stringify({ p, state, intent }));
  const url = p === "github"
    ? `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: config.github.client_id, redirect_uri: config.github.redirect_uri, scope: SCOPE.github, state })}`
    : `https://huggingface.co/oauth/authorize?${new URLSearchParams({ client_id: config.hf.client_id, redirect_uri: `${location.origin}/`, response_type: "code", scope: SCOPE.hf, state })}`;
  location.assign(url);
}

async function finishSignIn(params) {
  const tx = JSON.parse(sessionStorage.getItem("oauth") ?? "null");
  sessionStorage.removeItem("oauth");
  history.replaceState(null, "", "/");
  if (!tx || tx.state !== params.get("state")) throw new Error("Sign-in did not start here. Please try again.");
  const res = await fetch(`/api/auth/${tx.p}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: params.get("code") }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`${LABEL[tx.p]} refused the sign-in: ${body.error_description || body.error || res.status}`);
  storeToken(tx.p, body.access_token);
  return tx;
}

// GitHub device-code fallback for an OAuth App whose callback is misconfigured.
async function signInWithCode() {
  const start = await (await fetch("/api/auth/github/device", { method: "POST" })).json();
  if (start.error) throw new Error(`GitHub: ${start.error_description || start.error}. Is "Enable Device Flow" ticked on the OAuth App?`);
  $("device-code").textContent = start.user_code; $("device-link").href = start.verification_uri; $("device").showModal();
  const deadline = Date.now() + start.expires_in * 1000;
  let interval = (start.interval || 5) * 1000;
  while (Date.now() < deadline && $("device").open) {
    await sleep(interval);
    const res = await (await fetch("/api/auth/github/poll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_code: start.device_code }) })).json();
    if (res.access_token) { storeToken("github", res.access_token); $("device").close(); return render(); }
    if (res.error === "slow_down") interval += 5000;
    else if (res.error !== "authorization_pending") { $("device").close(); throw new Error(`GitHub: ${res.error_description || res.error}`); }
  }
}

// ---- Provider APIs -----------------------------------------------------------------------------------
async function api(p, path, init = {}) {
  const res = await fetch(`${API[p]}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${tokenOf(p)}`, ...(p === "github" ? { accept: "application/vnd.github+json" } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  if (res.status === 401) { dropToken(p); throw new Error(`Your ${LABEL[p]} access expired. Sign in again to continue.`); }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}
async function whoami(p) {
  if (!tokenOf(p)) { delete user[p]; return; }
  try { user[p] = p === "github" ? (await api("github", "/user")).login : (await api("hf", "/api/whoami-v2")).name; } catch { delete user[p]; }
}

// ---- Boxes ------------------------------------------------------------------------------------------------
const codespaceUrl = (name) => `https://${name}-7860.app.github.dev/`;
const spaceUrl = (id) => `https://${id.replace("/", "-").toLowerCase()}.hf.space/`;

// One vocabulary for both providers: running · pending · stopped · failed, plus the raw state.
function classify(p, raw) {
  if (p === "github") {
    if (raw === "Available") return ["running", "Running"];
    if (["Queued", "Provisioning", "Rebuilding", "Updating", "Exporting"].includes(raw)) return ["pending", "Provisioning"];
    if (raw === "Starting") return ["pending", "Starting"];
    if (["Shutdown", "Archived", "ShuttingDown"].includes(raw)) return ["stopped", "Stopped"];
    if (["Failed", "Unavailable", "Deleted", "Moved"].includes(raw)) return ["failed", "Failed"];
    return ["pending", raw ?? "Unknown"];
  }
  if (raw === "RUNNING") return ["running", "Running"];
  if (["BUILDING", "APP_STARTING", "RUNNING_BUILDING", "RUNNING_APP_STARTING"].includes(raw)) return ["pending", "Provisioning"];
  if (["SLEEPING", "PAUSED", "STOPPED"].includes(raw)) return ["stopped", "Sleeping"];
  if (/ERROR|NO_APP_FILE/.test(raw ?? "")) return ["failed", "Failed"];
  return ["pending", raw ?? "Unknown"];
}

async function loadBoxes() {
  const found = [];
  const jobs = [];
  if (user.github) jobs.push(api("github", "/user/codespaces?per_page=100").then(({ codespaces = [] }) => {
    for (const c of codespaces) {
      if (c.repository.full_name.toLowerCase() !== CFG.TEMPLATE_REPO.toLowerCase()) continue;
      const [kind, label] = classify("github", c.state);
      found.push({ p: "github", id: c.name, name: c.display_name || c.name, kind, label, raw: c.state, url: codespaceUrl(c.name), created: c.created_at, ...boxMeta(c.name) });
    }
  }));
  if (user.hf) jobs.push(api("hf", `/api/spaces?author=${encodeURIComponent(user.hf)}&full=true&limit=100`).then(async (spaces) => {
    const mine = spaces.filter((s) => s.sdk === "docker" && s.id !== CFG.TEMPLATE_SPACE && /freeagent/i.test(s.cardData?.title ?? ""));
    await Promise.all(mine.map(async (s) => {
      const rt = await api("hf", `/api/spaces/${s.id}/runtime`).catch(() => null);
      const [kind, label] = classify("hf", rt?.stage);
      found.push({ p: "hf", id: s.id, name: s.id.split("/")[1], kind, label, raw: rt?.stage, url: spaceUrl(s.id), created: s.createdAt, ...boxMeta(s.id) });
    }));
  }));
  await Promise.all(jobs);
  // Pending first, then newest.
  found.sort((a, b) => (a.kind === "pending") === (b.kind === "pending") ? (b.created ?? "").localeCompare(a.created ?? "") : (a.kind === "pending" ? -1 : 1));
  boxes = found;
}

function renderCards() {
  const root = $("cards"); root.textContent = ""; closeMenu();
  $("empty").hidden = boxes.length > 0;
  for (const b of boxes) {
    const el = document.createElement("div");
    el.className = "card" + (b.kind === "running" || b.kind === "stopped" ? "" : " static");
    el.setAttribute("role", "button"); el.tabIndex = 0;
    const note = busy[b.id];
    el.innerHTML = `
      <div class="glyph">${b.p === "github" ? "GH" : "HF"}</div>
      <div>
        <div class="name"></div>
        <div class="status"><span class="dot ${b.kind}"></span><span class="status-text"></span></div>
        <div class="repo" hidden></div>
        <div class="err" hidden></div>
        <div class="bar" hidden></div>
      </div>
      <div class="trail"></div>`;
    el.querySelector(".name").textContent = b.name;
    el.querySelector(".status-text").textContent = note ?? b.label;
    if (b.repo) { const r = el.querySelector(".repo"); r.textContent = b.repo; r.hidden = false; }
    el.querySelector(".bar").hidden = !(b.kind === "pending" || note);
    const trail = el.querySelector(".trail");
    if (note) trail.innerHTML = '<div class="spinner"></div>';
    else { const more = document.createElement("button"); more.className = "more"; more.textContent = "⋮"; more.setAttribute("aria-label", "More actions"); more.onclick = (ev) => { ev.stopPropagation(); showMenu(el, b); }; trail.appendChild(more); }
    const go = () => { if (!busy[b.id] && (b.kind === "running" || b.kind === "stopped")) connect(b).catch((e) => { setBusy(b.id, null); showError(e.message); }); };
    el.onclick = go;
    el.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } };
    root.appendChild(el);
  }
}

function showMenu(card, b) {
  closeMenu();
  const m = document.createElement("div"); m.className = "menu"; m.setAttribute("role", "menu");
  const add = (text, fn, cls = "") => { const btn = document.createElement("button"); btn.textContent = text; btn.className = cls; btn.setAttribute("role", "menuitem"); btn.onclick = (ev) => { ev.stopPropagation(); closeMenu(); fn(); }; m.appendChild(btn); };
  add("Copy address", () => navigator.clipboard?.writeText(b.url).then(() => toast("Address copied")));
  if (b.p === "hf" && b.token) add("Copy Collie token", () => navigator.clipboard?.writeText(b.token).then(() => toast("Token copied")));
  add("Delete", () => confirmDelete(b), "danger");
  card.appendChild(m); openMenu = m;
}
function closeMenu() { openMenu?.remove(); openMenu = null; }
document.addEventListener("click", closeMenu);

function setBusy(id, note) { if (note === null) delete busy[id]; else busy[id] = note; renderCards(); }
function showError(text) { $("list-error").textContent = text; }

// Tap a card: wake it if it is stopped, then open it. An HF box gets its Collie token in the
// fragment on every open — the PWA ignores it once the phone is paired.
async function connect(b) {
  if (b.p === "github" && b.kind !== "running") {
    setBusy(b.id, "Starting the codespace…");
    await api("github", `/user/codespaces/${b.id}/start`, { method: "POST" }).catch((e) => { if (e.status !== 409) throw e; });
    for (let i = 0; i < 40; i += 1) {
      await sleep(3000);
      const cs = await api("github", `/user/codespaces/${b.id}`);
      if (cs.state === "Available") break;
      setBusy(b.id, `Codespace is ${cs.state.toLowerCase()}…`);
      if (i === 39) throw new Error("The codespace did not start in time. Try again in a moment.");
    }
    for (let i = 20; i > 0; i -= 1) { setBusy(b.id, `Starting Herdr and Collie… ${i}s`); await sleep(1000); }
  }
  setBusy(b.id, null);
  location.assign(b.p === "hf" && b.token ? `${b.url}#token=${b.token}${b.repo ? `&repo=${b.repo}` : ""}` : b.repo ? `${b.url}#repo=${b.repo}` : b.url);
}

function confirmDelete(b) {
  $("confirm-text").textContent = `${b.name} and everything on it will be destroyed on the provider. This cannot be undone.`;
  $("confirm-ok").onclick = async () => {
    $("confirm").close();
    setBusy(b.id, "Deleting…");
    try {
      if (b.p === "github") await api("github", `/user/codespaces/${b.id}`, { method: "DELETE" });
      else await api("hf", "/api/repos/delete", { method: "DELETE", body: JSON.stringify({ type: "space", name: b.name }) });
      LS.del(`freeagent:box:${b.id}`);
      toast(`Deleted ${b.name}`);
    } catch (e) { toast(e.message); showError(e.message); }
    setBusy(b.id, null);
    await refresh();
  };
  $("confirm").showModal();
}

// ---- Create ---------------------------------------------------------------------------------------------------
let repos = null; // the user's GitHub repositories, loaded once per session
let pickedRepo = null;
let nameSuggested = true;

const WORDS_A = ["swift", "quiet", "bright", "calm", "brave", "clever", "eager", "gentle", "keen", "lively"];
const WORDS_B = ["nimbus", "harbor", "meadow", "comet", "ember", "lantern", "otter", "summit", "willow", "zephyr"];
const randomName = () => `${WORDS_A[Math.floor(Math.random() * 10)]}-${WORDS_B[Math.floor(Math.random() * 10)]}-${100 + Math.floor(Math.random() * 900)}`;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
function nameFor(repo) {
  const base = repo.split("/")[1].toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "box";
  const taken = new Set(boxes.map((b) => b.name.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return base;
}

function openCreate() {
  const sel = $("create-provider"); sel.textContent = "";
  for (const p of ["github", "hf"]) {
    if (!config[p]) continue;
    const o = document.createElement("option"); o.value = p;
    o.textContent = user[p] ? `${LABEL[p]} — ${user[p]}` : `${LABEL[p]} — not connected`;
    sel.appendChild(o);
  }
  sel.value = user.github ? "github" : user.hf ? "hf" : sel.options[0]?.value;
  pickedRepo = null; nameSuggested = true;
  $("repo-picker-value").textContent = "Empty box";
  $("create-name").value = randomName();
  $("create-error").textContent = "";
  $("advanced").open = false;
  onProviderChange();
  $("create").showModal();
  if (user.github && repos === null) loadRepos().catch(() => {});
}

function onProviderChange() {
  const p = $("create-provider").value;
  $("machine-field").hidden = p !== "github";
  $("visibility-field").hidden = p !== "hf";
  const hint = $("repo-hint");
  hint.hidden = Boolean(user.github);
  hint.textContent = user.github ? "" : "Connect GitHub to start from a repository.";
  $("create-submit").disabled = !user[p];
  if (!user[p] && p) { $("create").close(); signIn(p, "create"); }
}

async function loadRepos() {
  const all = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await api("github", `/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`);
    all.push(...batch.map((r) => ({ full: r.full_name, priv: r.private })));
    if (batch.length < 100) break;
  }
  repos = all;
}

function openRepoSearch() {
  $("create-form").hidden = true; $("repo-search").hidden = false;
  $("repo-query").value = ""; renderRepoList(""); setTimeout(() => $("repo-query").focus(), 200);
}
function closeRepoSearch() { $("repo-search").hidden = true; $("create-form").hidden = false; }
function renderRepoList(q) {
  const list = $("repo-list"); list.textContent = "";
  const add = (text, priv, fn) => { const b = document.createElement("button"); b.type = "button"; b.innerHTML = `<span></span>${priv ? '<span class="lock" aria-label="Private">🔒</span>' : ""}`; b.querySelector("span").textContent = text; b.onclick = fn; list.appendChild(b); };
  if (q.trim() === "") add("Empty box", false, () => pickRepo(null));
  if (repos === null) { const p = document.createElement("div"); p.className = "none"; p.textContent = "Loading repositories…"; list.appendChild(p); return; }
  const hits = repos.filter((r) => r.full.toLowerCase().includes(q.trim().toLowerCase()));
  for (const r of hits.slice(0, 200)) add(r.full, r.priv, () => pickRepo(r.full));
  if (hits.length === 0 && q.trim() !== "") { const p = document.createElement("div"); p.className = "none"; p.textContent = "No repository matches"; list.appendChild(p); }
}
function pickRepo(full) {
  pickedRepo = full;
  $("repo-picker-value").textContent = full ?? "Empty box";
  if (nameSuggested) $("create-name").value = full ? nameFor(full) : randomName();
  closeRepoSearch();
}

async function submitCreate(ev) {
  ev.preventDefault();
  const p = $("create-provider").value;
  const name = $("create-name").value.trim();
  if (!NAME_RE.test(name)) { $("create-error").textContent = "Use only letters, numbers and hyphens"; return; }
  $("create-submit").disabled = true; $("create-error").textContent = "";
  try {
    const id = p === "github" ? await createCodespace(name) : await createSpace(name);
    if (pickedRepo) setBoxMeta(id, { repo: pickedRepo });
    $("create").close();
    await refresh();
  } catch (e) {
    $("create-error").textContent = e.message || "Could not create the box";
  }
  $("create-submit").disabled = false;
}

async function createCodespace(name) {
  const repo = await api("github", `/repos/${CFG.TEMPLATE_REPO}`);
  const cs = await api("github", "/user/codespaces", {
    method: "POST",
    body: JSON.stringify({ repository_id: repo.id, ref: repo.default_branch, machine: $("create-machine").value, display_name: name, idle_timeout_minutes: CFG.CODESPACE_IDLE_MINUTES, devcontainer_path: ".devcontainer/devcontainer.json" }),
  });
  return cs.name;
}

async function createSpace(name) {
  const collieToken = randomToken();
  const id = `${user.hf}/${name}`;
  try {
    await api("hf", `/api/spaces/${CFG.TEMPLATE_SPACE}/duplicate`, {
      method: "POST",
      body: JSON.stringify({
        repository: id,
        visibility: $("create-visibility").value,
        hardware: "cpu-basic",
        secrets: [{ key: "COLLIE_AUTH_TOKEN", value: collieToken }],
        variables: pickedRepo ? [{ key: "FREEAGENT_REPO", value: pickedRepo }] : [],
      }),
    });
  } catch (e) {
    if (e.status === 409) throw new Error("You already have a Space with that name.");
    throw e;
  }
  setBoxMeta(id, { token: collieToken });
  return id;
}

// ---- Accounts ---------------------------------------------------------------------------------------------------
function renderAccounts() {
  for (const p of ["github", "hf"]) {
    $(`acct-${p}`).hidden = !config[p];
    $(`acct-${p}-sub`).textContent = user[p] ?? "not connected";
    $(`acct-${p}-connect`).hidden = Boolean(user[p]);
  }
  $("acct-hf-disconnect").hidden = !user.hf;
  $("signout").hidden = !user.github;
  $("github-details").hidden = !config.github || Boolean(user.github);
  if (config.github) $("github-details-text").textContent = `client id ${config.github.client_id.slice(0, 8)}… · callback ${config.github.redirect_uri}`;
}

// ---- Page -----------------------------------------------------------------------------------------------------------
async function refresh() {
  showError("");
  try { await loadBoxes(); } catch (e) { showError(e.message); }
  renderCards();
  schedulePoll();
}
function schedulePoll() {
  clearTimeout(pollTimer);
  const pending = boxes.some((b) => b.kind === "pending") || Object.keys(busy).length > 0;
  pollTimer = setTimeout(() => { if (!document.hidden) refresh(); else schedulePoll(); }, pending ? 4000 : 30000);
}

async function render() {
  await Promise.all(["github", "hf"].map(whoami));
  renderAccounts();
  const signedIn = Boolean(user.github || user.hf);
  $("signed-out").hidden = signedIn;
  $("boxes-view").hidden = !signedIn;
  $("new-box").hidden = !signedIn;
  $("signin-hf-alt").hidden = !config.hf;
  if (!signedIn) { clearTimeout(pollTimer); return; }
  if (boxes.length === 0) $("skeleton").hidden = false;
  await refresh();
  $("skeleton").hidden = true;
}

async function main() {
  await Promise.all(["github", "hf"].map(detect));
  if (!config.github && !config.hf) { $("signed-out").hidden = false; $("signed-out-error").textContent = "No sign-in is configured on this deployment."; return; }

  $("signin-github").onclick = () => signIn("github");
  $("signin-hf-alt").onclick = () => signIn("hf");
  $("new-box").onclick = openCreate; $("new-box-empty").onclick = openCreate;
  $("create-provider").onchange = onProviderChange;
  $("repo-picker").onclick = () => { if (user.github) openRepoSearch(); else { $("create").close(); signIn("github", "create"); } };
  $("repo-cancel").onclick = closeRepoSearch;
  $("repo-query").oninput = (ev) => renderRepoList(ev.target.value);
  $("create-name").oninput = () => { nameSuggested = false; };
  $("create-form").onsubmit = submitCreate;
  $("create-cancel").onclick = () => $("create").close();
  $("accounts-open").onclick = () => { renderAccounts(); $("accounts").showModal(); };
  $("accounts-close").onclick = () => $("accounts").close();
  $("acct-github-connect").onclick = () => signIn("github");
  $("acct-hf-connect").onclick = () => signIn("hf");
  $("acct-hf-disconnect").onclick = () => { dropToken("hf"); toast("Hugging Face disconnected"); $("accounts").close(); render(); };
  $("signout").onclick = () => { dropToken("github"); dropToken("hf"); toast("Signed out"); $("accounts").close(); render(); };
  $("github-device").onclick = (ev) => { ev.preventDefault(); $("accounts").close(); signInWithCode().catch((e) => toast(e.message)); };
  $("device-cancel").onclick = () => $("device").close();
  $("confirm-cancel").onclick = () => $("confirm").close();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && (user.github || user.hf)) refresh(); });

  const params = new URLSearchParams(location.search);
  if (params.get("error")) { history.replaceState(null, "", "/"); $("signed-out-error").textContent = `Sign-in failed: ${params.get("error_description") ?? params.get("error")}`; }
  let intent = null;
  if (params.get("code")) {
    try { intent = (await finishSignIn(params)).intent; toast("Signed in"); } catch (e) { $("signed-out-error").textContent = e.message; }
  }
  await render();
  if (intent === "create" && (user.github || user.hf)) openCreate();
}

main().catch((e) => { $("signed-out").hidden = false; $("signed-out-error").textContent = e.message; });
