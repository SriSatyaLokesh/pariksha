# Pariksha Load Testing Guide (AC-29)

This folder contains the automated performance and capacity benchmark suite enforcing **AC-29**:
> *"A k6 run of 500 candidates (all start within 5 minutes, 40 answers each, Strict proctoring) on the Cloudflare free plan ends with < 0.5% errors, p95 ≤ 300 ms, and usage under the daily limits."*

---

## 1. Running via Docker (Zero Install)

Run k6 in an isolated container targeting your local or remote instance:

```bash
docker run --rm -i \
  --network="host" \
  -e TARGET_URL="http://localhost:8787" \
  -v $(pwd)/scripts/k6:/scripts \
  grafana/k6 run /scripts/load-test.js
```

---

## 2. Running via Native k6

If you have `k6` installed locally (`brew install k6`, `winget install k6`, or `apt install k6`):

```bash
k6 run scripts/k6/load-test.js
```

To target a remote Cloudflare Workers or Docker staging instance:

```bash
k6 run \
  -e TARGET_URL="https://exam.example.org" \
  -e WORKSPACE_SLUG="acme-corp" \
  -e TEST_SLUG="screening-test" \
  scripts/k6/load-test.js
```

---

## 3. Interpreting Results

k6 automatically evaluates the defined thresholds upon completion:
- `http_req_failed`: Must be `< 0.005` (< 0.5% errors).
- `http_req_duration`: 95th percentile (`p(95)`) must be `≤ 300ms`.

If either threshold fails, the process exits with a non-zero exit code.
