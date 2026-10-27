# Pariksha Deployment & Self-Hosting Guide

Pariksha is designed to run on infrastructure **you own**, with zero per-candidate fees and zero vendor lock-in (`AC-01`, `O-03`, `S-01`, `S-02`). 

Every component — API server, database, object storage, and identity — is written against portable adapter interfaces, allowing you to run the exact same codebase on serverless edge clouds, single-container virtual machines, enterprise Kubernetes clusters, or isolated on-premise university networks.

---

## 1. Choosing Your Deployment Architecture

| Architecture | Database | Object Storage | Reverse Proxy / TLS | Memory Footprint | Best For |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cloudflare Serverless** | Cloudflare D1 (SQLite Edge) | Cloudflare R2 | Cloudflare Edge TLS | 0 MB (Serverless) | Zero operational maintenance, free hosting tier, globally distributed edge |
| **Docker: Lightweight** | SQLite (`better-sqlite3`, WAL) | Local filesystem volume | Caddy (Auto HTTPS) | ~80 MB | Single server, small teams, local testing, $4/mo VPS |
| **Docker: Production** | PostgreSQL 16 | MinIO (S3 Compatible API) | Caddy (Auto HTTPS) | ~350 MB | Enterprise, high-concurrency exams (300+ concurrent candidates), institutional data residency |
| **On-Prem / Air-Gapped** | PostgreSQL 16 or SQLite | MinIO or Local Disk | Caddy / Nginx / Direct | ~80–350 MB | Restricted lab networks, offline campuses, military / high-security environments |

---

## 2. Option A: Cloudflare Serverless (Zero Maintenance)

Deploy on Cloudflare's free tier using Cloudflare Workers, Static Assets, D1 SQL database, and R2 object storage.

### Prerequisites
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
- Node.js 22+ and `pnpm` 10+ installed on your deployment machine.
- Cloudflare Wrangler CLI.

### Step-by-Step Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/SriSatyaLokesh/pariksha.git
   cd pariksha
   pnpm install
   ```

2. **Authenticate Wrangler:**
   ```bash
   pnpm exec wrangler login
   ```

3. **Run the Idempotent Provisioning Script:**
   The included setup script provisions the D1 database, R2 bucket, and environment bindings automatically:
   ```bash
   # Test in-memory with a dry run first:
   node deploy/cloudflare/setup.mjs --dry-run

   # Provision real resources in your Cloudflare account:
   node deploy/cloudflare/setup.mjs
   ```

4. **Deploy the Worker:**
   ```bash
   pnpm deploy:cf
   ```

5. **Apply Database Migrations:**
   ```bash
   pnpm --filter @pariksha/api exec wrangler d1 migrations apply pariksha-db --remote
   ```

6. **Access Your Instance:**
   Open the assigned `https://<your-worker>.workers.dev` (or custom domain) to name your first workspace and create the owner account.

---

## 3. Option B: Docker Self-Host — Lightweight SQLite (< 5 Minutes)

Deploy a single, lean Docker container using SQLite and local storage. Ideal for single-node VPS instances (e.g. Hetzner, DigitalOcean, Linode) or local developer testing.

### Step-by-Step Setup

1. **Clone and enter `deploy/docker`:**
   ```bash
   git clone https://github.com/SriSatyaLokesh/pariksha.git
   cd pariksha/deploy/docker
   ```

2. **Configure your environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set:
   ```ini
   DOMAIN=exam.yourdomain.com
   PUBLIC_URL=https://exam.yourdomain.com
   SESSION_SECRET=<generate with: openssl rand -hex 32>
   ```

3. **Start the stack:**
   ```bash
   docker compose -f docker-compose.sqlite.yml up -d --build
   ```

Caddy automatically requests and renews Let's Encrypt certificates. SQLite uses Write-Ahead Logging (`WAL`) mode with persistent volume storage in `./data`.

---

## 4. Option C: Docker Self-Host — Production Cluster (PostgreSQL + MinIO)

Recommended for institutions, multi-examiner organizations, and tests with 300+ simultaneous candidates. Uses PostgreSQL 16 for high-throughput relational transactions and MinIO for S3-compatible snapshot storage.

### Architecture Components
- **`pariksha`**: Combined web frontend (Vite SPA) and Node API (Hono) runtime.
- **`postgres:16-alpine`**: Relational database engine with automated schema migrations.
- **`minio`**: Private, zero-telemetry S3 storage for proctoring snapshot stills.
- **`caddy:2-alpine`**: Reverse proxy with automated TLS/HTTPS.

### Step-by-Step Setup

1. **Enter `deploy/docker` and configure `.env`:**
   ```bash
   cd deploy/docker
   cp .env.example .env
   ```

2. **Generate secure secrets:**
   ```bash
   SESSION_SECRET=$(openssl rand -hex 32)
   POSTGRES_PASSWORD=$(openssl rand -hex 16)
   MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)
   ```
   Add these generated credentials to `.env`.

3. **Launch the stack:**
   ```bash
   docker compose up -d --build
   ```

4. **Verify Health:**
   ```bash
   curl http://localhost:8787/api/v1/health
   # Returns: {"status":"ok","dialect":"pg","migrations":15}
   ```

---

## 5. Option D: On-Premises & Air-Gapped Campus LAN

Many universities and certification centers run examinations in computer labs with strictly firewalled or completely disconnected internet. Pariksha runs completely offline without calling any external APIs.

### Key Considerations for Air-Gapped Exam Labs
- **Self-Contained Bundles:** All font files (Inter, JetBrains Mono, Noto Sans), math renderers (KaTeX), and assets are self-hosted in `apps/web/public/fonts/`. No external CDN or Google Fonts calls exist.
- **Zero Telemetry:** Pariksha makes zero phone-home network calls.
- **LAN Access:** Set `DOMAIN` to your local LAN IP (e.g., `192.168.1.50`) or internal DNS hostname (`exam.lab.local`).
- **Internal HTTPS / HTTP:** In a closed physical lab, Caddy can issue local root CA certificates, or you can expose port `8787` directly behind your internal firewall.

---

## 6. First-Run Owner Setup & Workspace Initialization

Regardless of deployment target, visiting the instance for the first time opens the first-run owner wizard (`/admin` or `/`):

1. **Create Owner Account:** If password authentication is enabled, register your owner email and master password.
2. **Name Primary Workspace:** Provide your department, college, or team name (e.g. `Computer Science Department`).
3. **Configure Optional 2FA:** Set up RFC 6238 TOTP two-factor authentication using any standard authenticator (Google Authenticator, 1Password, Bitwarden).
4. **Author or Import Questions:** Jump straight to creating question banks or importing example questions from `examples/technical-screening/questions.json`.

---

## 7. Backups, Restores & Operations

### Automated Database Backup
Run the included backup script in `deploy/docker/`:
```bash
./backup.sh
```
The script auto-detects whether your container is running Postgres or SQLite, dumps the active database state, and archives it to `./backups/pariksha_backup_<timestamp>.tar.gz`.

### Database Restore
To restore an existing database archive:
```bash
./restore.sh ./backups/pariksha_backup_20261026_010000.tar.gz
```

### Applying Schema Upgrades
Pariksha runs database migrations automatically on application startup. When pulling a new release version:
```bash
git pull origin main
docker compose up -d --build pariksha
```
The container boots, applies any pending SQL schema changes, and resumes serving requests.
