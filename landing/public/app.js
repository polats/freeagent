// freeagent: your boxes, on your own accounts, driven from your phone.
// Boxes-first page modelled on the crux-android deployments screen. No backend of ours: tokens
// live in this browser, boxes are read live from the providers, and the only server code is
// functions/api/auth/[provider]/[action].js (OAuth code → token, because those endpoints send no
// CORS headers and need the app secret; and one relay to Railway, whose API refuses browsers).
//
// Accounts follow crux-android's model: GitHub is THE account — it signs you in, and it is the
// identity every box recognises (a box knows its owner's GitHub login and pairs any device that
// proves it holds that sign-in). Hugging Face is connected to it: a place boxes can also run,
// never a way in on its own. Connected accounts travel with the GitHub account (see "Account
// store" below), so signing in to GitHub on a new device brings them along.
//
// Railway is wired (token paste + whoami relay) but parked: not in PROVIDERS, so it is never
// detected, offered or restored. Add it back to PROVIDERS and LINKED to re-enable.

const CFG = window.FREEAGENT;
const MAIN = "github";
const PROVIDERS = ["github", "hf"]; // fixed order, like the app's Accounts screen
const LINKED = PROVIDERS.filter((p) => p !== MAIN); // the accounts that ride with the GitHub one
const API = { github: "https://api.github.com", hf: "https://huggingface.co" };
const LABEL = { github: "GitHub", hf: "Hugging Face", railway: "Railway" };
const SCOPE = { github: "codespace repo", hf: "openid profile manage-repos" };
const SCOPE_TAG = { github: "v2", hf: "v1", railway: "v1" }; // bump when a scope changes so older tokens are dropped

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
let fastUntil = 0; // poll every second until this time, right after the user creates or deletes

// The providers' LIST endpoints lag: a deleted codespace stays listed for a while, a new one is
// missing for a while. So the page keeps its own word on what the user just did, for a few minutes:
//   ghosts     — boxes just created, shown at once and reconciled by their own single-item GET,
//                which is consistent immediately, until the list catches up;
//   tombstones — boxes just deleted, hidden even if the list still returns them.
const RECENT_MS = 5 * 60 * 1000;
const recent = (key) => { const m = JSON.parse(LS.get(key) ?? "{}"); const now = Date.now(); for (const k of Object.keys(m)) if (now - (m[k].at ?? m[k]) > RECENT_MS) delete m[k]; return m; };
const ghosts = () => recent("freeagent:ghosts");
const tombstones = () => recent("freeagent:tombstones");
const addGhost = (b) => { const m = ghosts(); m[b.id] = { ...b, at: Date.now() }; LS.set("freeagent:ghosts", JSON.stringify(m)); };
const dropGhost = (id) => { const m = ghosts(); delete m[id]; LS.set("freeagent:ghosts", JSON.stringify(m)); };
const addTombstone = (id) => { const m = tombstones(); m[id] = Date.now(); LS.set("freeagent:tombstones", JSON.stringify(m)); };
const dropTombstone = (id) => { const m = tombstones(); delete m[id]; LS.set("freeagent:tombstones", JSON.stringify(m)); };
const pollFast = () => { fastUntil = Date.now() + 12000; };
let openMenu = null;

// The OGL ribbons behind the finger (trails.js) load as a module, so they may not be ready when the
// sign-in screen first shows; leave the canvas for the module to pick up in that case.
function startTrails() { if (window.Trails) window.Trails.start($("trails")); else window.__trailsPending = $("trails"); }

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

