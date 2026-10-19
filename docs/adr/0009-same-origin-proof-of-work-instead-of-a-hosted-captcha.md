# 0009. A same-origin proof of work instead of a hosted captcha

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The PRD asks for two things that cannot both be true on the same deployment,
and it asks for them in the same document.

**It names a hosted captcha in three places**, and a fourth sits in an earlier
ADR.

- [`docs/PRD.md`](../PRD.md), `S-07`: "Registration is protected by Cloudflare
  Turnstile or hCaptcha (both free) **and** by rate limits per attempt and per
  test. Limits are not per IP, because a whole campus often shares one IP."
- [`docs/PRD.md`](../PRD.md), the reference-stack diagram: "Reference:
  Cloudflare free plan — Pages, Workers, D1, R2, **Turnstile**".
- [`docs/PRD.md`](../PRD.md), the adapter table: "Bot protection | **Turnstile**
  | hCaptcha or Turnstile".

**[ADR 0002](0002-cloudflare-reference-stack-with-adapters.md) repeats it**, in
the sentence a reader lands on when they ask what the reference deployment is
made of: "The reference deployment uses Cloudflare Pages, Workers, D1, R2,
**Turnstile** and Cron Triggers on the free plan", with "identity (OIDC, email,
**captcha**)" beside it. **This ADR amends that list.** 0002 is not rewritten —
an ADR is a record of what was decided when — but it now carries a pointer here,
and this is the fourth place the same requirement is stated.

**And one clause forbids all four, in a promise the product is marketed on.**
`S-11`: "Collect only what the test's form asks for. No analytics, telemetry or
third-party scripts; fonts and the face model are served from the app itself."

That is not a stylistic tension. A Turnstile or hCaptcha widget is a script
from `challenges.cloudflare.com` (or `hcaptcha.com`) in an iframe that calls
home, so it needs `script-src`, `frame-src` and `connect-src` entries in a
Content-Security-Policy that is `'self'` throughout, in two files that must
stay byte-identical —
[`apps/api/src/middleware/security.ts`](../../apps/api/src/middleware/security.ts)
and [`apps/web/public/_headers`](../../apps/web/public/_headers) — one of which
[`apps/web/test/hosting.test.ts`](../../apps/web/test/hosting.test.ts) pins by
asserting the shipped headers match no `https?://` **at all**. The landing page
sells the absence of exactly those directives.

Three further facts narrowed the choice:

- **`AC-01` promises a working deployment in thirty minutes "using no paid
  service".** Whatever ships by default has to work on an instance whose
  operator has signed up for nothing and configured nothing.
- **`S-07`'s second half is not in dispute.** Rate limits per attempt and per
  test, never per IP, are built: a `rate_limit` table, `LIMITS`, `limitOrThrow`
  and `limitMisses` in [`apps/api/src/run/limit.ts`](../../apps/api/src/run/limit.ts),
  covering the access gate (`test_access`, misses only), the emailed code
  (`email_code` per test version **and** `email_code_address` per digest of the
  address — the two shapes a code-sending route is abused in), registration
  (`test_register`) and the short link (`short_link`, instance-wide, because a
  sweep across a six-character space never guesses the same code twice).
- **A captcha's job here is narrow.** It is not identity and not proctoring
  (`P-01` already blocks phones on a proctored test, and the candidate list,
  invite links and emailed codes already gate who may register at all). It is
  one thing: make bulk registration on a public `link_code` test cost
  something.

## Decision

**Registration is protected by a same-origin proof of work, and a hosted
captcha is a per-instance opt-in that is off by default.**

The default control is in
[`apps/api/src/run/pow.ts`](../../apps/api/src/run/pow.ts) and
[`apps/web/src/lib/run.ts`](../../apps/web/src/lib/run.ts):
`GET /api/v1/run/:workspaceSlug/:testSlug/challenge`, behind the entry token,
answers `{ challenge, bits }`; the browser searches with WebCrypto for a
counter whose SHA-256 over the challenge has `POW_DIFFICULTY_BITS` leading zero
bits; `POST .../register` refuses 403 `bot_check_failed` without one. No
script, no iframe, no origin but this one, and no change to the CSP.

