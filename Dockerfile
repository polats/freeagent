# freeagent-cloud — Herdr (headless) + Collie (phone UI) + coding agents, one image.
#
# Homes: Hugging Face Spaces, Railway, GitHub Codespaces. The port is decided at runtime by
# entrypoint.sh: Railway injects $PORT, the others fall back to 7860 (matches app_port in README.md).
#
# Layout inside the image:
#   /usr/local/bin/herdr        static musl release binary (verified sha256)
#   /usr/local/bin/bun          copied from the official Bun image, pinned to Collie's flake pin
#   /opt/collie                 Collie checkout at COLLIE_REF with web/dist prebuilt
#   /opt/freeagent              this repo's config seeds and helpers
#   /home/node                  agent homes (~/.claude, ~/.codex) — herdr integrations installed here
# Runtime state (herdr config/state, collie state, workspace) goes under /data when that is a
# writable mount; see entrypoint.sh.

ARG BUN_VERSION=1.4.1
FROM oven/bun:${BUN_VERSION}-slim AS bun

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      bubblewrap \
      ca-certificates \
      curl \
      git \
      jq \
      less \
      openssh-client \
      procps \
      python3 \
      ripgrep \
      tar \
      unzip \
    && rm -rf /var/lib/apt/lists/*

# --- bun ---------------------------------------------------------------------------------
# Collie's flake pins Bun (collie/flake.nix `bunVersion`); the bridge and the web build both run
# on it. Copying the binary from the official image avoids the curl installer and its $HOME games.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx && bun --version

# --- herdr -------------------------------------------------------------------------------
# Static musl binaries from GitHub releases; building from source needs libghostty-vt and a
# vendored PTY crate, which is not worth it in an image. Checksums come from
# herdr/distribution/latest.json for the pinned version. Bump all three together.
ARG HERDR_VERSION=0.8.2
ARG HERDR_SHA256_X86_64=976150a14d490c94b243ea2e1a7eb2dfb67f12e36b182db90936f6728e6aecf4
ARG HERDR_SHA256_AARCH64=f55610658e1c2e0d2aaef730b4b2ab885f7f8ba00285ab372bfb14f2e3d5b40d
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) arch=x86_64;  sum="$HERDR_SHA256_X86_64" ;; \
      arm64) arch=aarch64; sum="$HERDR_SHA256_AARCH64" ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/herdr \
      "https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-${arch}"; \
    echo "${sum}  /usr/local/bin/herdr" | sha256sum -c -; \
    chmod 755 /usr/local/bin/herdr; \
    herdr --version

# --- coding agents -----------------------------------------------------------------------
# Claude Code and Codex from npm (the node image already has npm; deterministic and offline-cacheable).
# OpenCode via its installer, moved onto the shared PATH — same recipe as opencode-cloud.
# Pin any of them with --build-arg; empty means latest.
ARG CLAUDE_CODE_VERSION=""
ARG CODEX_VERSION=""
ARG OPENCODE_VERSION=""
RUN npm install -g \
      "@anthropic-ai/claude-code${CLAUDE_CODE_VERSION:+@$CLAUDE_CODE_VERSION}" \
      "@openai/codex${CODEX_VERSION:+@$CODEX_VERSION}" \
    && npm cache clean --force \
    && claude --version && codex --version
RUN VERSION="${OPENCODE_VERSION}" bash -c 'curl -fsSL https://opencode.ai/install | bash' \
    && mv "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode \
    && chmod 755 /usr/local/bin/opencode \
    && rm -rf "$HOME/.opencode" \
    && opencode --version

# --- collie ------------------------------------------------------------------------------
# A tagged checkout with the web bundle prebuilt. The bridge serves web/dist from disk and has no
# npm runtime dependencies beyond the optional `web-push`, so the root install is tiny; the web
# tree's devDependencies are only needed for `vite build` and are removed afterwards.
# Built from the polats fork's `cloud` branch: upstream Collie plus cloud auth (COLLIE_AUTH_TOKEN,
# docs/deployment.md → Variant F). Pin a tag here once the fork cuts one.
ARG COLLIE_REPO=https://github.com/polats/collie.git
ARG COLLIE_REF=cloud
RUN git clone --depth 1 --branch "${COLLIE_REF}" "${COLLIE_REPO}" /opt/collie \
    && cd /opt/collie \
    && bun install --frozen-lockfile \
    && cd web \
    && bun install --frozen-lockfile \
    && bun run build \
    && rm -rf node_modules \
    && cd /opt/collie \
    && rm -rf .git \
    && test -f web/dist/index.html

# --- this repo ---------------------------------------------------------------------------
# HF Spaces runs containers as uid 1000; the node image already has `node` at uid 1000.
ENV HOME=/home/node
ENV PATH=/usr/local/bin:${PATH}
ENV SHELL=/bin/bash

COPY --chown=node:node entrypoint.sh /home/node/entrypoint.sh
COPY --chown=node:node config/ /opt/freeagent/config/
COPY --chown=node:node bin/ /opt/freeagent/bin/
RUN chmod +x /home/node/entrypoint.sh /opt/freeagent/bin/* \
    && ln -s /opt/freeagent/bin/freeagent-pair /usr/local/bin/freeagent-pair \
    && mkdir -p /home/node/workspace \
    && chown -R node:node /home/node /opt/collie

USER node
WORKDIR /home/node/workspace

# Herdr's lifecycle hooks for each agent, so pane state is reported by the agent itself rather than
# inferred from the screen. Writes under $HOME (~/.claude/settings.json etc.), which is why this runs
# as `node` after HOME is set and is baked into the image rather than done at boot.
# Herdr refuses to install into an agent directory that does not exist yet ("install claude code
# first"); the CLIs are installed but have never run, so create the dirs it checks for:
# ~/.claude (CLAUDE_CONFIG_DIR), ~/.codex (CODEX_HOME), ~/.config/opencode (always HOME-relative).
RUN mkdir -p /home/node/.claude /home/node/.codex /home/node/.config/opencode \
    && herdr integration install claude \
    && herdr integration install codex \
    && herdr integration install opencode

EXPOSE 7860
ENTRYPOINT ["/home/node/entrypoint.sh"]