// ---- Provider APIs -----------------------------------------------------------------------------------
async function api(p, path, init = {}) {
  const res = await fetch(`${API[p]}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${tokenOf(p)}`, ...(p === "github" ? { accept: "application/vnd.github+json" } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  if (res.status === 401) { dropToken(p); if (p !== MAIN) saveConnected().catch(() => {}); throw new Error(`Your ${LABEL[p]} access expired. Sign in again to continue.`); }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}
async function whoami(p) {
  if (!tokenOf(p)) { delete user[p]; return; }
  try {
    if (p === "github") user[p] = (await api("github", "/user")).login;
    else if (p === "hf") user[p] = (await api("hf", "/api/whoami-v2")).name;
    else user[p] = (await railwayWhoami(tokenOf(p))).name;
  } catch { delete user[p]; }
}
// Railway's API allows only railway.com as a browser origin, so the one question the page has for
// it — whose token is this? — goes through the Pages Function, which stores nothing.
async function railwayWhoami(token) {
  const res = await fetch("/api/auth/railway/whoami", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.name) { if (res.status === 400) dropToken("railway"); throw new Error(body.error ? `Railway: ${body.error}` : "Railway did not recognise that token."); }
  return body;
}

// ---- Account store ------------------------------------------------------------------------------------------
// Connected accounts ride with the GitHub account, in the user's OWN GitHub: a private repository
// `freeagent-account` holding `accounts.json`. Nothing of ours in the middle, and the thing that
// guards it is the same GitHub login that signs you in here. The GitHub token itself is never
// stored anywhere — it IS the login. Restored on every GitHub sign-in (a device with no local copy
// takes the stored one), written on connect and disconnect. Sign out leaves it alone.
const STORE_REPO = "freeagent-account";
const STORE_PATH = "accounts.json";
let storeSha = null;
const storeUrl = () => `/repos/${user.github}/${STORE_REPO}/contents/${STORE_PATH}`;

async function storeRead() {
  try {
    const f = await api("github", storeUrl());
    storeSha = f.sha;
    return JSON.parse(atob(f.content.replace(/\n/g, "")));
  } catch (e) {
    if (e.status === 404) { storeSha = null; return null; }
    throw e;
  }
}

async function storeWrite(data) {
  const put = () => api("github", storeUrl(), { method: "PUT", body: JSON.stringify({ message: "freeagent: connected accounts", content: btoa(JSON.stringify(data)), ...(storeSha ? { sha: storeSha } : {}) }) });
  try {
    storeSha = (await put()).content.sha;
  } catch (e) {
    if (e.status === 404) {
      // No repository yet: make it (private) and write again. Contents PUT creates the first commit.
      await api("github", "/user/repos", { method: "POST", body: JSON.stringify({ name: STORE_REPO, private: true, description: "freeagent: connected accounts. Private. Do not share.", has_issues: false, has_wiki: false, has_projects: false, auto_init: false }) });
      storeSha = (await put()).content.sha;
    } else if (e.status === 409 || e.status === 422) {
      // Another device wrote first: take its sha and write once more.
      await storeRead();
      storeSha = (await put()).content.sha;
    } else throw e;
  }
}

/** A device with no local copy of a connected account takes the stored one. Local wins otherwise —
 * and a local connection the store does not know yet (connected before the store existed, or on a
 * device that was offline) is pushed up, so every device ends the sign-in with the same set. */
async function restoreConnected() {
  if (!user.github) return;
  let stored;
  try { stored = (await storeRead()) ?? {}; } catch { return; }
  let behind = false;
  for (const p of LINKED) {
    const t = stored[p];
    if (t?.token && t.scope === SCOPE_TAG[p] && !tokenOf(p)) storeToken(p, t.token);
    else if (tokenOf(p) && t?.token !== tokenOf(p)) behind = true;
  }
  if (behind) await saveConnected().catch(() => {});
}

/** Write what is connected right now. Called after a connect, a disconnect, or an expiry. */
async function saveConnected() {
  if (!user.github) return;
  const data = {};
  for (const p of LINKED) if (tokenOf(p)) data[p] = { token: tokenOf(p), scope: SCOPE_TAG[p] };
  await storeWrite(data);
}

// Provider marks: GitHub's mark (Octicons, MIT) as inline SVG in the tile's text colour; Hugging Face's
// own logo file, which is a colour mark and stays one.
const MARK = {
  github: '<svg viewBox="0 0 16 16" fill="currentColor" aria-label="GitHub" role="img"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"></path></svg>',
  hf: '<img src="images/huggingface.svg" alt="Hugging Face">',
};

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

function codespaceBox(c) {
  const [kind, label] = classify("github", c.state);
  return { p: "github", id: c.name, name: c.display_name || c.name, kind, label, raw: c.state, url: codespaceUrl(c.name), created: c.created_at, ...boxMeta(c.name) };
}
function spaceBox(id, createdAt, stage) {
  const [kind, label] = classify("hf", stage);
  return { p: "hf", id, name: id.split("/")[1], kind, label, raw: stage, url: spaceUrl(id), created: createdAt, ...boxMeta(id) };
}

async function loadBoxes() {
  const found = [];
  const jobs = [];
  if (user.github) jobs.push(api("github", "/user/codespaces?per_page=100").then(({ codespaces = [] }) => {
    for (const c of codespaces) {
      if (c.repository.full_name.toLowerCase() !== CFG.TEMPLATE_REPO.toLowerCase()) continue;
      found.push(codespaceBox(c));
    }
  }));
  if (user.hf) jobs.push(api("hf", `/api/spaces?author=${encodeURIComponent(user.hf)}&full=true&limit=100`).then(async (spaces) => {
    const mine = spaces.filter((s) => s.sdk === "docker" && s.id !== CFG.TEMPLATE_SPACE && /freeagent/i.test(s.cardData?.title ?? ""));
    await Promise.all(mine.map(async (s) => {
      const rt = await api("hf", `/api/spaces/${s.id}/runtime`).catch(() => null);
      found.push(spaceBox(s.id, s.createdAt, rt?.stage));
    }));
  }));
  await Promise.all(jobs);

  // Deleted here, still listed there: hide it. Gone from the list: the provider caught up, forget it.
  const dead = tombstones();
  const listed = new Set(found.map((b) => b.id));
  for (const id of Object.keys(dead)) if (!listed.has(id)) dropTombstone(id);
  const kept = found.filter((b) => !dead[b.id]);

  // Created here, not listed yet: show it, and ask about it by name — that answer is current.
  const ghost = ghosts();
  await Promise.all(Object.values(ghost).map(async (g) => {
    if (listed.has(g.id)) { dropGhost(g.id); return; }
    if (!user[g.p]) return;
    try {
      const live = g.p === "github"
        ? codespaceBox(await api("github", `/user/codespaces/${g.id}`))
        : spaceBox(g.id, g.created, (await api("hf", `/api/spaces/${g.id}/runtime`))?.stage);
      kept.push(live);
    } catch (e) {
      if (e.status === 404 && Date.now() - g.at > 60000) dropGhost(g.id); // never materialised
      else kept.push({ ...g, kind: "pending", label: "Provisioning" });
    }
  }));

  // Pending first, then newest.
  kept.sort((a, b) => (a.kind === "pending") === (b.kind === "pending") ? (b.created ?? "").localeCompare(a.created ?? "") : (a.kind === "pending" ? -1 : 1));
  boxes = kept;
}

function renderCards() {
  const root = $("cards"); root.textContent = "";
  for (const b of boxes) {
    const el = document.createElement("div");
    const pressable = b.kind === "running" || b.kind === "stopped";
    el.className = "tile" + (pressable ? " pressable" : "");
    el.setAttribute("role", "button"); el.tabIndex = 0; el.setAttribute("aria-label", b.name);
    const note = busy[b.id];
    el.innerHTML = `
      <div class="top"><span class="dot ${b.kind}"></span><span class="tag">${MARK[b.p] ?? ""}</span></div>
      <div class="body"><div class="name"></div><div class="repo" hidden></div><div class="status ${note ? "pending" : b.kind}"></div></div>
      <div class="bar" hidden></div>`;
    el.querySelector(".name").textContent = b.name;
    el.querySelector(".status").textContent = note ?? b.label;
    if (b.repo) { const r = el.querySelector(".repo"); r.textContent = b.repo; r.hidden = false; }
    el.querySelector(".bar").hidden = !(b.kind === "pending" || note);
    if (!note) {
      const more = document.createElement("button"); more.className = "more"; more.setAttribute("aria-label", `Actions for ${b.name}`);
      more.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.6"></circle><circle cx="10" cy="10" r="1.6"></circle><circle cx="16" cy="10" r="1.6"></circle></svg>';
      more.onclick = (ev) => { ev.stopPropagation(); openBoxMenu(b); };
      el.appendChild(more);
    }
    const go = () => { if (!busy[b.id] && pressable) connect(b).catch((e) => { setBusy(b.id, null); showError(e.message); }); };
    el.onclick = go;
    el.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } };
    root.appendChild(el);
  }
}

