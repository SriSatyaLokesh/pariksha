import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOT_CHECK_MESSAGE,
  createRunClient,
  REGISTER_PENDING_MESSAGE,
  RegistrationInvalid,
  RunError,
  slugPairFromPath,
  solvePow,
} from "../../src/lib/run";

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

/**
 * Task 4 (#68, ADR 0009): `register` now pays a proof of work first, so
 * every stub a registration runs against has to answer `/challenge` too.
 * Eight bits here rather than the shipped sixteen — the difficulty is the
 * *server's* to state, and these tests are about which URL is called with
 * what, not about how long a search takes. The shipped number is pinned in
 * `apps/api/test/run/pow.test.ts`, and the cost of paying it is measured
 * below.
 */
const CHALLENGE = { challenge: "stub-challenge", bits: 8 };

const withChallenge =
  (responder: (url: string) => Response) =>
  (url: string): Response =>
    url.endsWith("/challenge") ? Response.json(CHALLENGE) : responder(url);

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

  // --- Task 3 (#67): consent and registration -------------------------

  const header = (init: RequestInit | undefined): string =>
    String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");

  it("reads the form behind the entry token, as a Bearer header", async () => {
    const calls = stubFetch(
      () =>
        new Response(JSON.stringify({ consent: { version: "1", text: "x" }, form: { fields: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const payload = await createRunClient("alpha", "signup").form("tok");
    expect(calls[0]?.url).toBe("/api/v1/run/alpha/signup/form");
    // The token is a header, never a query parameter: a URL reaches a
    // proxy log and the browser's own history, and this one is a
    // credential.
    expect(header(calls[0]?.init)).toBe("Bearer tok");
    expect(payload.consent).toEqual({ version: "1", text: "x" });
  });

  it("posts the registration with its token and resolves the token /start spends", async () => {
    const calls = stubFetch(
      withChallenge(
        () =>
          new Response(JSON.stringify({ registrationToken: "reg" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      createRunClient("alpha", "signup").register("tok", { email: "a@b.ac.in", consent: true }, "cap"),
    ).resolves.toEqual({ registrationToken: "reg" });

    // The challenge first, behind the same Bearer header: it is cut from
    // that token, so no other caller could ask for it.
    expect(calls[0]?.url).toBe("/api/v1/run/alpha/signup/challenge");
    expect(header(calls[0]?.init)).toBe("Bearer tok");

    expect(calls[1]?.url).toBe("/api/v1/run/alpha/signup/register");
    expect(header(calls[1]?.init)).toBe("Bearer tok");
    const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(body.values).toEqual({ email: "a@b.ac.in", consent: true });
    expect(body.captchaToken).toBe("cap");
    expect(typeof body.solution).toBe("string");
  });

  it("S-07: the solution it posts really solves the challenge the server stated", async () => {
    const calls = stubFetch(withChallenge(() => Response.json({ registrationToken: "reg" })));
    await createRunClient("alpha", "signup").register("tok", {});
    const { solution } = JSON.parse(String(calls[1]?.init?.body)) as { solution: string };
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${CHALLENGE.challenge}:${solution}`),
      ),
    );
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(hex.startsWith("00")).toBe(true);
  });

  it("the second press during a solve joins the first, rather than earning a 410", async () => {
    // The proof of work turned a one-round-trip submit into seconds of
    // work, and the entry token is single use: two presses used to mean
    // two challenges, two solves and two POSTs, with the loser told
    // "this registration link is no longer valid" right before a timed
    // exam. One registration per entry token at a time.
    const calls = stubFetch(withChallenge(() => Response.json({ registrationToken: "reg" })));
    const client = createRunClient("alpha", "signup");
    const [first, second] = await Promise.all([
      client.register("tok", { email: "a@b.ac.in" }),
      client.register("tok", { email: "a@b.ac.in" }),
    ]);
    expect(first).toEqual({ registrationToken: "reg" });
    expect(second).toEqual(first);
    // One challenge and one register, not two of each.
    expect(calls.map((call) => call.url)).toEqual([
      "/api/v1/run/alpha/signup/challenge",
      "/api/v1/run/alpha/signup/register",
    ]);
  });

  it("a refused registration can be corrected and resubmitted on the same entry token", async () => {
    // The de-duplication must not become a latch: a 422 is a form the
    // candidate fixes and sends again, against the entry token the
    // server never consumed.
    let refuse = true;
    const calls = stubFetch(
      withChallenge(() => {
        if (!refuse) return Response.json({ registrationToken: "reg" });
        refuse = false;
        return new Response(
          JSON.stringify({
            error: { code: "invalid_registration", message: "x", details: { issues: [] } },
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const client = createRunClient("alpha", "signup");
    await expect(client.register("tok", {})).rejects.toBeInstanceOf(RegistrationInvalid);
    await expect(client.register("tok", {})).resolves.toEqual({ registrationToken: "reg" });
    expect(calls).toHaveLength(4);
  });

  it("two candidates registering at once are not de-duplicated into one", async () => {
    // The key is the entry token, not the client: two tabs, two gates,
    // two tokens, two registrations.
    const calls = stubFetch(withChallenge(() => Response.json({ registrationToken: "reg" })));
    const client = createRunClient("alpha", "signup");
    await Promise.all([client.register("tok-a", {}), client.register("tok-b", {})]);
    expect(calls.filter((call) => call.url.endsWith("/register"))).toHaveLength(2);
  });

  it("C-02: the pending copy exists, because the submit now takes seconds", () => {
    // A screen that shows nothing for a one-to-four-second solve invites
    // the second press this client now absorbs; the sentence lives here
    // so both the screen and this file name it the same way.
    expect(REGISTER_PENDING_MESSAGE).toMatch(/check/i);
  });

  it("C-02: a browser that cannot run the check says so, rather than leaving a dead button", async () => {
    stubFetch(withChallenge(() => Response.json({ registrationToken: "reg" })));
    vi.stubGlobal("crypto", {
      ...crypto,
      subtle: { digest: () => Promise.reject(new Error("no subtle")) },
    });
    const failure = await createRunClient("alpha", "signup")
      .register("tok", {})
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RunError);
    expect((failure as RunError).code).toBe("bot_check_failed");
    expect((failure as RunError).message).toBe(BOT_CHECK_MESSAGE);
    expect(BOT_CHECK_MESSAGE).toMatch(/reload|ask|try/i);
  });

  it("S-11: solving reaches no network at all — it is WebCrypto and nothing else", async () => {
    const calls = stubFetch(() => Response.json({}));
    await solvePow("abc", 8);
    expect(calls).toEqual([]);
  });

  it("the work is bounded: the shipped difficulty stays well under 3 s here", async () => {
    // Sixteen bits is what `apps/api/src/run/pow.ts` ships and what
    // `pow.test.ts` pins. jsdom on a developer machine is not a phone, so
    // this is a ceiling rather than the measurement — but a change that
    // made the search an order of magnitude dearer would trip it.
    const started = performance.now();
    await solvePow("bounded-challenge", 16);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("the difficulty is bits, not hex characters, so raising it to 18 really costs more", async () => {
    const solution = await solvePow("granular", 10);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`granular:${solution}`)),
    );
    // Ten bits: a zero first byte, and the top two bits of the second.
    expect(digest[0]).toBe(0);
    expect((digest[1] ?? 255) >> 6).toBe(0);
  });

  it("a 422 arrives as RegistrationInvalid carrying every positioned issue", async () => {
    // AC-12: the screen puts each sentence back beside its own input, so
    // a client that flattened these to one message would lose the
    // positioning the server went to the trouble of sending.
    const issues = [
      { field: "email", code: "domain", message: "Use an address at *.ac.in." },
      { field: "roll", code: "pattern", message: "Format: 21CS0147" },
    ];
    stubFetch(
      withChallenge(
        () =>
          new Response(
            JSON.stringify({
              error: { code: "invalid_registration", message: "Some answers need another look.", details: { issues } },
            }),
            { status: 422, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const failure = await createRunClient("alpha", "signup")
      .register("tok", {})
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RegistrationInvalid);
    expect(failure).toBeInstanceOf(RunError);
    expect((failure as RegistrationInvalid).issues).toEqual(issues);
    expect((failure as RegistrationInvalid).status).toBe(422);
  });

  it("a spent entry token is an ordinary RunError, not a validation failure", async () => {
    stubFetch(
      withChallenge(
        () =>
          new Response(
            JSON.stringify({ error: { code: "entry_expired", message: "Go back to the test page and try again." } }),
            { status: 410, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const failure = await createRunClient("alpha", "signup")
      .form("spent")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RunError);
    expect(failure).not.toBeInstanceOf(RegistrationInvalid);
    expect(failure).toMatchObject({ status: 410, code: "entry_expired" });
  });
});
