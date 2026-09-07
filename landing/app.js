// freeagent landing page: sign in with Hugging Face (OAuth + PKCE, no backend), duplicate the
// template Space into the user's account with a fresh Collie root token as a creation-time secret,
// wait for it to run, and hand the phone off to it with the token in the URL fragment — which the
// Collie PWA trades for a device token of its own before it renders (Collie → Variant F).
//
// Nothing leaves the browser except calls to huggingface.co. The access token lives in
// sessionStorage for the length of the flow and is dropped at the end.

const CFG = window.FREEAGENT;
const HF = "https://huggingface.co";
// On a Hugging Face static Space with `hf_oauth: true`, the platform injects the OAuth app it
// provisioned for this exact host as `window.huggingface.variables` — no app to create by hand,
// and the redirect URI cannot drift from the deployed URL. Elsewhere (Vercel, a custom domain)
// config.js supplies a client id registered for that origin.
const SPACE_VARS = window.huggingface?.variables ?? {};
const CLIENT_ID = SPACE_VARS.OAUTH_CLIENT_ID || CFG.HF_CLIENT_ID;
const SCOPES = SPACE_VARS.OAUTH_SCOPES || CFG.HF_SCOPES;
const EMBEDDED = window.top !== window.self;
const S = window.sessionStorage;

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const el of document.querySelectorAll("[data-step]")) el.hidden = el.dataset.step !== id;
};
const fail = (message) => {
  $("error-text").textContent = message;
  show("error");
};

// ---- PKCE ------------------------------------------------------------------------------------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function startSignIn() {
  if (!CLIENT_ID || CLIENT_ID.startsWith("REPLACE")) {
    fail("This page is not configured yet: no OAuth client id (config.js HF_CLIENT_ID, or hf_oauth on the Space).");
    return;
  }
  if (EMBEDDED) {
    // Inside huggingface.co's Space iframe the sign-in cookies do not survive the round trip on
    // some browsers (the Spaces OAuth docs say so). Break out to the direct host instead.
    window.open(location.href, "_blank", "noopener");
    return;
  }
  const verifier = random(32);
  const state = random(16);
  S.setItem("pkce", JSON.stringify({ verifier, state }));
  const url = new URL(`${HF}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: b64url(await sha256(verifier)),
    code_challenge_method: "S256",
  }).toString();
  location.assign(url.toString());
}

function redirectUri() {
  return location.origin + location.pathname;
}

async function finishSignIn(params) {
  const saved = JSON.parse(S.getItem("pkce") ?? "null");
  S.removeItem("pkce");
  if (!saved || saved.state !== params.get("state")) throw new Error("Sign-in state mismatch. Please start again.");
  const res = await fetch(`${HF}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code: params.get("code"),
      redirect_uri: redirectUri(),
      code_verifier: saved.verifier,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Hugging Face refused the sign-in: ${body.error_description ?? body.error ?? res.status}`);
  S.setItem("hf_token", body.access_token);
  history.replaceState(null, "", redirectUri());
}

// ---- Hugging Face API ------------------------------------------------------------------------
async function hf(path, init = {}) {
  const token = S.getItem("hf_token");
  const res = await fetch(`${HF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
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

async function createBox(user, name) {
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
  // Build + boot. cpu-basic builds of this image take a few minutes.
  const started = Date.now();
  let stage = "STARTING";
  while (Date.now() - started < 20 * 60_000) {
    const runtime = await hf(`/api/spaces/${user}/${name}/runtime`).catch(() => null);
    stage = runtime?.stage ?? stage;
    $("creating-text").textContent = `${stageText(stage)} (${Math.round((Date.now() - started) / 1000)}s)`;
    if (stage === "RUNNING") break;
    if (["BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR"].includes(stage)) {
      throw new Error(`The Space ended in ${stage}. Open https://huggingface.co/spaces/${user}/${name} to see its logs.`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (stage !== "RUNNING") throw new Error("The Space did not come up within 20 minutes. It may still be building; open it from your Hugging Face profile.");
  S.removeItem("hf_token");
  const url = `${spaceHost(user, name)}/#token=${collieToken}`;
  $("open-link").href = url;
  $("space-link").href = `https://huggingface.co/spaces/${user}/${name}`;
  $("space-link").textContent = `${user}/${name}`;
  $("token-text").textContent = collieToken;
  show("done");
  // The one-time hand-off. Auto-follow after a moment; the button is there if the browser blocks it.
  setTimeout(() => location.assign(url), 2500);
}

function stageText(stage) {
  switch (stage) {
    case "BUILDING": case "APP_STARTING": return "Building your box";
    case "RUNNING_BUILDING": return "Building your box";
    case "RUNNING": return "Running";
    default: return `Waiting for Hugging Face (${stage})`;
  }
}

// ---- Wiring ----------------------------------------------------------------------------------
async function main() {
  $("codespaces-link").href = CFG.CODESPACES_URL;
  $("repo-link").href = CFG.REPO_URL;
  $("start").addEventListener("click", () => { startSignIn().catch((e) => fail(e.message)); });
  $("retry").addEventListener("click", () => { S.clear(); location.assign(redirectUri()); });
  $("copy-token").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("token-text").textContent); $("copy-token").textContent = "Copied"; } catch { /* no clipboard */ }
  });

  const params = new URLSearchParams(location.search);
  if (params.get("error")) { fail(`Hugging Face said: ${params.get("error_description") ?? params.get("error")}`); return; }
  if (params.get("code")) {
    show("signing-in");
    try { await finishSignIn(params); } catch (e) { fail(e.message); return; }
  }
  if (!S.getItem("hf_token")) { show("start"); return; }

  let me;
  try { me = await hf("/api/whoami-v2"); } catch (e) { S.removeItem("hf_token"); fail(`Could not read your Hugging Face profile: ${e.message}`); return; }
  $("who").textContent = me.name;
  $("name-input").value = CFG.DEFAULT_NAME;
  $("name-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = $("name-input").value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
    if (!name) { $("name-error").textContent = "Give it a name."; return; }
    $("name-error").textContent = "";
    createBox(me.name, name).catch((e) => fail(e.message));
  });
  show("name");
}

main().catch((e) => fail(e.message));
