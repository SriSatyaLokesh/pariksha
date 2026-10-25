# Pariksha API Reference

This reference covers common API operations for integrating Pariksha into external learning management systems (LMS), student information portals, and automated testing pipelines (`O-04`).

For complete schema definitions, download the OpenAPI specification at [docs/openapi.yaml](openapi.yaml) or query `GET /api/v1/openapi.json`.

---

## 1. Authentication

Pariksha supports three authentication mechanisms:
1. **API Key (`x-api-key` header):** For automated server-to-server integrations.
2. **Bearer Token (`Authorization: Bearer <token>`):** For programmatic API access.
3. **Session Cookie (`session=<cookie>`):** For browser-based organiser and candidate sessions.

---

## 2. Health & Status

### Check System Health
```bash
curl -X GET "https://exam.example.org/api/v1/health" \
  -H "Accept: application/json"
```

**Response (200 OK):**
```json
{
  "ok": true,
  "version": "1.0.0",
  "db": "healthy"
}
```

---

## 3. Workspaces

### List Workspaces
```bash
curl -X GET "https://exam.example.org/api/v1/workspaces" \
  -H "Authorization: Bearer <session-token>"
```

**Response (200 OK):**
```json
{
  "workspaces": [
    {
      "id": "wsp_01j7h8k9a1b2c3d4e5f6g7h8",
      "name": "Engineering Faculty",
      "slug": "engineering-faculty",
      "role": "owner"
    }
  ]
}
```

---

## 4. Tests and Authoring

### List Workspace Tests
```bash
curl -X GET "https://exam.example.org/api/v1/workspaces/wsp_01j7h8k9a1b2c3d4e5f6g7h8/tests" \
  -H "x-api-key: pk_live_secretkey123"
```

### Publish a Test
```bash
curl -X POST "https://exam.example.org/api/v1/workspaces/wsp_01j7h8k9a1b2c3d4e5f6g7h8/tests/tst_01j7h8k9a1b2c3d4e5f6g7h8/publish" \
  -H "x-api-key: pk_live_secretkey123" \
  -H "Content-Type: application/json"
```

---

## 5. Candidate Runtime & Assessment Delivery

### Get Test Landing Payload
```bash
curl -X GET "https://exam.example.org/api/v1/run/engineering-faculty/midterm-2026" \
  -H "Accept: application/json"
```

### Register Candidate
```bash
curl -X POST "https://exam.example.org/api/v1/run/engineering-faculty/midterm-2026/register" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alex Smith",
    "email": "alex.smith@example.edu",
    "powSolution": 128492
  }'
```

### Submit Exam Attempt
```bash
curl -X POST "https://exam.example.org/api/v1/run/attempt/submit" \
  -H "Cookie: session=<candidate-session>"
```

**Response (200 OK):**
```json
{
  "receipt": {
    "attemptId": "att_01j7h8k9a1b2c3d4e5f6g7h8",
    "submittedAt": 1729900800000,
    "answeredCount": 40,
    "totalQuestions": 40,
    "resultCode": "res_8f7b2c"
  },
  "released": null
}
```

---

## 6. Export Results

### Download Results CSV
```bash
curl -X GET "https://exam.example.org/api/v1/workspaces/wsp_01j7h8k9a1b2c3d4e5f6g7h8/tests/tst_01j7h8k9a1b2c3d4e5f6g7h8/export/results.csv" \
  -H "x-api-key: pk_live_secretkey123" \
  -o results.csv
```
