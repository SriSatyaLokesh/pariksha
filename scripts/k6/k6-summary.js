/**
 * Formats k6 JSON summary into a clean markdown scoreboard (AC-29).
 */

export function generateMarkdownSummary(data) {
  const httpReqs = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const failedReqs = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate * 100 : 0;
  const p95Duration = data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(95)"] : 0;
  const p99Duration = data.metrics.http_req_duration ? data.metrics.http_req_duration.values["p(99)"] : 0;
  const avgDuration = data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg : 0;

  const passedThresholds = failedReqs < 0.5 && p95Duration <= 300;

  return `# Pariksha Load Test Summary (AC-29)

| Metric | Target (AC-29) | Measured Result | Status |
| :--- | :--- | :--- | :--- |
| **Total Requests** | — | ${httpReqs} | Complete |
| **Error Rate** | < 0.5% | ${failedReqs.toFixed(2)}% | ${failedReqs < 0.5 ? "PASSED" : "FAILED"} |
| **P95 Latency** | ≤ 300 ms | ${p95Duration.toFixed(1)} ms | ${p95Duration <= 300 ? "PASSED" : "FAILED"} |
| **P99 Latency** | — | ${p99Duration.toFixed(1)} ms | Info |
| **Avg Latency** | — | ${avgDuration.toFixed(1)} ms | Info |

**Overall Gate Status:** ${passedThresholds ? "AC-29 MET" : "AC-29 FAILED"}
`;
}