// Box actions live in a bottom sheet, like everything else that used to be a dialog or a popover.
function openBoxMenu(b) {
  $("box-menu-title").textContent = b.name;
  const items = $("box-menu-items"); items.textContent = "";
  const add = (text, fn, cls = "") => { const btn = document.createElement("button"); btn.textContent = text; btn.className = cls; btn.onclick = () => { $("box-menu").close(); fn(); }; items.appendChild(btn); };
  add("Copy address", () => navigator.clipboard?.writeText(b.url).then(() => toast("Address copied")));
  if (b.p === "hf" && b.token) add("Copy Collie token", () => navigator.clipboard?.writeText(b.token).then(() => toast("Token copied")));
  add("Delete", () => confirmDelete(b), "danger");
  $("box-menu").showModal();
}

function setBusy(id, note) { if (note === null) delete busy[id]; else busy[id] = note; renderCards(); }
function showError(text) { $("list-error").textContent = text; }

// Tap a card: wake it if it is stopped, then open it in a NEW tab, so this page — the list of
// boxes, with each HF box's Collie token — stays put. The tab is opened synchronously, inside the
// tap, because a popup blocker only trusts window.open while the user gesture is live and waking a
// codespace takes a minute of awaits first; it is pointed at the box once the box is ready. A
// blocker that refuses even that (window.open answers null) falls back to navigating this tab.
// An HF box gets its Collie token in the fragment on every open — the PWA ignores it while its
// device token is still good, and re-pairs with it when the box has forgotten the phone.
async function connect(b) {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  const open = (url) => { if (tab && !tab.closed) tab.location.replace(url); else location.assign(url); };
  try {
    await wake(b);
  } catch (e) {
    tab?.close(); // a wake that failed leaves no orphan tab behind
    throw e;
  }
  setBusy(b.id, null);
  open(handoffUrl(b));
}

