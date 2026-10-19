import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunClient, RunError, slugPairFromPath } from "../../src/lib/run";

// Review finding I-2. `landing.test.tsx` satisfies `RunClient` with an
// object literal, which is the right way to test the screens and the wrong
// way to test the client — so until this file existed, a wrong base path, a
// swallowed error code or a parser that accepted three segments all shipped
// green. Tasks 2, 3, 5, 8 and 11 each widen `lib/run.ts`, and every one of
// them inherits whatever is wrong here.
//
// `fetch` is stubbed rather than mocked through a library: the contract
// under test is "which URL, and what comes back out of a non-2xx body",
// and both are visible from the one call.

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(responder: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(responder(url));
  });
  return calls;
}

const ok = (body: unknown) => () => Response.json(body);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRunClient", () => {
  it("asks the candidate route for exactly the slug pair it was built with", async () => {
    const calls = stubFetch(ok({ name: "Aptitude" }));
    await createRunClient("alpha", "aptitude").landing();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/v1/run/alpha/aptitude");
  });

  it("returns the parsed body to the caller", async () => {
    stubFetch(ok({ name: "Aptitude", durationMinutes: 45 }));
    expect(await createRunClient("alpha", "aptitude").landing()).toMatchObject({
      name: "Aptitude",
      durationMinutes: 45,
    });
  });

  it("percent-encodes both slugs, because they arrive from the address bar", async () => {
    // A slug reaching this function is whatever was in the URL bar, not
    // whatever `createTest` would have allowed. Without the encoding, a
    // path segment carrying `/` or `..` reshapes the request into a
    // different route entirely.
    const calls = stubFetch(ok({}));
    await createRunClient("a/../../admin", "b c&d").landing();
    expect(calls[0]?.url).toBe("/api/v1/run/a%2F..%2F..%2Fadmin/b%20c%26d");
    expect(calls[0]?.url).not.toContain("/admin");
  });

  it("sends no credentials and asks for JSON", async () => {
    const calls = stubFetch(ok({}));
    await createRunClient("alpha", "aptitude").landing();
    expect(calls[0]?.init?.headers).toMatchObject({ accept: "application/json" });
    // A candidate carries no cookie; the attempt token (Task 5) will be its
    // own header rather than an ambient credential.
    expect(calls[0]?.init?.credentials).toBeUndefined();
  });
});

describe("the error envelope becomes a RunError", () => {
  it("carries the server's own status, code and message", async () => {
    stubFetch(() =>
      Response.json({ error: { code: "not_found", message: "No such resource." } }, { status: 404 }),
    );
    const error = await createRunClient("alpha", "nope")
      .landing()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RunError);
    expect(error).toMatchObject({
      status: 404,
      code: "not_found",
      // `ExamApp`'s error screen renders exactly this string, so a
      // swallowed message is a blank page for the candidate.
      message: "No such resource.",
      name: "RunError",
    });
  });

  it("falls back to its own code and message when the body is not the envelope", async () => {
    // A 502 from in front of the Worker is HTML, not JSON: `res.json()`
    // rejects, the `.catch(() => null)` takes over, and the candidate must
    // still get a sentence rather than a parse error.
    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const error = (await createRunClient("alpha", "aptitude")
      .landing()
      .catch((caught: unknown) => caught)) as RunError;

    expect(error).toBeInstanceOf(RunError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("request_failed");
    expect(error.message).toBe("This test is not available.");
  });

  it("falls back per field when the envelope is present but incomplete", async () => {
    stubFetch(() => Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
    const error = (await createRunClient("alpha", "aptitude")
      .landing()
      .catch((caught: unknown) => caught)) as RunError;

    expect(error.code).toBe("rate_limited");
    expect(error.message).toBe("This test is not available.");
  });

  it("does not throw on a 2xx, so the fallbacks cannot mask a success", async () => {
    // The positive control: without it every assertion above would hold
    // for a client that threw on every response.
    stubFetch(ok({ name: "Aptitude" }));
    await expect(createRunClient("alpha", "aptitude").landing()).resolves.toMatchObject({
      name: "Aptitude",
    });
  });
});

describe("slugPairFromPath", () => {
  it("reads T-02's two-segment candidate URL", () => {
    expect(slugPairFromPath("/alpha/aptitude")).toEqual({
      workspaceSlug: "alpha",
      testSlug: "aptitude",
    });
  });

  it("tolerates a trailing slash, which a browser will happily produce", () => {
    expect(slugPairFromPath("/alpha/aptitude/")).toEqual({
      workspaceSlug: "alpha",
      testSlug: "aptitude",
    });
  });

  it.each([
    ["the site root", "/"],
    ["one segment", "/alpha"],
    ["three segments", "/alpha/aptitude/extra"],
    ["the organiser entry", "/admin.html"],
    ["an empty string", ""],
  ])("refuses %s", (_name, pathname) => {
    // Three segments matters specifically: `_redirects` only rewrites a
    // two-segment path onto exam.html, so a three-segment path reaching
    // this function at all means something is wrong — answering with its
    // first two segments would ask the API about a test nobody named.
    expect(slugPairFromPath(pathname)).toBeNull();
  });
});

describe("the access gate (Task 2)", () => {
  it("posts the whole access request as JSON to the gate's own path", async () => {
    const calls = stubFetch(ok({ entryToken: "tok" }));
    const result = await createRunClient("alpha", "aptitude").access({
      code: "OPENSESAME",
      identifier: "21CS0147",
    });

    expect(calls[0]?.url).toBe("/api/v1/run/alpha/aptitude/access");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      code: "OPENSESAME",
      identifier: "21CS0147",
    });
    expect(result).toEqual({ entryToken: "tok" });
  });

  it("turns the server's refusal into a RunError carrying its code and its sentence", async () => {
    // The screen shows the server's message and never a status code
    // (C-02), so losing either here is losing the whole of C-02.
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: "code_wrong", message: "Check the code with your organiser." } }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const failure = await createRunClient("alpha", "aptitude")
      .access({ code: "nope" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RunError);
    expect(failure).toMatchObject({
      status: 403,
      code: "code_wrong",
      message: "Check the code with your organiser.",
    });
  });

  it("posts the address to the email-code leg and resolves on a bodyless 202", async () => {
    // The route answers 202 with a body, but a deployment behind a proxy
    // that strips it must not turn "sent" into a parse error.
    const calls = stubFetch(() => new Response(null, { status: 202 }));
    await expect(createRunClient("alpha", "otp").requestEmailCode("a@b.ac.in")).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe("/api/v1/run/alpha/otp/email-code");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: "a@b.ac.in" });
  });

  it("the email-code leg still raises the server's refusal", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: "domain_not_allowed", message: "Allowed: *.ac.in." } }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(
      createRunClient("alpha", "otp").requestEmailCode("a@gmail.com"),
    ).rejects.toMatchObject({ code: "domain_not_allowed" });
  });
});
