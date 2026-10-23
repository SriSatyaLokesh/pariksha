# Verifying a Pariksha webhook signature

Every webhook delivery carries an `X-Pariksha-Signature` header:

```
X-Pariksha-Signature: t=1700000000,v1=4d181741f26eb47ccebbb470b36beff1a3643ad7ed2622f3e96c99adbd160ab1
```

- `t` — the Unix timestamp (seconds) at which the request was signed.
- `v1` — lowercase hex HMAC-SHA256 of the ASCII string `"<t>.<raw request body>"`,
  keyed with the webhook's signing secret (the `whsec_...` value shown once
  when the webhook was created).

Worked example, so you can check your own implementation before pointing it
at a live endpoint: with secret `whsec_example`, timestamp `1700000000` and
body `{"event":"attempt.submitted","attemptId":"att_1"}` (exactly those
bytes, no reformatting), the signed string is
`1700000000.{"event":"attempt.submitted","attemptId":"att_1"}` and its
HMAC-SHA256 hex digest is the `v1` value above.

**Sign the exact bytes you received as the request body.** Do not parse the
JSON and re-serialise it before verifying — key order or whitespace can
differ from what was signed, and the check will fail even for a genuine
delivery. Read the raw body as a string (or bytes), concatenate it onto `t`
with a single `.`, and HMAC that.

## Reference implementation (Node.js)

```js
const crypto = require("node:crypto");

function verify(header, rawBody, secret) {
  const t = /t=(\d+)/.exec(header)?.[1];
  const v1 = /v1=([0-9a-f]+)/.exec(header)?.[1];
  if (!t || !v1) return false;

  const expected = crypto.createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest();
  const received = Buffer.from(v1, "hex");

  // Timing-safe comparison: a plain `===`/`.equals()` on a MAC leaks
  // timing information an attacker can use to forge a valid signature
  // byte by byte.
  return expected.length === received.length &&
    crypto.timingSafeEqual(expected, received);
}
```

Reject the delivery if `verify()` returns `false`, or if `t` is further in
the past than the replay window you are willing to accept (Pariksha does not
currently enforce one on the sending side beyond the retry window described
below — a receiver that wants replay protection should check `t` itself).

## What can change `t`

A delivery is retried with backoff for up to 24 hours if your endpoint does
not answer 2xx. Each retry is signed fresh, with the `t` of that attempt —
so the same event can arrive more than once with different signatures. Treat
deliveries as at-least-once and de-duplicate on the event's own id, not on
the signature.
