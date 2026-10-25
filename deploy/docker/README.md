# Self-Host Pariksha with Docker

Deploy Pariksha on any Linux server, VPS, or local workstation with Docker Compose in under **30 minutes** with **zero paid services** (`AC-01`, `S-01`, `S-02`, `O-03`).

Pariksha is packaged as a single lean container that serves both the **backend API** and the **frontend single-page application** (organiser dashboard, exam candidate shell, and public landing).

---

## Architecture

Pariksha supports two self-hosted architectures:

| Mode | Database | Object Storage | Reverse Proxy | Memory | Best For |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Lightweight** | SQLite (`better-sqlite3`) | Local Disk volume | Caddy (HTTPS) | ~80 MB | Single-server, VPS ($4/mo), solo operators, small teams |
| **Production** | PostgreSQL 16 | MinIO (S3 API) | Caddy (HTTPS) | ~350 MB | Enterprise, multi-node clustering, large organizations |

Both architectures include:
- **Caddy** for automatic Let's Encrypt TLS / HTTPS certificates.
- **Argon2id password authentication** and RFC 6238 **TOTP two-factor authentication** (2FA).
- Built-in **in-process scheduler** running regrades, webhook delivery retry queues, and retention sweeps every 60s.

---

## Quick Start: Lightweight SQLite (< 5 Minutes)

### 1. Clone the repository and enter `deploy/docker`
```bash
git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha/deploy/docker
```

### 2. Configure environment
```bash
cp .env.example .env
```
Open `.env` and set:
- `DOMAIN`: your server's domain or IP (e.g. `pariksha.example.com` or `localhost`).
- `PUBLIC_URL`: `https://pariksha.example.com` (or `http://localhost:8787`).
- `SESSION_SECRET`: a 64-character random string (generate with `openssl rand -hex 32`).

### 3. Launch with Docker Compose
```bash
docker compose -f docker-compose.sqlite.yml up -d --build
```

### 4. Complete First-Run Setup
Open `https://<your-domain>/` (or `http://localhost:8787/`) in your browser:
1. You will be greeted with the first-run setup wizard (`/setup`).
2. Create your workspace name (e.g. `Acme University` or `Engineering`).
3. Create the instance owner account using your email and password.
4. (Optional) Turn on two-factor authentication (TOTP) in your profile with Google Authenticator, 1Password, or Bitwarden.

---

## Quick Start: Production PostgreSQL & MinIO

### 1. Configure environment
```bash
cp .env.example .env
```
Edit `.env` to set strong passwords:
```bash
SESSION_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)
```

### 2. Launch full cluster
```bash
docker compose up -d --build
```
This boots:
- `postgres:16-alpine`: PostgreSQL database engine.
- `minio/minio`: S3-compatible snapshot & media storage.
- `minio-init`: Automatically provisions the storage bucket.
- `pariksha`: The combined web and API application container.
- `caddy:2-alpine`: Automatic HTTPS reverse proxy.

---

## Backup and Restore

### Automated Backup
Run the backup script to capture a timestamped archive of the database:
```bash
./backup.sh
```
The script auto-detects whether Postgres or SQLite is running, dumps the database, and saves a compressed archive in `./backups/pariksha_backup_<timestamp>.tar.gz`.

### Restore
To restore from an archive:
```bash
./restore.sh ./backups/pariksha_backup_20261026_010000.tar.gz
```

---

## Configuration Reference (`.env`)

| Variable | Description | Required | Default |
| :--- | :--- | :--- | :--- |
| `DOMAIN` | Domain name for Caddy automatic TLS | Yes | `localhost` |
| `PUBLIC_URL` | Public origin including protocol | Yes | `http://localhost:8787` |
| `SESSION_SECRET` | 32+ character key for JWT & HMAC cookies | Yes | None |
| `DATABASE_URL` | Postgres URL or SQLite filepath | Yes | Set in compose |
| `STORAGE_DIR` | Directory for local disk storage | No | `/app/data/storage` |
| `S3_ENDPOINT` | MinIO or S3 endpoint URL | No | None |
| `S3_BUCKET` | MinIO or S3 bucket name | No | `pariksha` |
| `S3_ACCESS_KEY` | MinIO / S3 access key ID | No | None |
| `S3_SECRET_KEY` | MinIO / S3 secret access key | No | None |
| `EMAIL_ENDPOINT` | Transactional email HTTP endpoint | No | None |
| `EMAIL_TOKEN` | Bearer token for email endpoint | No | None |
| `EMAIL_FROM` | Sender email address (`From:` header) | No | None |
| `EMAIL_CONSOLE` | Set to `true` to print emails to stdout | No | None |

---

## Verification & Health Check

The application container exposes a standardized health check endpoint:
```bash
curl -f http://localhost:8787/api/v1/health
```
Returns:
```json
{"status":"ok","timestamp":1792984000000}
```
Docker monitors this endpoint every 30 seconds and restarts the container if unhealthy.