// Start a stopped codespace and wait until Herdr and Collie are up on it. An HF box wakes itself
// on the first request, so there is nothing to do for one.
async function wake(b) {
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
}

// What the box needs on first open, in the URL fragment (never sent to the server, stripped by the
// PWA once consumed). An HF box gets this device's GitHub token: the box knows its owner's login
// (FREEAGENT_GITHUB_OWNER) and pairs any device that proves it holds that sign-in, so every device
// signed in here gets in with nothing copied. The box's Collie token rides along when this browser
// has it (boxes created before owners existed, or a box whose owner variable is missing) as the
// fallback the PWA tries second. A codespace gets its repo to clone, plus the GitHub token when that
// repo is private. An HF box clones at boot from FREEAGENT_REPO, so it gets no repo here.
function handoffUrl(b) {
  const frag = new URLSearchParams();
  if (b.p === "hf") {
    if (tokenOf("github")) frag.set("gh", tokenOf("github"));
    if (b.token) frag.set("token", b.token);
  }
  if (b.p === "github" && b.repo && !b.cloned) {
    frag.set("repo", b.repo);
    if (b.priv && tokenOf("github")) frag.set("gh", tokenOf("github"));
    setBoxMeta(b.id, { cloned: true }); // once is enough; a reload must not clone twice
  }
  const q = frag.toString();
  return q ? `${b.url}#${q}` : b.url;
}

