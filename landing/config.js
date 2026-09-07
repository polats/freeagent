// Landing-page configuration. Everything here is public by nature: template ids, a repo link, a
// PKCE client id. There is no secret anywhere on this page — that is the point of it. The GitHub
// OAuth client id and secret live in Cloudflare Pages secrets, read by functions/api/auth/github.
window.FREEAGENT = {
  // GitHub Codespaces (default where available): the repo the codespace is created from.
  TEMPLATE_REPO: "polats/freeagent",
  CODESPACE_MACHINE: "basicLinux32gb",
  CODESPACE_IDLE_MINUTES: 60,
  CODESPACES_PORT_DOMAIN: "app.github.dev",
  // Hugging Face: the public template Space this page duplicates.
  TEMPLATE_SPACE: "polats/freeagent",
  // HF OAuth client id for NON-Space hosts (Cloudflare Pages, Vercel): huggingface.co → Settings →
  // Developer applications → New; redirect URI = that host's URL with a trailing slash. On the
  // Hugging Face static Space this is ignored — the platform injects its own (hf_oauth: true).
  HF_CLIENT_ID: "REPLACE_WITH_HF_OAUTH_CLIENT_ID",
  HF_SCOPES: "openid profile manage-repos",
  DEFAULT_NAME: "freeagent",
  REPO_URL: "https://github.com/polats/freeagent",
};
