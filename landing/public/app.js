// freeagent landing page: accounts, your boxes, and creating a new one — without any backend of
// ours holding state. Tokens live in this browser's localStorage; boxes are read live from the
// providers; the only server code is the two tiny Pages Functions that swap OAuth codes for tokens
// (GitHub's token endpoint has no CORS; a hand-registered HF app is confidential).
//
//   GitHub  → a Codespace from the freeagent repo. Its forwarded port is private to the GitHub
//             account, so that IS the auth; nothing to hand over.
//   HF      → a duplicate of the template Space with a fresh COLLIE_AUTH_TOKEN secret, opened
//             once with #token= for Collie to pair the phone.

const CFG = window.FREEAGENT;
const HF = "https://huggingface.co";
const GH_API = "https://api.github.com";
const S = window.sessionStorage; // in-flight OAuth transaction only
const LS = window.localStorage; // signed-in tokens
const KEY = { gh: "fa:gh_token", hf: "fa:hf_token" };

const SPACE_VARS = window.huggingface?.variables ?? {};
const EMBEDDED = window.top !== window.self;

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const el of document.querySelectorAll("[data-step]")) el.hidden = el.dataset.step !== id;
};
const fail = (message) => {
  $("error-text").textContent = message;
  show("error");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
const tokenOf = (p) => { try { return LS.getItem(KEY[p]); } catch { return null; } };
const setToken = (p, t) => { try { LS.setItem(KEY[p], t); } catch { /* private mode */ } };
const dropToken = (p) => { try { LS.removeItem(KEY[p]); } catch { /* */ } };

// ---- Provider configuration -----------------------------------------------------------------------
// Where this host's Pages Functions answer, sign-in for that provider is "hosted": the Function
// holds the app secret and does the code exchange, and it tells us the exact redirect_uri that is
// registered. Otherwise HF may still work directly as a public client (the HF static Space injects
// its own client id; config.js may carry one), and GitHub is unavailable.
let AUTH = { gh: null, hf: null };
async function hostedConfig(provider) {
  try {
    const res = await fetch(`/api/auth/${provider === "gh" ? "github" : "hf"}/config`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (typeof json.client_id !== "string" || !json.client_id) return null;
    return { clientId: json.client_id, redirect: json.redirect_uri || `${location.origin}/`, hosted: true };
  } catch {
    return null;
  }
}
async function resolveAuth() {
  const [gh, hfHosted] = await Promise.all([hostedConfig("gh"), hostedConfig("hf")]);
  let hf = hfHosted;
  if (!hf) {
    const direct = SPACE_VARS.OAUTH_CLIENT_ID || CFG.HF_CLIENT_ID;
    if (direct && !direct.startsWith("REPLACE")) hf = { clientId: direct, redirect: `${location.origin}/`, hosted: false };
  }
  AUTH = { gh, hf };
}

// ---- OAuth: start and finish ----------------------------------------------------------------------
async function startSignIn(provider, intent) {
  const auth = AUTH[provider];
  if (!auth) { fail("That sign-in is not configured on this host."); return; }
  if (EMBEDDED) { window.open(location.href, "_blank", "noopener"); return; }
  const state = random(16);
  const tx = { provider, state, intent, redirect: auth.redirect, clientId: auth.clientId, hosted: auth.hosted };
  let url;
  if (provider === "gh") {
    url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({ client_id: auth.clientId, redirect_uri: auth.redirect, scope: "codespace", state }).toString();
  } else {
    tx.verifier = random(32);
    url = new URL(`${HF}/oauth/authorize`);
    url.search = new URLSearchParams({
      client_id: auth.clientId,
      redirect_uri: auth.redirect,
      response_type: "code",
      scope: SPACE_VARS.OAUTH_SCOPES || CFG.HF_SCOPES,
      state,
      code_challenge: b64url(await sha256(tx.verifier)),
      code_challenge_method: "S256",
    }).toString();
  }
  S.setItem("oauth", JSON.stringify(tx));
  location.assign(url.toString());
}

async function finishSignIn(params, tx) {
  if (tx.state !== params.get("state")) throw new Error("Sign-in state mismatch. Please start again.");
  const code = params.get("code");
  let res;
  if (tx.provider === "gh") {
    res = await fetch("/api/auth/github/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: tx.redirect }),
    });
  } else if (tx.hosted) {
    res = await fetch("/api/auth/hf/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: tx.redirect, code_verifier: tx.verifier }),
    });
  } else {
    res = await fetch(`${HF}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: tx.clientId, grant_type: "authorization_code", code, redirect_uri: tx.redirect, code_verifier: tx.verifier }),
    });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`${tx.provider === "gh" ? "GitHub" : "Hugging Face"} refused the sign-in: ${body.error_description || body.error || res.status}`);
  if (tx.provider === "gh" && body.scope && !/\bcodespace\b/.test(body.scope)) throw new Error("GitHub did not grant the codespace permission. Please sign in again and allow it.");
  setToken(tx.provider, body.access_token);
  // Back to the page's root, whatever callback path we landed on.
  history.replaceState(null, "", "/");
}

// ---- API clients ----------------------------------------------------------------------------------
async function call(provider, path, init = {}) {
  const base = provider === "gh" ? GH_API : HF;
  const headers = {
    authorization: `Bearer ${tokenOf(provider)}`,
    ...(provider === "gh" ? { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } : {}),
    ...(init.body ? { "content-type": "application/json" } : {}),
    ...init.headers,
  };
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (res.status === 401) {
    dropToken(provider);
    const err = new Error("signed out (token expired or revoked)");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(json?.message ?? json?.error ?? text ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}
const gh = (path, init) => call("gh", path, init);
const hf = (path, init) => call("hf", path, init);

const spaceHost = (id) => `https://${id.replace("/", "-").toLowerCase().replace(/[^a-z0-9-]/g, "-")}.hf.space`;
const codespaceUrl = (name) => `https://${name}-7860.${CFG.CODESPACES_PORT_DOMAIN}/`;

// ---- Home: accounts and boxes ------------------------------------------------------------------------
const PROFILE = { gh: null, hf: null };

async function loadProfile(provider) {
  if (!tokenOf(provider)) { PROFILE[provider] = null; return; }
  try {
    PROFILE[provider] = provider === "gh" ? (await gh("/user")).login : (await hf("/api/whoami-v2")).name;
  } catch {
    PROFILE[provider] = null;
  }
}

function renderAccounts() {
  for (const p of ["gh", "hf"]) {
    const row = $(`${p}-row`);
    row.hidden = !AUTH[p];
    if (!AUTH[p]) continue;
    const who = $(`${p}-who`);
    const on = PROFILE[p] !== null;
    who.textContent = on ? `signed in as ${PROFILE[p]}` : "not signed in";
    who.classList.toggle("on", on);
    $(`${p}-signin`).hidden = on;
    $(`${p}-signout`).hidden = !on;
  }
  $("create-github").hidden = !AUTH.gh;
  $("create-hf").hidden = !AUTH.hf;
  $("create-hf").classList.toggle("primary", !AUTH.gh);
  $("create-hf").classList.toggle("ghost", Boolean(AUTH.gh));
}

async function listBoxes() {
  const boxes = [];
  const jobs = [];
  if (PROFILE.gh) {
    jobs.push(gh("/user/codespaces?per_page=100").then((r) => {
      for (const c of r.codespaces ?? []) {
        if (c.repository?.full_name?.toLowerCase() !== CFG.TEMPLATE_REPO.toLowerCase()) continue;
        boxes.push({ provider: "gh", id: c.name, label: c.display_name || c.name, state: c.state, url: codespaceUrl(c.name), manage: c.web_url });
      }
    }).catch(() => {}));
  }
  if (PROFILE.hf) {
    jobs.push(hf(`/api/spaces?author=${encodeURIComponent(PROFILE.hf)}&full=true&limit=100`).then(async (list) => {
      const mine = (list ?? []).filter((s) => s.sdk === "docker" && s.id !== CFG.TEMPLATE_SPACE && (s.cardData?.title ?? "").toLowerCase().includes("freeagent"));
      await Promise.all(mine.map(async (s) => {
        const rt = await hf(`/api/spaces/${s.id}/runtime`).catch(() => null);
        boxes.push({ provider: "hf", id: s.id, label: s.id.split("/")[1], state: rt?.stage ?? "?", url: `${spaceHost(s.id)}/`, manage: `${HF}/spaces/${s.id}` });
      }));
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  boxes.sort((a, b) => a.label.localeCompare(b.label));
  return boxes;
}

function renderBoxes(boxes) {
  const root = $("boxes");
  root.textContent = "";
  const note = $("boxes-note");
  if (!PROFILE.gh && !PROFILE.hf) { note.textContent = "Sign in to see your boxes."; return; }
  note.textContent = boxes.length ? "" : "No boxes yet.";
  for (const b of boxes) {
    const el = document.createElement("div");
    el.className = "box";
    el.innerHTML = `
      <div class="title"><span class="name"></span><span class="meta"></span></div>
      <div class="meta"><a class="manage" target="_blank" rel="noopener"></a></div>
      <div class="actions"><button class="small primary open">Open</button><button class="small ghost danger delete">Delete</button></div>`;
    el.querySelector(".name").textContent = b.label;
    el.querySelector(".title .meta").textContent = `${b.provider === "gh" ? "Codespace" : "Space"} · ${b.state}`;
    const manage = el.querySelector(".manage");
    manage.href = b.manage; manage.textContent = b.provider === "gh" ? "on github.com" : b.id;
    el.querySelector(".open").addEventListener("click", () => openBox(b).catch((e) => fail(e.message)));
    el.querySelector(".delete").addEventListener("click", () => deleteBox(b).catch((e) => fail(e.message)));
    root.appendChild(el);
  }
}

async function openBox(b) {
  if (b.provider === "gh" && b.state !== "Available") {
    show("creating");
    $("creating-text").textContent = "Waking your codespace…";
    await gh(`/user/codespaces/${b.id}/start`, { method: "POST" }).catch((e) => { if (e.status !== 409) throw e; });
    const started = Date.now();
    let state = b.state;
    while (state !== "Available" && Date.now() - started < 5 * 60_000) {
      await sleep(4000);
      state = (await gh(`/user/codespaces/${b.id}`).catch(() => null))?.state ?? state;
      $("creating-text").textContent = `Waking your codespace… (${state})`;
    }
    for (let i = 20; i > 0; i -= 1) { $("creating-text").textContent = `Starting Herdr and Collie… (${i}s)`; await sleep(1000); }
  }
  location.assign(b.url);
}

async function deleteBox(b) {
  const what = b.provider === "gh" ? `codespace ${b.label}` : `Space ${b.id}`;
  if (!window.confirm(`Delete ${what}? Agent sign-ins and any uncommitted code on it are lost.`)) return;
  if (b.provider === "gh") {
    await gh(`/user/codespaces/${b.id}`, { method: "DELETE" });
  } else {
    await hf("/api/repos/delete", { method: "DELETE", body: JSON.stringify({ type: "space", name: b.id.split("/")[1] }) });
  }
  await home();
}

async function home() {
  show("home");
  await Promise.all([loadProfile("gh"), loadProfile("hf")]);
  renderAccounts();
  $("boxes").textContent = "";
  $("boxes-note").textContent = PROFILE.gh || PROFILE.hf ? "Loading your boxes…" : "Sign in to see your boxes.";
  renderBoxes(await listBoxes());
}

// ---- Create -------------------------------------------------------------------------------------------
const sanitizeName = (raw) => raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");

function nameStep(provider) {
  $("who").textContent = PROFILE[provider] ?? "";
  $("name-input").value = CFG.DEFAULT_NAME;
  $("name-error").textContent = "";
  $("name-label").textContent = provider === "gh" ? "Codespace name" : "Space name";
  $("name-hint-github").hidden = provider !== "gh";
  $("name-hint-hf").hidden = provider !== "hf";
  $("name-form").onsubmit = (ev) => {
    ev.preventDefault();
    const name = sanitizeName($("name-input").value);
    if (!name) { $("name-error").textContent = "Give it a name."; return; }
    const run = provider === "gh" ? createCodespace(name) : createSpace(PROFILE.hf, name);
    run.catch((e) => fail(e.message));
  };
  show("name");
}

async function createCodespace(name) {
  show("creating");
  $("creating-text").textContent = "Creating your codespace…";
  const repo = await gh(`/repos/${CFG.TEMPLATE_REPO}`);
  let cs;
  try {
    cs = await gh("/user/codespaces", {
      method: "POST",
      body: JSON.stringify({
        repository_id: repo.id,
        ref: repo.default_branch,
        machine: CFG.CODESPACE_MACHINE,
        display_name: name,
        idle_timeout_minutes: CFG.CODESPACE_IDLE_MINUTES,
        devcontainer_path: ".devcontainer/devcontainer.json",
      }),
    });
  } catch (err) {
    if (err.status === 403 || err.status === 404) throw new Error(`GitHub would not create a codespace: ${err.message}. If you have hit the free quota, or Codespaces is disabled for your account, try a Hugging Face Space instead.`);
    throw err;
  }
  const started = Date.now();
  let state = cs.state ?? "Queued";
  while (Date.now() - started < 20 * 60_000 && state !== "Available") {
    await sleep(5000);
    state = (await gh(`/user/codespaces/${cs.name}`).catch(() => null))?.state ?? state;
    $("creating-text").textContent = `${codespaceStageText(state)} (${Math.round((Date.now() - started) / 1000)}s)`;
    if (["Failed", "Deleted"].includes(state)) throw new Error(`The codespace ended in state ${state}.`);
  }
  if (state !== "Available") throw new Error("The codespace did not become available within 20 minutes. Check github.com/codespaces.");
  for (let i = 30; i > 0; i -= 1) { $("creating-text").textContent = `Starting Herdr and Collie… (${i}s)`; await sleep(1000); }
  const url = codespaceUrl(cs.name);
  $("open-link").href = url;
  $("resource-link").href = cs.web_url ?? "https://github.com/codespaces";
  $("resource-link").textContent = cs.name;
  $("done-note").textContent = "The port is private to your GitHub account: your browser's GitHub sign-in is the key. Add Collie to your home screen when it offers, then tap a launcher to start an agent.";
  $("token-block").hidden = true;
  show("done");
  setTimeout(() => location.assign(url), 2500);
}

function codespaceStageText(state) {
  switch (state) {
    case "Queued": case "Provisioning": return "Building your codespace";
    case "Starting": return "Starting your codespace";
    case "Available": return "Ready";
    default: return `Waiting for GitHub (${state})`;
  }
}

async function createSpace(user, name) {
  const collieToken = random(32);
  show("creating");
  $("creating-text").textContent = `Creating ${user}/${name} on your Hugging Face account…`;
  try {
    await hf(`/api/spaces/${CFG.TEMPLATE_SPACE}/duplicate`, {
      method: "POST",
      body: JSON.stringify({
        repository: `${user}/${name}`,
        visibility: "public",
        hardware: "cpu-basic",
        secrets: [{ key: "COLLIE_AUTH_TOKEN", value: collieToken, description: "Collie root credential (Variant F)" }],
        variables: [],
      }),
    });
  } catch (err) {
    if (err.status === 409) { nameStep("hf"); $("name-error").textContent = `You already have a Space called ${name}. Pick another name.`; return; }
    throw err;
  }
  const started = Date.now();
  let stage = "STARTING";
  while (Date.now() - started < 20 * 60_000) {
    stage = (await hf(`/api/spaces/${user}/${name}/runtime`).catch(() => null))?.stage ?? stage;
    $("creating-text").textContent = `${spaceStageText(stage)} (${Math.round((Date.now() - started) / 1000)}s)`;
    if (stage === "RUNNING") break;
    if (["BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR"].includes(stage)) throw new Error(`The Space ended in ${stage}. Open https://huggingface.co/spaces/${user}/${name} to see its logs.`);
    await sleep(5000);
  }
  if (stage !== "RUNNING") throw new Error("The Space did not come up within 20 minutes. It may still be building; open it from your Hugging Face profile.");
  const url = `${spaceHost(`${user}/${name}`)}/#token=${collieToken}`;
  $("open-link").href = url;
  $("resource-link").href = `${HF}/spaces/${user}/${name}`;
  $("resource-link").textContent = `${user}/${name}`;
  $("done-note").textContent = "Opening it now. Add Collie to your home screen when it offers, then tap a launcher to start an agent.";
  $("token-text").textContent = collieToken;
  $("token-block").hidden = false;
  show("done");
  setTimeout(() => location.assign(url), 2500);
}

function spaceStageText(stage) {
  switch (stage) {
    case "BUILDING": case "APP_STARTING": case "RUNNING_BUILDING": return "Building your box";
    case "RUNNING": return "Running";
    default: return `Waiting for Hugging Face (${stage})`;
  }
}

// ---- Wiring -----------------------------------------------------------------------------------------
async function main() {
  const onPagesHost = /\.pages\.dev$/.test(location.hostname);
  if (onPagesHost && CFG.CANONICAL_ORIGIN && location.origin !== CFG.CANONICAL_ORIGIN) {
    location.replace(CFG.CANONICAL_ORIGIN + "/" + location.search + location.hash);
    return;
  }
  $("repo-link").href = CFG.REPO_URL;
  $("retry").addEventListener("click", () => { S.clear(); history.replaceState(null, "", "/"); home().catch((e) => fail(e.message)); });
  $("done-home").addEventListener("click", () => home().catch((e) => fail(e.message)));
  $("name-back").addEventListener("click", () => home().catch((e) => fail(e.message)));
  $("copy-token").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("token-text").textContent); $("copy-token").textContent = "Copied"; } catch { /* no clipboard */ }
  });
  for (const p of ["gh", "hf"]) {
    $(`${p}-signin`).addEventListener("click", () => startSignIn(p, "home").catch((e) => fail(e.message)));
    $(`${p}-signout`).addEventListener("click", () => { dropToken(p); home().catch((e) => fail(e.message)); });
  }
  $("create-github").addEventListener("click", () => (PROFILE.gh ? nameStep("gh") : startSignIn("gh", "create").catch((e) => fail(e.message))));
  $("create-hf").addEventListener("click", () => (PROFILE.hf ? nameStep("hf") : startSignIn("hf", "create").catch((e) => fail(e.message))));

  await resolveAuth();
  if (!AUTH.gh && !AUTH.hf) { fail("This page is not configured for any provider yet."); return; }

  const params = new URLSearchParams(location.search);
  if (params.get("error")) { history.replaceState(null, "", "/"); fail(`Sign-in failed: ${params.get("error_description") ?? params.get("error")}`); return; }
  if (params.get("code")) {
    show("signing-in");
    const tx = JSON.parse(S.getItem("oauth") ?? "null");
    S.removeItem("oauth");
    try {
      if (!tx) throw new Error("This sign-in did not start here. Please start again.");
      await finishSignIn(params, tx);
    } catch (e) { history.replaceState(null, "", "/"); fail(e.message); return; }
    await loadProfile(tx.provider);
    if (tx.intent === "create" && PROFILE[tx.provider]) { await Promise.all([loadProfile("gh"), loadProfile("hf")]); renderAccounts(); nameStep(tx.provider); return; }
  }
  await home();
}

main().catch((e) => fail(e.message));