function confirmDelete(b) {
  $("confirm-text").textContent = `${b.name} and everything on it will be destroyed on the provider. This cannot be undone.`;
  $("confirm-ok").onclick = async () => {
    $("confirm").close();
    // The tile goes now; the provider hears about it next. If it refuses, the tile comes back.
    addTombstone(b.id); dropGhost(b.id);
    boxes = boxes.filter((x) => x.id !== b.id); renderCards(); renderAccounts();
    try {
      // keepalive: the request outlives a tab closed a moment after the tap, so a hidden tile never
      // stands for a delete that was never sent.
      if (b.p === "github") await api("github", `/user/codespaces/${b.id}`, { method: "DELETE", keepalive: true });
      else await api("hf", "/api/repos/delete", { method: "DELETE", keepalive: true, body: JSON.stringify({ type: "space", name: b.name }) });
      LS.del(`freeagent:box:${b.id}`);
      toast(`Deleted ${b.name}`);
    } catch (e) {
      if (e.status !== 404) { dropTombstone(b.id); toast(e.message); showError(e.message); }
    }
    pollFast();
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

let createProvider = "github";

function openCreate() {
  createProvider = user[createProvider] ? createProvider : "github";
  pickedRepo = null; nameSuggested = true;
  $("repo-picker-value").textContent = "None";
  $("create-name").value = randomName();
  $("create-error").textContent = "";
  renderProviderSeg();
  onProviderChange();
  $("create").showModal();
  if (repos === null) loadRepos().catch(() => {});
}

// Only connected accounts are offered; connecting one is the Accounts sheet's job.
function renderProviderSeg() {
  const seg = $("create-provider"); seg.textContent = "";
  for (const p of ["github", "hf"]) {
    if (!config[p] || !user[p]) continue;
    const b = document.createElement("button"); b.type = "button"; b.textContent = LABEL[p];
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(p === createProvider));
    b.onclick = () => { createProvider = p; renderProviderSeg(); onProviderChange(); };
    seg.appendChild(b);
  }
}

function onProviderChange() {
  $("machine-field").hidden = createProvider !== "github";
  $("visibility-field").hidden = createProvider !== "hf";
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
const repoIsPrivate = (full) => Boolean(repos?.find((r) => r.full === full)?.priv);

function openRepoSearch() {
  $("create-form").hidden = true; $("repo-search").hidden = false;
  $("repo-query").value = ""; renderRepoList(""); setTimeout(() => $("repo-query").focus(), 200);
}
function closeRepoSearch() { $("repo-search").hidden = true; $("create-form").hidden = false; }
function renderRepoList(q) {
  const list = $("repo-list"); list.textContent = "";
  const add = (text, priv, fn) => { const b = document.createElement("button"); b.type = "button"; b.innerHTML = `<span></span>${priv ? '<span class="lock" aria-label="Private">🔒</span>' : ""}`; b.querySelector("span").textContent = text; b.onclick = fn; list.appendChild(b); };
  if (q.trim() === "") add("None", false, () => pickRepo(null));
  if (repos === null) { const p = document.createElement("div"); p.className = "none"; p.textContent = "Loading repositories…"; list.appendChild(p); return; }
  const hits = repos.filter((r) => r.full.toLowerCase().includes(q.trim().toLowerCase()));
  for (const r of hits.slice(0, 200)) add(r.full, r.priv, () => pickRepo(r.full));
  if (hits.length === 0 && q.trim() !== "") { const p = document.createElement("div"); p.className = "none"; p.textContent = "No repository matches"; list.appendChild(p); }
}
function pickRepo(full) {
  pickedRepo = full;
  $("repo-picker-value").textContent = full ?? "None";
  if (nameSuggested) $("create-name").value = full ? nameFor(full) : randomName();
  closeRepoSearch();
}

async function submitCreate(ev) {
  ev.preventDefault();
  const p = createProvider;
  const name = $("create-name").value.trim();
  if (!NAME_RE.test(name)) { $("create-error").textContent = "Use only letters, numbers and hyphens"; return; }
  $("create-submit").disabled = true; $("create-error").textContent = "";
  try {
    const box = p === "github" ? await createCodespace(name) : await createSpace(name);
    if (pickedRepo) setBoxMeta(box.id, { repo: pickedRepo, priv: repoIsPrivate(pickedRepo) });
    addGhost({ ...box, ...boxMeta(box.id) });
    $("create").close();
    boxes = [{ ...box, ...boxMeta(box.id) }, ...boxes.filter((x) => x.id !== box.id)]; renderCards();
    pollFast();
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
  return codespaceBox(cs);
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
        // A private repository is cloned at boot with the GitHub token; a public one needs none.
        secrets: [{ key: "COLLIE_AUTH_TOKEN", value: collieToken }, ...(pickedRepo && repoIsPrivate(pickedRepo) && tokenOf("github") ? [{ key: "GITHUB_TOKEN", value: tokenOf("github") }] : [])],
        // The owner's GitHub login: the box pairs any device signed in to that account (Collie's
        // COLLIE_GITHUB_OWNER), which is what lets a second phone in without this token.
        variables: [{ key: "FREEAGENT_GITHUB_OWNER", value: user.github }, ...(pickedRepo ? [{ key: "FREEAGENT_REPO", value: pickedRepo }] : [])],
      }),
    });
  } catch (e) {
    if (e.status === 409) throw new Error("You already have a Space with that name.");
    throw e;
  }
  setBoxMeta(id, { token: collieToken });
  return spaceBox(id, new Date().toISOString(), "BUILDING");
}

// ---- Accounts ---------------------------------------------------------------------------------------------------
// crux-android's rules: the main account is never "disconnected" (sign out instead); a connected
// account with boxes on it cannot be disconnected until they are deleted, and the button says why.
function renderAccounts() {
  for (const p of PROVIDERS) {
    $(`acct-${p}`).hidden = !config[p];
    $(`acct-${p}-sub`).textContent = user[p] ?? "not connected";
    $(`acct-${p}-connect`).hidden = Boolean(user[p]);
    if (p === MAIN) continue;
    const btn = $(`acct-${p}-disconnect`);
    btn.hidden = !user[p];
    const has = boxes.filter((b) => b.p === p).length;
    btn.disabled = has > 0;
    btn.title = has > 0 ? `Delete this account's ${has === 1 ? "box" : "boxes"} first` : "";
  }
  $("signout").hidden = !user.github;
  $("accounts-open").hidden = !user.github;
  $("avatar-initial").textContent = (user.github ?? "?").slice(0, 1);
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
  const delay = Date.now() < fastUntil ? 1000 : pending ? 4000 : 30000;
  pollTimer = setTimeout(() => { if (!document.hidden) refresh(); else schedulePoll(); }, delay);
}

