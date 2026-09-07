// freeagent landing page. Two ways to get a box, both without any backend of ours holding state:
//
//   GitHub → a Codespace  (default)  Sign in with GitHub, create a codespace from the freeagent
//                                    repo, wait until it is Available, open its forwarded port.
//                                    The port is private to the GitHub account, so that IS the
//                                    auth; no token to hand over. Needs one Pages Function to swap
//                                    the OAuth code for a token (GitHub's token endpoint has no
//                                    CORS and needs the app secret) — see functions/api/auth/github.
//   Hugging Face → a Space           Sign in with HF (PKCE, in the browser), duplicate the template
//                                    Space with a fresh COLLIE_AUTH_TOKEN secret, wait for RUNNING,
//                                    open it with #token= for Collie to consume.
//
// GitHub is offered only where /api/auth/github/config answers (Cloudflare Pages with the client id
// set); on the HF static Space or plain static hosts the page shows Hugging Face alone.

const CFG = window.FREEAGENT;
const HF = "https://huggingface.co";
const GH_API = "https://api.github.com";
const S = window.sessionStorage;

// On a Hugging Face static Space with `hf_oauth: true`, the platform injects the OAuth app it
// provisioned for this exact host as `window.huggingface.variables`. Elsewhere config.js supplies
// a client id registered for that origin.
const SPACE_VARS = window.huggingface?.variables ?? {};
const HF_SCOPES = SPACE_VARS.OAUTH_SCOPES || CFG.HF_SCOPES;
// Resolved at start-up: { clientId, hosted } — `hosted` means this host's Pages Function holds the
// app secret and does the code exchange; otherwise the page exchanges directly (public client).
let HF_AUTH = null;
async function resolveHfAuth() {
  const hosted = await hostedClientId("hf");
  if (hosted) return { clientId: hosted, hosted: true };
  const direct = SPACE_VARS.OAUTH_CLIENT_ID || CFG.HF_CLIENT_ID;
  if (direct && !direct.startsWith("REPLACE")) return { clientId: direct, hosted: false };
  return null;
}
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
// Always the origin root with a trailing slash — never /index.html or a preview host — because
// this exact string is what the OAuth apps have registered as their callback.
const redirectUri = () => `${location.origin}/`;

// ---- crypto helpers ----------------------------------------------------------------------------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// ---- Host-provided sign-in config ---------------------------------------------------------------
// On Cloudflare Pages the Functions under /api/auth/<provider>/ answer with a public client id
// when that provider's secret is configured on the project; anywhere else they 404.
async function hostedClientId(provider) {
  try {
    const res = await fetch(`/api/auth/${provider}/config`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json.client_id === "string" && json.client_id ? json.client_id : null;
  } catch {
    return null;
  }
}
const githubAvailable = () => hostedClientId("github");

// ---- GitHub: sign in -----------------------------------------------------------------------------

function startGitHub(clientId) {
  const state = random(16);
  S.setItem("oauth", JSON.stringify({ provider: "github", state }));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: "codespace",
    state,
  }).toString();
  location.assign(url.toString());
}

