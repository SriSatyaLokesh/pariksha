# Pariksha Quick Start Guide

Deploy your own independent instance of Pariksha in under 30 minutes (`AC-01`, `O-04`).

Pariksha offers two primary deployment architectures:
1. **Docker Self-Host (Recommended for complete data sovereignty):** Runs on any Linux/macOS/Windows virtual machine or bare-metal server using Docker Compose, Postgres 16 (or lean SQLite), MinIO (or local storage), and Caddy for automatic HTTPS.
2. **Cloudflare Serverless:** Zero-compute cost on the Cloudflare Free Tier using Cloudflare Workers, D1 database, and R2 object storage.

---

## Path A: Docker Self-Host (< 15 Minutes)

### Prerequisites
- A virtual machine or server (Ubuntu 22.04+ / Debian 12 / AlmaLinux) with 2 GB+ RAM.
- A registered domain name or subdomain pointing at your server's IP address (e.g. `exam.example.org`).
- Docker Engine 24+ and Docker Compose v2.

### Step-by-Step Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/SriSatyaLokesh/pariksha.git /opt/pariksha
   cd /opt/pariksha/deploy/docker
   ```

2. **Configure your environment:**
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   Open `.env` in an editor and update the core parameters:
   - `APP_URL`: Your full HTTPS URL, e.g. `https://exam.example.org`
   - `SESSION_SECRET`: A secure random 64-character hex string (run `openssl rand -hex 32` to generate)
   - `STORAGE_SECRET_KEY`: A secure random key for MinIO
   - `POSTGRES_PASSWORD`: A secure random password for Postgres

3. **Start the stack:**
   ```bash
   docker compose up -d
   ```
   Docker pulls and builds the containers. Caddy automatically requests and provisions a trusted Let's Encrypt TLS certificate for your domain.

4. **Run the First-Run Setup Wizard:**
   Visit your configured `APP_URL` in your browser:
   - Navigate to `https://exam.example.org`.
   - The first-run setup wizard detects that the instance has no owner.
   - Enter your administrator email and account password.
   - Set up optional RFC 6238 TOTP two-factor authentication.
   - Pariksha seeds your primary workspace and opens your organiser dashboard.

---

## Path B: Cloudflare Serverless Free Tier (< 25 Minutes)

### Prerequisites
- A Cloudflare account with Workers, D1, and R2 enabled.
- Node.js 22+ and `pnpm` installed locally.

### Step-by-Step Setup

1. **Authenticate Wrangler:**
   ```bash
   pnpm exec wrangler login
   ```

2. **Provision D1 and R2:**
   Run the deployment initialization script:
   ```bash
   pnpm --filter @pariksha/api exec wrangler d1 create pariksha-db
   pnpm --filter @pariksha/api exec wrangler r2 bucket create pariksha-storage
   ```

3. **Deploy the Worker:**
   ```bash
   pnpm deploy:cf
   ```

4. **Apply Database Migrations:**
   ```bash
   pnpm --filter @pariksha/api exec wrangler d1 migrations apply pariksha-db --remote
   ```

5. **Open your instance:**
   Visit your assigned `*.workers.dev` or custom Cloudflare domain to complete the owner onboarding wizard.

---

## Next Steps

- Consult the [Organiser Guide](organiser-guide.md) to author question banks and assemble your first examination.
- Review the [Admin Security Guide](security-guide.md) to configure authentication providers, webhooks, and audit logging.
- Provide the [Candidate FAQ](candidate-faq.md) link to prospective students and candidates.
