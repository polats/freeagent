// freeagent landing page. Sign in with GitHub and/or Hugging Face, see your boxes, create one, open
// or delete one. Tokens stay in this browser (localStorage). The only server code is
// functions/api/auth/[provider]/[action].js, which swaps an OAuth code for a token.

const CFG = window.FREEAGENT;
const API = { github: "https://api.github.com", hf: "https://huggingface.co" };
const AUTHORIZE = { hf: "https://huggingface.co/oauth/authorize" };
const SCOPE = { hf: "openid profile manage-repos" };
const LABEL = { github: "GitHub", hf: "Hugging Face" };

const $ = (id) => document.getElementById(id);
const show = (step) => document.querySelectorAll("[data-step]").forEach((el) => { el.hidden = el.dataset.step !== step; });
const busy = (title, text = "") => { $("busy-title").textContent = title; $("busy-text").textContent = text; show("busy"); };
const fail = (message) => { $("error-text").textContent = message; show("error"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);

const token = (p) => localStorage.getItem(`freeagent:${p}`);
const available = {}; // provider -> client id, when this host has its secrets configured
const user = {}; // provider -> username, when signed in

// ---- Sign in / out --------------------------------------------------------------------------------
const config = {}; // provider -> the /config reply
async function detect(p) {
  const res = await fetch(`/api/auth/${p}/config`).catch(() => null);
  config[p] = res?.ok ? await res.json() : null;
  available[p] = config[p]?.client_id ?? null;
}

// GitHub, default: authorization code — one tap, GitHub bounces straight back here. The callback
// registered on the OAuth App must be exactly this site's root URL.
function signInGitHubRedirect(intent) {
  const state = randomToken();
  sessionStorage.setItem("oauth", JSON.stringify({ p: "github", state, intent }));
  const params = { client_id: available.github, redirect_uri: config.github.redirect_uri, scope: "codespace", state };
  location.assign(`https://github.com/login/oauth/authorize?${new URLSearchParams(params)}`);
}

// GitHub, fallback: device flow. No redirect URI to get wrong — the page shows a code, the user enters it on
// github.com, and the page polls until GitHub hands over the token.
async function signInGitHub(intent) {
  const start = await (await fetch("/api/auth/github/device", { method: "POST" })).json();
  if (start.error) throw new Error(`GitHub device flow: ${start.error_description || start.error}. Is "Enable Device Flow" ticked on the OAuth App?`);
  $("device-code").textContent = start.user_code;
  $("device-link").href = start.verification_uri;
  show("device");
  const deadline = Date.now() + start.expires_in * 1000;
  let interval = (start.interval || 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    if (document.querySelector('[data-step="device"]').hidden) return; // user backed out
    const res = await (await fetch("/api/auth/github/poll", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_code: start.device_code }),
    })).json();
    if (res.access_token) {
      localStorage.setItem("freeagent:github", res.access_token);
      await whoami("github");
      return intent === "create" && user.github ? nameStep("github") : home();
    }
    if (res.error === "slow_down") interval += 5000;
    else if (res.error !== "authorization_pending") throw new Error(`GitHub: ${res.error_description || res.error}`);
  }
  throw new Error("The code expired before it was entered. Try again.");
}

// Hugging Face: authorization code. The callback is this site's root URL.
function signInHF(intent) {
  const state = randomToken();
  sessionStorage.setItem("oauth", JSON.stringify({ p: "hf", state, intent }));
  const params = { client_id: available.hf, redirect_uri: `${location.origin}/`, response_type: "code", scope: SCOPE.hf, state };
  location.assign(`${AUTHORIZE.hf}?${new URLSearchParams(params)}`);
}

// Both redirect flows come back to "/?code=…&state=…"; the saved transaction says which provider.
async function finishRedirect(params) {
  const tx = JSON.parse(sessionStorage.getItem("oauth") ?? "null");
  sessionStorage.removeItem("oauth");
  history.replaceState(null, "", "/");
  if (!tx || tx.state !== params.get("state")) throw new Error("Sign-in did not start here. Please try again.");
  const res = await fetch(`/api/auth/${tx.p}/token`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: params.get("code") }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`${LABEL[tx.p]} refused the sign-in: ${body.error_description || body.error || res.status}`);
  localStorage.setItem(`freeagent:${tx.p}`, body.access_token);
  return tx;
}

const signIn = (p, intent) => {
  if (p === "hf") return Promise.resolve(signInHF(intent));
  return config.github?.redirect ? Promise.resolve(signInGitHubRedirect(intent)) : signInGitHub(intent);
};

function signOut(p) {
  localStorage.removeItem(`freeagent:${p}`);
  delete user[p];
}