**The challenge is derived, not minted.** It is `sha256("pow:" + entryToken)`,
a digest of the single-use `run_entry` token the access gate already handed
this candidate. That one choice supplies every property a challenge table
would have, for no storage: it is unpredictable (the entry token is 256
CSPRNG bits), single-use (registration consumes the entry token in the same
batch, so replaying a solution is replaying the token — already a 410),
bound to the test (`entryHash` salts an entry row with its test version, so a
solution earned elsewhere matches no row here), and expiring (the entry
token's own 30-minute TTL). Issuing a challenge therefore costs no write and
verifying one costs no read.

**The difficulty is 16 bits**, about 65 000 digests, and the server states it
in the response rather than the browser compiling it in — so raising it is an
API deploy, not a web one.

**The seam ships, switched off.** `CAPTCHA_SECRET` and `CAPTCHA_VERIFY_URL`
([`apps/api/src/env.ts`](../../apps/api/src/env.ts)), `access.captcha` per
test, and `captchaConfigured` / `captchaRequired` / `verifyCaptcha`
([`apps/api/src/run/captcha.ts`](../../apps/api/src/run/captcha.ts)) are all
built and wired into the registration route. `verifyCaptcha` **returns true
when nothing is configured**, because `AC-01` promises a deployment that works
with no provider account. The provider's endpoint is configuration rather than
a constant, so no third-party hostname appears in this source tree at all.

An operator who wants the stronger guarantee sets the two variables, adds the
three directives their widget needs to their own `_headers`, and accepts that
their instance no longer satisfies `S-11`. The proof of work still runs on
such an instance: the captcha is an addition, never a replacement.

**This decision changes no CSP, in either file. That is the decision, rather
than an exception to it.**

## Consequences

**`S-07` is partly met, and is recorded as partly met rather than quietly
treated as satisfied.** Its second half — rate limits per attempt and per test,
never per IP — ships in full. Its first half does not, on the default
deployment. The PRD's three Turnstile mentions are amended to say what the
product actually does and to point here; the `S-07` line carries the
"partly met" marker.

**The guarantee really is weaker, and the difference is worth naming.** A
hosted captcha brings a vendor's cross-site behavioural signal to bear on each
registration. A proof of work brings arithmetic. A farm with real CPU
registers anyway — it simply pays ~65 000 hashes per fake candidate on top of
whatever the `test_register` bucket allows. What is bought for that is that a
public `link_code` test cannot be filled from a single tab with a loop, and
that every default deployment keeps the `'self'` policy the landing page
promises. If that trade is ever judged wrong, the recovery is an environment
variable and three CSP lines on one instance — not a code change, because the
seam is already here.

**The honest reason, stated plainly:** the cheaper option was refused rather
than overlooked. `S-11` is the clause this product is marketed on and the one
a self-hoster cannot restore after the fact; a third-party script added to the
default deployment would quietly spend it on everyone's behalf.

**Cost to a candidate.** Measured at the shipped 16 bits on a desktop
(Node/OpenSSL WebCrypto, 20 runs): median 332 ms, mean 416 ms, p90 1.0 s. The
search is batched — `crypto.subtle.digest` is asynchronous, so awaiting one
digest at a time costs ~22 µs of promise and thread-hop overhead per hash
rather than the ~0.2 µs the hash itself takes; issuing a block of 256 and
awaiting them together brings it to ~5 µs. A budget Android is perhaps three
to four times slower, which puts the median near a second and the tail past
two.

**Why 16 bits, and why the number is not the interesting part.** 2¹⁶ digests is
roughly six milliseconds of native CPU to anyone who wants to spend it — ten
million SHA-256 a second is an ordinary machine. So the work factor does not
bound a determined farm at any difficulty a candidate would tolerate; what
bounds bulk registration is `test_register`, at 1000 per five minutes per test
version. The bit count is therefore a dial between "costs a `curl` loop
something" and "costs a candidate something", with no security gradient in the
range worth arguing about: 18 would quadruple a phone's wait for nothing, and
14 would save a phone most of a second for nothing. 16 is kept.

**The real exposure the measurement points at is the second press, not the
wait.** Submitting used to be one round trip and is now a round trip, a
multi-second search and a second round trip. The entry token is single use, so
two presses meant two challenges, two solves and two writes against one token —
and the loser was told *"this registration link is no longer valid"* moments
before a timed exam. A Web Worker does **not** fix that, and would not help with
the wait either: `solvePow` awaits a block of 256 digests at a time, so it
already yields to the event loop hundreds of times during a search and the page
is never frozen. The fix is in two places, both shipped or required here:
`createRunClient`'s `register()` de-duplicates concurrent calls on one entry
token so the second press joins the first, and the registration screen must
disable its control and show `REGISTER_PENDING_MESSAGE` for the duration.

**To watch.**

1. **The registration screen must disable the submit while `register()` runs**
   and show the pending line. The client-side de-duplication makes a second
   press harmless, but a control that looks dead for several seconds before a
   timed exam is its own defect. This, not a Web Worker, is what the
   measurement calls for.
2. **Measure the solve on a real phone before the first live unproctored
   test** — the numbers above are a desktop measurement and an extrapolation.
   If a phone is far worse than four times slower, lower `POW_DIFFICULTY_BITS`
   rather than contorting the implementation: per the paragraph above, the work
   factor is not what is holding the line.
3. **If a real deployment is overrun despite the rate limits,** the answer is
   the buckets, not the bits — tighten `test_register`, and only then revisit
   this record.
4. **If `S-11` is ever relaxed for some other reason,** reconsider this ADR
   rather than silently inheriting it: the whole argument rests on `S-11`
   holding.
5. **A sweep for `rate_limit` rows** belongs beside the retention job; until
   then the table grows one row per bucket per window.