async function finishGitHub(params, saved) {
  if (saved.state !== params.get("state")) throw new Error("Sign-in state mismatch. Please start again.");
  const res = await fetch("/api/auth/github/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: params.get("code"), redirect_uri: redirectUri() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub refused the sign-in: ${body.error_description || body.error || res.status}`);
  if (!/\bcodespace\b/.test(body.scope ?? "codespace")) throw new Error("GitHub did not grant the codespace permission. Please start again and allow it.");
  S.setItem("gh_token", body.access_token);
  S.setItem("provider", "github");
  history.replaceState(null, "", redirectUri());
}

async function gh(path, init = {}) {
  const res = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${S.getItem("gh_token")}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.message ?? text ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---- GitHub: create the codespace ---------------------------------------------------------------
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
    if (err.status === 403 || err.status === 404) {
      throw new Error(`GitHub would not create a codespace: ${err.message}. If you have hit the free quota, or Codespaces is disabled for your account, try the Hugging Face option instead.`);
    }
    throw err;
  }
  // Provisioning → Starting → Available. The first boot of this image on a fresh codespace takes a
  // few minutes (it builds the Docker image); resumes take about 20 seconds.
  const started = Date.now();
  let state = cs.state ?? "Queued";
  while (Date.now() - started < 20 * 60_000 && state !== "Available") {
    await sleep(5000);
    const current = await gh(`/user/codespaces/${cs.name}`).catch(() => null);
    state = current?.state ?? state;
    $("creating-text").textContent = `${codespaceStageText(state)} (${Math.round((Date.now() - started) / 1000)}s)`;
    if (["Failed", "Deleted", "Rebuilding"].includes(state)) throw new Error(`The codespace ended in state ${state}.`);
  }
  if (state !== "Available") throw new Error("The codespace did not become available within 20 minutes. Open github.com/codespaces to check on it.");
  // The servers start from postStartCommand once the codespace is up; give them a moment so the
  // first request does not meet the forwarder's "nothing listening" page.
  for (let i = 30; i > 0; i -= 1) {
    $("creating-text").textContent = `Starting Herdr and Collie… (${i}s)`;
    await sleep(1000);
  }
  const url = `https://${cs.name}-7860.${CFG.CODESPACES_PORT_DOMAIN}/`;
  S.removeItem("gh_token");
  $("open-link").href = url;
  $("resource-link").href = cs.web_url ?? `https://github.com/codespaces`;
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

// ---- Hugging Face: sign in ---------------------------------------------------------------------
async function startHuggingFace() {
  if (!HF_AUTH) {
    fail("Hugging Face sign-in is not configured on this host (no OAuth client id).");
    return;
  }
  const verifier = random(32);
  const state = random(16);
  S.setItem("oauth", JSON.stringify({ provider: "huggingface", state, verifier, hosted: HF_AUTH.hosted, clientId: HF_AUTH.clientId }));
  const url = new URL(`${HF}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: HF_AUTH.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: HF_SCOPES,
    state,
    code_challenge: b64url(await sha256(verifier)),
    code_challenge_method: "S256",
  }).toString();
  location.assign(url.toString());
}

async function finishHuggingFace(params, saved) {
  if (saved.state !== params.get("state")) throw new Error("Sign-in state mismatch. Please start again.");
  const res = saved.hosted
    ? await fetch("/api/auth/hf/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: params.get("code"), redirect_uri: redirectUri(), code_verifier: saved.verifier }),
      })
    : await fetch(`${HF}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: saved.clientId,
          grant_type: "authorization_code",
          code: params.get("code"),
          redirect_uri: redirectUri(),
          code_verifier: saved.verifier,
        }),
      });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Hugging Face refused the sign-in: ${body.error_description ?? body.error ?? res.status}`);
  S.setItem("hf_token", body.access_token);
  S.setItem("provider", "huggingface");
  history.replaceState(null, "", redirectUri());
}

async function hf(path, init = {}) {
  const res = await fetch(`${HF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${S.getItem("hf_token")}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(json?.error ?? text ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const spaceHost = (user, name) => `https://${`${user}-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.hf.space`;

// ---- Hugging Face: duplicate the template ---------------------------------------------------------
async function createSpace(user, name) {
  const collieToken = random(32); // 43 chars of base64url — the box's root credential
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
    if (err.status === 409) {
      show("name");
      $("name-error").textContent = `You already have a Space called ${name}. Pick another name.`;
      return;
    }
    throw err;
  }
  const started = Date.now();
  let stage = "STARTING";
  while (Date.now() - started < 20 * 60_000) {
    const runtime = await hf(`/api/spaces/${user}/${name}/runtime`).catch(() => null);
    stage = runtime?.stage ?? stage;
    $("creating-text").textContent = `${spaceStageText(stage)} (${Math.round((Date.now() - started) / 1000)}s)`;
    if (stage === "RUNNING") break;
    if (["BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR"].includes(stage)) {
      throw new Error(`The Space ended in ${stage}. Open https://huggingface.co/spaces/${user}/${name} to see its logs.`);
    }
    await sleep(5000);
  }
  if (stage !== "RUNNING") throw new Error("The Space did not come up within 20 minutes. It may still be building; open it from your Hugging Face profile.");
  S.removeItem("hf_token");
  const url = `${spaceHost(user, name)}/#token=${collieToken}`;
  $("open-link").href = url;
  $("resource-link").href = `https://huggingface.co/spaces/${user}/${name}`;
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