// ---- Provider APIs ----------------------------------------------------------------------------------
async function api(p, path, init = {}) {
  const res = await fetch(`${API[p]}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token(p)}`,
      ...(p === "github" ? { accept: "application/vnd.github+json" } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (res.status === 401) { signOut(p); throw new Error(`${LABEL[p]} signed you out. Sign in again.`); }
  const json = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(json?.message ?? json?.error ?? `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}

async function whoami(p) {
  if (!token(p)) return;
  try { user[p] = p === "github" ? (await api("github", "/user")).login : (await api("hf", "/api/whoami-v2")).name; } catch { /* signed out */ }
}

const codespaceUrl = (name) => `https://${name}-7860.app.github.dev/`;
const spaceUrl = (id) => `https://${id.replace("/", "-").toLowerCase()}.hf.space/`;

async function listBoxes() {
  const boxes = [];
  if (user.github) {
    const { codespaces = [] } = await api("github", "/user/codespaces?per_page=100");
    for (const c of codespaces) {
      if (c.repository.full_name.toLowerCase() !== CFG.TEMPLATE_REPO.toLowerCase()) continue;
      boxes.push({ p: "github", id: c.name, label: c.display_name || c.name, state: c.state, url: codespaceUrl(c.name) });
    }
  }
  if (user.hf) {
    const spaces = await api("hf", `/api/spaces?author=${encodeURIComponent(user.hf)}&full=true&limit=100`);
    for (const s of spaces) {
      if (s.sdk !== "docker" || s.id === CFG.TEMPLATE_SPACE || !/freeagent/i.test(s.cardData?.title ?? "")) continue;
      const rt = await api("hf", `/api/spaces/${s.id}/runtime`).catch(() => null);
      boxes.push({ p: "hf", id: s.id, label: s.id.split("/")[1], state: rt?.stage ?? "?", url: spaceUrl(s.id) });
    }
  }
  return boxes;
}

async function openBox(b) {
  if (b.p === "github" && b.state !== "Available") {
    busy("Waking your codespace…");
    await api("github", `/user/codespaces/${b.id}/start`, { method: "POST" }).catch((e) => { if (e.status !== 409) throw e; });
    let state = b.state;
    for (let i = 0; i < 75 && state !== "Available"; i += 1) {
      await sleep(4000);
      state = (await api("github", `/user/codespaces/${b.id}`)).state;
      $("busy-text").textContent = state;
    }
    await countdown("Starting Herdr and Collie…", 20);
  }
  location.assign(b.url);
}

async function deleteBox(b) {
  if (!confirm(`Delete ${b.label}? Agent sign-ins and uncommitted code on it are lost.`)) return;
  if (b.p === "github") await api("github", `/user/codespaces/${b.id}`, { method: "DELETE" });
  else await api("hf", "/api/repos/delete", { method: "DELETE", body: JSON.stringify({ type: "space", name: b.label }) });
  await home();
}

async function countdown(title, seconds) {
  for (let i = seconds; i > 0; i -= 1) { busy(title, `${i}s`); await sleep(1000); }
}

// ---- Create -------------------------------------------------------------------------------------------
async function createCodespace(name) {
  busy("Creating your codespace…");
  const repo = await api("github", `/repos/${CFG.TEMPLATE_REPO}`);
  const cs = await api("github", "/user/codespaces", {
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
  let state = cs.state;
  for (let i = 0; i < 240 && state !== "Available"; i += 1) {
    await sleep(5000);
    state = (await api("github", `/user/codespaces/${cs.name}`)).state;
    $("busy-text").textContent = `${state} (${i * 5}s)`;
    if (state === "Failed") throw new Error("GitHub could not start the codespace.");
  }
  await countdown("Starting Herdr and Collie…", 30);
  finish(codespaceUrl(cs.name), "The port is private to your GitHub account, so your GitHub sign-in is the key.", null);
}

async function createSpace(name) {
  const collieToken = randomToken();
  busy("Creating your Space…");
  try {
    await api("hf", `/api/spaces/${CFG.TEMPLATE_SPACE}/duplicate`, {
      method: "POST",
      body: JSON.stringify({
        repository: `${user.hf}/${name}`,
        visibility: "public",
        hardware: "cpu-basic",
        secrets: [{ key: "COLLIE_AUTH_TOKEN", value: collieToken }],
      }),
    });
  } catch (e) {
    if (e.status === 409) { nameStep("hf"); $("name-error").textContent = "You already have a Space with that name."; return; }
    throw e;
  }
  let stage = "BUILDING";
  for (let i = 0; i < 240 && stage !== "RUNNING"; i += 1) {
    await sleep(5000);
    stage = (await api("hf", `/api/spaces/${user.hf}/${name}/runtime`).catch(() => null))?.stage ?? stage;
    $("busy-text").textContent = `${stage} (${i * 5}s)`;
    if (/ERROR/.test(stage)) throw new Error(`The Space ended in ${stage}. See its logs on huggingface.co.`);
  }
  finish(`${spaceUrl(`${user.hf}/${name}`)}#token=${collieToken}`, "Opening it now.", collieToken);
}

function finish(url, note, collieToken) {
  $("open-link").href = url;
  $("done-note").textContent = note;
  $("token-block").hidden = collieToken === null;
  $("token-text").textContent = collieToken ?? "";
  show("done");
  setTimeout(() => location.assign(url), 2500);
}

function nameStep(p) {
  $("name-input").value = CFG.DEFAULT_NAME;
  $("name-error").textContent = "";
  $("name-hint").textContent = p === "github"
    ? "A 2-core codespace. It stops after an hour idle and restarts on your next visit with everything kept."
    : "A public Space on free hardware. It sleeps after two idle days; without paid storage a restart forgets agent sign-ins.";
  $("name-form").onsubmit = (ev) => {
    ev.preventDefault();
    const name = $("name-input").value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
    if (!name) { $("name-error").textContent = "Give it a name."; return; }
    (p === "github" ? createCodespace(name) : createSpace(name)).catch((e) => fail(e.message));
  };
  show("name");
}

// ---- Home -------------------------------------------------------------------------------------------
async function home() {
  show("home");
  await Promise.all(["github", "hf"].map(whoami));
  for (const p of ["github", "hf"]) {
    $(`${p}-row`).hidden = !available[p];
    $(`new-${p}`).hidden = !available[p];
    $(`${p}-who`).textContent = user[p] ? `signed in as ${user[p]}` : "not signed in";
    $(`${p}-who`).classList.toggle("on", Boolean(user[p]));
    $(`${p}-signin`).hidden = Boolean(user[p]);
    $(`${p}-signout`).hidden = !user[p];
  }
  // If GitHub ever says "redirect_uri is not associated", these two values are what to compare
  // with the OAuth App's page: its Client ID and its Authorization callback URL.
  $("github-details").hidden = !available.github || Boolean(user.github);
  if (available.github) $("github-details-text").textContent = `client id ${available.github.slice(0, 8)}… · callback ${config.github.redirect_uri}`;
  $("boxes").textContent = "";
  $("boxes-note").textContent = user.github || user.hf ? "Loading…" : "Sign in to see your boxes.";
  if (!user.github && !user.hf) return;
  const boxes = await listBoxes().catch((e) => { fail(e.message); return []; });
  $("boxes-note").textContent = boxes.length ? "" : "No boxes yet.";
  for (const b of boxes) {
    const el = document.createElement("div");
    el.className = "box";
    el.innerHTML = `<strong></strong> <span class="who"></span><div class="actions"><button class="small primary">Open</button><button class="small ghost danger">Delete</button></div>`;
    el.querySelector("strong").textContent = b.label;
    el.querySelector(".who").textContent = `${b.p === "github" ? "Codespace" : "Space"} · ${b.state}`;
    const [open, del] = el.querySelectorAll("button");
    open.onclick = () => openBox(b).catch((e) => fail(e.message));
    del.onclick = () => deleteBox(b).catch((e) => fail(e.message));
    $("boxes").appendChild(el);
  }
}

async function main() {
  for (const p of ["github", "hf"]) {
    $(`${p}-signin`).onclick = () => signIn(p, "home").catch((e) => fail(e.message));
    $(`${p}-signout`).onclick = () => { signOut(p); home(); };
    $(`new-${p}`).onclick = () => (user[p] ? nameStep(p) : signIn(p, "create").catch((e) => fail(e.message)));
  }
  $("github-device").onclick = () => signInGitHub("home").catch((e) => fail(e.message));
  $("device-back").onclick = home;
  $("device-copy").onclick = () => navigator.clipboard?.writeText($("device-code").textContent).then(() => { $("device-copy").textContent = "Copied"; });
  $("name-back").onclick = home;
  $("done-home").onclick = home;
  $("error-home").onclick = home;

  await Promise.all(["github", "hf"].map(detect));
  if (!available.github && !available.hf) return fail("No sign-in is configured. Set the OAuth secrets on the Pages project (see README).");

  const params = new URLSearchParams(location.search);
  if (params.get("error")) { history.replaceState(null, "", "/"); return fail(`Sign-in failed: ${params.get("error_description") ?? params.get("error")}`); }
  if (params.get("code")) {
    show("busy"); $("busy-title").textContent = "Signing you in…";
    const tx = await finishRedirect(params);
    if (tx.intent === "create") { await whoami(tx.p); if (user[tx.p]) return nameStep(tx.p); }
  }
  await home();
}

main().catch((e) => fail(e.message));
