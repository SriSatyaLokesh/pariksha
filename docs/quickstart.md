# Quickstart Guide

This guide walks you through setting up a complete Pariksha exam platform instance in under 5 minutes.

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
- Node.js 20+ and `pnpm`
- A free [Cloudflare Account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`pnpm install -g wrangler`)

### 1. Clone & Install
```bash
git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha
pnpm install
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Provision Cloudflare Resources
```bash
# Create D1 Serverless SQLite Database
wrangler d1 create pariksha-db

# Create R2 Object Storage Bucket
wrangler r2 bucket create pariksha-storage
```

Copy the generated `database_id` and bucket names into `apps/api/wrangler.jsonc`.

### 4. Apply Database Migrations
```bash
pnpm --filter @pariksha/db migrate
```

### 5. Deploy API Worker & Frontend Pages
```bash
# Deploy backend API worker
pnpm --filter @pariksha/api deploy

# Build and deploy frontend web SPA to Cloudflare Pages
pnpm --filter @pariksha/web build
wrangler pages deploy apps/web/dist --project-name pariksha
```

---

## Next Steps
- Import an example question bank: see [Question Format Specification](question-format.md) and [Organiser Guide](organiser-guide.md).
- Assemble a test with randomized pools: see [Test Format](test-format.md) and [Organiser Guide](organiser-guide.md).
- Security and proctoring overview: see [Security Guide](security-guide.md) and [Candidate FAQ](candidate-faq.md).
- Production multi-target setups: see [Deployment Guide](deployment.md).
