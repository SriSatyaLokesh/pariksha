# Quickstart Guide

This guide walks you through setting up a complete Pariksha exam platform instance in about 15 minutes.

Pariksha offers two primary deployment models:
1. **Docker Self-Host (Recommended for complete data sovereignty):** Runs on any Linux/macOS/Windows virtual machine or bare-metal server using Docker Compose, Postgres 16 (or lean SQLite), MinIO (or local storage), and Caddy for automatic HTTPS.
2. **Cloudflare Serverless:** Zero-compute cost on the Cloudflare Free Tier using Cloudflare Workers, D1 database, and R2 object storage.

> **Tip — Evaluate without deploying:** You can test the candidate runtime immediately without installing Docker or configuring Cloudflare by trying the [Live Candidate Demo](https://github.com/SriSatyaLokesh/pariksha#try-the-live-demo) (Access code: `DEMO`).
> For comprehensive production clustering, on-premises air-gapped labs, and automated backup/restore scripts, see the [Full Deployment Guide](deployment.md).

---

## Option A: Docker Self-Host (Local / On-Premise)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose v2.20+
- 2 GB RAM, 10 GB disk space

### 1. Clone & Configure
```bash
git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha

# Copy the example environment
cp deploy/docker/.env.example deploy/docker/.env
```

Review `deploy/docker/.env` and update `PUBLIC_URL` to your domain or `http://localhost:8787`.

### 2. Start Services
```bash
# Production stack: Postgres 16 + MinIO S3 + Caddy Reverse Proxy
docker compose -f deploy/docker/docker-compose.yml up -d

# OR Lean stack: SQLite + local storage (minimal resources)
docker compose -f deploy/docker/docker-compose.sqlite.yml up -d
```

### 3. Complete Initial Setup
Open your browser to `http://localhost:8787` (or your configured `PUBLIC_URL`).
The first-run setup wizard will prompt you to:
1. Register the Administrator account (email + secure password).
2. Configure optional Two-Factor Authentication (TOTP via Google Authenticator / 1Password).
3. Create your first Organiser Workspace.

---

## Option B: Cloudflare Serverless Deployment

### Prerequisites
- Node.js 22+ and `pnpm` 10
- A free [Cloudflare Account](https://dash.cloudflare.com/sign-up)

### 1. Clone & Install
```bash
git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha
pnpm install
```

### 2. Log in to Cloudflare
```bash
pnpm --filter @pariksha/api exec wrangler login
```

### 3. Provision, migrate and deploy
Pariksha deploys as **one Worker** that serves both the web app (Static Assets) and the API, with D1 and R2 behind it. The setup script creates the D1 database and R2 bucket if they are missing and applies pending migrations; the config lives in `deploy/cloudflare/wrangler.toml`.

```bash
SITE_URL="https://<your-worker>.workers.dev" pnpm build
node deploy/cloudflare/setup.mjs
pnpm deploy:cf
```

Preview the whole setup flow without touching your account first: `node deploy/cloudflare/setup.mjs --dry-run`. Details, and why it is one Worker rather than two, are in [`deploy/cloudflare/README.md`](../deploy/cloudflare/README.md).

> **Contributing instead of deploying?** You do not need Cloudflare or Docker. See the [contributor setup guide](contributing/setup.md).

---

## Next Steps
- Import an example question bank: see [Question Format Specification](question-format.md) and [Organiser Guide](organiser-guide.md).
- Assemble a test with randomized pools: see [Test Format](test-format.md) and [Organiser Guide](organiser-guide.md).
- Security and proctoring overview: see [Security Guide](security-guide.md) and [Candidate FAQ](candidate-faq.md).
- Production multi-target setups: see [Deployment Guide](deployment.md).
