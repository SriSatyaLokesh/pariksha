import { describe, it, expect, vi, afterEach } from "vitest";
import { createApiClient } from "../src/lib/api";

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
