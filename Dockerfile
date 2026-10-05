FROM node:22-slim AS deps
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
# Trusts a corporate root CA dropped in docker/certs/ (only .gitkeep is committed, *.crt is gitignored; in CI the dir is
# empty and this is a no-op). Needed for `bun install` behind a TLS-inspecting proxy (Zscaler). Same pattern as swovn-aic-backend.
COPY docker/certs/ /usr/local/share/ca-certificates/local/
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
WORKDIR /src
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json bun.lock ./
COPY vendor/ vendor/
RUN bun install --frozen-lockfile

# Plain Node 22, no Electron. tests/smoke.test.ts asserts it runs on Electron (process.versions.electron), so CI's `check` job covers it.
# The longer timeout is for a container on a busy laptop (tests/db.test.ts goes past 5 s there).
FROM deps AS test
COPY . .
RUN bun run typecheck && node node_modules/vitest/vitest.mjs run --exclude tests/smoke.test.ts --testTimeout 30000
