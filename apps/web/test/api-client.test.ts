import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, createApiClient } from "../src/lib/api";

// Fix round 1, finding 2: a group's `id` is author-written (unlike every
// other id this client interpolates into a URL — a question's `:qid` is
// always the server-generated row id) and reaches `updateGroup`/
// `deleteGroup`'s path unencoded before this fix. `createApiClient()` has no
// other test anywhere in the repo (every screen test talks to a typed
// `fakeClient()` instead), so this is the one place the real path
// construction is checked at all.
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("createApiClient: group routes encode an author-written id", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes the group id in updateGroup's URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ id: "a/b", passage: "x", questionCount: 0 }));
    vi.stubGlobal("fetch", fetchSpy);

    await createApiClient().updateGroup("wsp_1", "bnk_1", "a/b", { passage: "y" });

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("/api/v1/workspaces/wsp_1/banks/bnk_1/groups/a%2Fb");
  });

  it("encodes the group id in deleteGroup's URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    await createApiClient().deleteGroup("wsp_1", "bnk_1", "../other-bank");

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("/api/v1/workspaces/wsp_1/banks/bnk_1/groups/..%2Fother-bank");
  });
});

// Fix round 1, finding 3: `importBank`'s 422-to-`ImportReport` normalisation
// is its own branch — untested until now, every component test having
// exercised it only through an already-normalised fake. These hit the real
// `request`/`json` plumbing with a stubbed `fetch`, the same harness the
// group-id tests above use, so the normalisation itself (not a stand-in for
// it) is what is checked.
describe("createApiClient: importBank normalises a 422 into an ImportReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
    return new Response(JSON.stringify({ error: { code, message, details } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("a 422 with details.issues resolves to an ImportReport rather than throwing", async () => {
    const issues = [{ questionId: "LOG-001", index: 5, field: "key", message: "not among the options" }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorResponse(422, "invalid_import", "The import could not be validated.", {
        imported: 0,
        issues,
      })),
    );

    const report = await createApiClient().importBank("wsp_1", "bnk_1", { questions: [] });

    expect(report).toEqual({ imported: 0, issues });
  });

  it("a 413 (not a validation report) still throws ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorResponse(413, "import_too_large", "An import is limited to 500 questions.")),
    );

    await expect(createApiClient().importBank("wsp_1", "bnk_1", { questions: [] })).rejects.toMatchObject({
      status: 413,
      code: "import_too_large",
    });
  });

  it("a 422 whose details carry no issues array still throws, rather than fabricating a report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorResponse(422, "invalid_request", "The request body is not valid.", {
        issues: [{ path: "name", message: "Required" }],
      })),
    );

    // Shaped like a different route's validation error (zod issues keyed by
    // `path`, no `imported`) — `isImportReport` must reject it rather than
    // pattern-matching on `issues` being an array at all.
    await expect(createApiClient().importBank("wsp_1", "bnk_1", { questions: [] })).rejects.toBeInstanceOf(ApiError);
  });

  it("dryRun: true appends ?dryRun=1; omitting it does not", async () => {
    // A fresh `Response` per call: the same instance's body can only be
    // read once, and this test calls `importBank` twice.
    const fetchSpy = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify({ imported: 0, issues: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await createApiClient().importBank("wsp_1", "bnk_1", { questions: [] }, { dryRun: true });
    await createApiClient().importBank("wsp_1", "bnk_1", { questions: [] });

    const urls = fetchSpy.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual([
      "/api/v1/workspaces/wsp_1/banks/bnk_1/import?dryRun=1",
      "/api/v1/workspaces/wsp_1/banks/bnk_1/import",
    ]);
  });
});
