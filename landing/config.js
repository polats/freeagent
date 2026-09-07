// Landing-page configuration. Everything here is public by nature: a PKCE client id, a template
// Space id, a repo link. There is no secret anywhere on this page — that is the point of it.
window.FREEAGENT = {
  // The Hugging Face OAuth application (huggingface.co/settings/applications → New application).
  // Redirect URI = this page's own URL (e.g. https://freeagent.vercel.app/). Scopes below.
  HF_CLIENT_ID: "REPLACE_WITH_HF_OAUTH_CLIENT_ID",
  HF_SCOPES: "openid profile manage-repos",
  // The public template Space this page duplicates. Published by .github/workflows/sync-to-hf-space.yml.
  TEMPLATE_SPACE: "polats/freeagent",
  // Default name for the user's copy; they can change it.
  DEFAULT_NAME: "freeagent",
  // Zero-infra fallback for people who would rather have a codespace.
  CODESPACES_URL: "https://codespaces.new/polats/freeagent?quickstart=1",
  REPO_URL: "https://github.com/polats/freeagent",
};