// ---- Wiring ---------------------------------------------------------------------------------------
const sanitizeName = (raw) => raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");

async function main() {
  // A Pages default or preview host is not the registered OAuth origin: go to the canonical one
  // (query and fragment preserved) before anything else. The HF static Space is its own origin
  // with its own platform-provisioned OAuth app, so it is left alone.
  const onPagesHost = /\.pages\.dev$/.test(location.hostname);
  if (onPagesHost && CFG.CANONICAL_ORIGIN && location.origin !== CFG.CANONICAL_ORIGIN) {
    location.replace(CFG.CANONICAL_ORIGIN + "/" + location.search + location.hash);
    return;
  }
  $("repo-link").href = CFG.REPO_URL;
  $("retry").addEventListener("click", () => { S.clear(); location.assign(redirectUri()); });
  $("copy-token").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("token-text").textContent); $("copy-token").textContent = "Copied"; } catch { /* no clipboard */ }
  });

  const params = new URLSearchParams(location.search);
  if (params.get("error")) { fail(`Sign-in failed: ${params.get("error_description") ?? params.get("error")}`); return; }
  if (params.get("code")) {
    show("signing-in");
    const saved = JSON.parse(S.getItem("oauth") ?? "null");
    S.removeItem("oauth");
    try {
      if (!saved) throw new Error("This sign-in did not start here. Please start again.");
      if (saved.provider === "github") await finishGitHub(params, saved);
      else await finishHuggingFace(params, saved);
    } catch (e) { fail(e.message); return; }
  }

  const provider = S.getItem("provider");
  if (provider === "github" && S.getItem("gh_token")) return nameStep("github");
  if (provider === "huggingface" && S.getItem("hf_token")) return nameStep("huggingface");

  // Start: GitHub is the default where this host can complete its sign-in; Hugging Face otherwise.
  const [ghClientId, hfAuth] = await Promise.all([githubAvailable(), resolveHfAuth()]);
  HF_AUTH = hfAuth;
  const hfReady = hfAuth !== null;
  $("start-github").hidden = !ghClientId;
  $("start-hf").hidden = !hfReady;
  $("start-hf").classList.toggle("primary", !ghClientId);
  $("start-hf").classList.toggle("ghost", Boolean(ghClientId));
  if (!ghClientId && !hfReady) { fail("This page is not configured for any provider yet."); return; }
  $("start-github").addEventListener("click", () => {
    if (EMBEDDED) { window.open(location.href, "_blank", "noopener"); return; }
    startGitHub(ghClientId);
  });
  $("start-hf").addEventListener("click", () => {
    if (EMBEDDED) { window.open(location.href, "_blank", "noopener"); return; }
    startHuggingFace().catch((e) => fail(e.message));
  });
  show("start");
}

async function nameStep(provider) {
  let who;
  try {
    who = provider === "github" ? (await gh("/user")).login : (await hf("/api/whoami-v2")).name;
  } catch (e) {
    S.clear();
    fail(`Could not read your ${provider === "github" ? "GitHub" : "Hugging Face"} profile: ${e.message}`);
    return;
  }
  $("who").textContent = who;
  $("name-input").value = CFG.DEFAULT_NAME;
  $("name-hint-github").hidden = provider !== "github";
  $("name-hint-hf").hidden = provider !== "huggingface";
  $("name-label").textContent = provider === "github" ? "Codespace name" : "Space name";
  $("name-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = sanitizeName($("name-input").value);
    if (!name) { $("name-error").textContent = "Give it a name."; return; }
    $("name-error").textContent = "";
    const run = provider === "github" ? createCodespace(name) : createSpace(who, name);
    run.catch((e) => fail(e.message));
  }, { once: true });
  show("name");
}

main().catch((e) => fail(e.message));
