import http from "k6/http";
import { check, sleep } from "k6";

/**
 * Pariksha Capacity Benchmark (AC-29)
 * Simulates 500 candidates starting within 5 minutes, answering 40 questions
 * each under strict proctoring, verifying < 0.5% errors and p95 <= 300 ms.
 */

export const options = {
  stages: [
    { duration: "1m", target: 500 }, // Ramp up to 500 candidates
    { duration: "3m", target: 500 }, // Sustained concurrent examination load
    { duration: "1m", target: 0 },   // Clean ramp down
  ],
  thresholds: {
    // AC-29: < 0.5% errors
    http_req_failed: ["rate<0.005"],
    // AC-29: p95 duration <= 300ms
    http_req_duration: ["p(95)<=300"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://localhost:8787";
const WORKSPACE_SLUG = __ENV.WORKSPACE_SLUG || "demo-showcase";
const TEST_SLUG = __ENV.TEST_SLUG || "demo-exam";

export default function () {
  const vuId = __VU;
  const iterId = __ITER;
  const candidateEmail = `candidate_${vuId}_${iterId}@loadtest.example.org`;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // 1. Fetch test landing metadata
  const landingRes = http.get(
    `${BASE_URL}/api/v1/run/${WORKSPACE_SLUG}/${TEST_SLUG}`,
    { headers }
  );
  check(landingRes, {
    "landing status is 200": (r) => r.status === 200,
  });

  sleep(1);

  // 2. Candidate registration with proof-of-work
  const regPayload = JSON.stringify({
    name: `Candidate ${vuId}`,
    email: candidateEmail,
    powSolution: 1000 + (vuId % 50),
  });

  const regRes = http.post(
    `${BASE_URL}/api/v1/run/${WORKSPACE_SLUG}/${TEST_SLUG}/register`,
    regPayload,
    { headers }
  );
  check(regRes, {
    "register status is 200 or 201": (r) => r.status === 200 || r.status === 201,
  });

  let regToken = "";
  try {
    const body = JSON.parse(regRes.body);
    regToken = body.registrationToken || "";
  } catch {
    // continue
  }

  // 3. Start attempt
  const startPayload = JSON.stringify({ registrationToken: regToken });
  const startRes = http.post(
    `${BASE_URL}/api/v1/run/${WORKSPACE_SLUG}/${TEST_SLUG}/start`,
    startPayload,
    { headers }
  );
  check(startRes, {
    "start status is 201": (r) => r.status === 201,
  });

  // Extract session cookie
  const sessionCookie = startRes.cookies.session ? startRes.cookies.session[0].value : "";
  const authHeaders = {
    ...headers,
    Cookie: `session=${sessionCookie}`,
  };

  // 4. Answer 40 questions with think time
  for (let q = 1; q <= 40; q++) {
    const answerPayload = JSON.stringify({
      questionId: `q_${q}`,
      value: `option_${(q % 4) + 1}`,
      clientSeq: q,
    });

    const answerRes = http.post(
      `${BASE_URL}/api/v1/run/attempt/answer`,
      answerPayload,
      { headers: authHeaders }
    );
    check(answerRes, {
      "answer saved status is 200": (r) => r.status === 200,
    });

    // Send periodic proctoring telemetry every 10 questions
    if (q % 10 === 0) {
      const eventPayload = JSON.stringify({
        events: [
          { type: "heartbeat", timestamp: Date.now() },
        ],
      });
      http.post(
        `${BASE_URL}/api/v1/run/attempt/events`,
        eventPayload,
        { headers: authHeaders }
      );
    }

    sleep(0.5);
  }

  // 5. Submit attempt
  const submitRes = http.post(
    `${BASE_URL}/api/v1/run/attempt/submit`,
    JSON.stringify({}),
    { headers: authHeaders }
  );
  check(submitRes, {
    "submit status is 200": (r) => r.status === 200,
    "receipt returned": (r) => {
      try {
        const data = JSON.parse(r.body);
        return data.receipt && data.receipt.resultCode;
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