async function render() {
  await whoami(MAIN);
  await restoreConnected();
  await Promise.all(LINKED.map(whoami));
  renderAccounts();
  const signedIn = Boolean(user[MAIN]);
  $("signed-out").hidden = signedIn;
  $("boxes-view").hidden = !signedIn;
  $("new-box").hidden = !signedIn;
  if (!signedIn) { clearTimeout(pollTimer); window.Galaxy?.start($("galaxy")); window.Sky?.start($("stars")); startTrails(); return; }
  window.Galaxy?.stop(); window.Sky?.stop(); window.Trails?.stop();
  if (boxes.length === 0 && !$("cards").hasChildNodes()) $("skeleton").hidden = false;
  await refresh();
  $("skeleton").hidden = true;
}

async function main() {
  await Promise.all(PROVIDERS.map(detect));
  if (!config.github) { $("signed-out").hidden = false; window.Galaxy?.start($("galaxy")); window.Sky?.start($("stars")); startTrails(); $("signed-out-error").textContent = "GitHub sign-in is not configured on this deployment."; return; }

  $("signin-github").onclick = () => signIn("github");
  $("new-box").onclick = openCreate;
  $("repo-picker").onclick = openRepoSearch;
  $("repo-cancel").onclick = closeRepoSearch;
  $("repo-query").oninput = (ev) => renderRepoList(ev.target.value);
  $("create-name").oninput = () => { nameSuggested = false; };
  $("create-form").onsubmit = submitCreate;
  $("create-cancel").onclick = () => $("create").close();
  $("accounts-open").onclick = () => { renderAccounts(); $("accounts").showModal(); };
  $("accounts-close").onclick = () => $("accounts").close();
  $("acct-github-connect").onclick = () => signIn("github");
  $("acct-hf-connect").onclick = () => signIn("hf");
  $("acct-hf-disconnect").onclick = async () => { dropToken("hf"); $("accounts").close(); await saveConnected().catch((e) => toast(e.message)); toast("Hugging Face disconnected"); render(); };
  $("acct-railway-connect").onclick = () => { $("accounts").close(); $("railway-token").value = ""; $("railway-error").textContent = ""; $("railway").showModal(); };
  $("acct-railway-disconnect").onclick = () => { dropToken("railway"); toast("Railway disconnected"); $("accounts").close(); render(); };
  $("railway-cancel").onclick = () => $("railway").close();
  $("railway-form").onsubmit = async (ev) => {
    ev.preventDefault();
    $("railway-submit").disabled = true; $("railway-error").textContent = "";
    try {
      const me = await railwayWhoami($("railway-token").value.trim());
      storeToken("railway", $("railway-token").value.trim());
      $("railway").close(); toast(`Railway connected as ${me.name}`); await saveConnected().catch(() => {}); await render();
    } catch (e) { $("railway-error").textContent = e.message; }
    $("railway-submit").disabled = false;
  };
  $("signout").onclick = () => { for (const p of PROVIDERS) dropToken(p); toast("Signed out"); $("accounts").close(); render(); };
  $("box-menu-close").onclick = () => $("box-menu").close();
  $("confirm-cancel").onclick = () => $("confirm").close();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && user[MAIN]) refresh(); });

  const params = new URLSearchParams(location.search);
  if (params.get("error")) { history.replaceState(null, "", "/"); $("signed-out-error").textContent = `Sign-in failed: ${params.get("error_description") ?? params.get("error")}`; }
  let intent = null, via = null;
  if (params.get("code")) {
    try { const tx = await finishSignIn(params); intent = tx.intent; via = tx.p; toast(via === MAIN ? "Signed in" : `${LABEL[via]} connected`); } catch (e) { $("signed-out-error").textContent = e.message; }
  }
  await render();
  if (via && via !== MAIN) saveConnected().catch((e) => toast(e.message));
  if (intent === "create" && user[MAIN]) openCreate();
}

main().catch((e) => { $("signed-out").hidden = false; $("signed-out-error").textContent = e.message; });
