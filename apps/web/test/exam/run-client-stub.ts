// The half of `RunClient` no runner test exercises.
//
// Six suites each hand-roll a `RunClient` literal, and Task 11 widened the
// interface by four methods. Rather than paste the same four rejections
// into six files — and into the seventh the next task writes — they are
// here once, spread into each stub. A suite that *does* exercise one
// overrides it, exactly as every other method in those stubs is overridden.
//
// They reject rather than resolve on purpose: a test that reaches the
// submit path without saying so should fail loudly, not quietly pass over
// a `Promise.resolve(null)`.

import type { ReleasedResult, Receipt, RunClient } from "../../src/lib/run";

export const RESULT_STUB: Pick<
  RunClient,
  "submit" | "result" | "requestResultCode" | "verifyResultCode"
> = {
  submit: (): Promise<{ receipt: Receipt; released: ReleasedResult | null }> =>
    Promise.reject(new Error("this test does not submit")),
  result: (): Promise<ReleasedResult | null> =>
    Promise.reject(new Error("this test reads no result")),
  requestResultCode: (): Promise<void> =>
    Promise.reject(new Error("this test asks for no result code")),
  verifyResultCode: (): Promise<ReleasedResult | null> =>
    Promise.reject(new Error("this test verifies no result code")),
};
