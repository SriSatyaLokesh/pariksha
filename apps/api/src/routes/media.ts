// Media: the images a question's Markdown embeds.
//
// The storage key is content-addressed, `media/<workspaceId>/<sha256>.<ext>`
// (the brief's own words), so re-uploading the same bytes costs nothing —
// `put` just overwrites the same key with an identical copy — and the `GET`
// below can hand out an `immutable` cache header truthfully: the bytes
// behind a given key can never change. The `key` a client sees (in the
// upload response, and in the `GET` URL) is only the `<sha256>.<ext>` half:
// the workspace is already the route's own `:id`, and keeping it out of the
// client-facing key means `:key` stays one path segment, not one containing
// a `/`.
//
// `GET` returns the bytes itself, never a redirect to the storage origin:
// `default-src 'self'` (middleware/security.ts) would block the browser's
// follow-up request to an R2 or S3 host, so a 302 here would just be a
// dead end wrapped in an extra round trip.
//
// Fixture-review finding 11: `image/svg+xml` is not accepted. An SVG can
// carry `<script>`, and the only thing stopping stored-SVG XSS would be the
// global `script-src 'self'` in middleware/security.ts — a header someone
// edits for an unrelated reason years from now, with no local signal that
// doing so reopens this. Dropping SVG (over serving it with its own
// `Content-Security-Policy: sandbox`) is the smaller, more durable fix:
// `pariksha/question@1` only ever needed `media.kind: "image"` for diagrams
// and screenshots, not vector art, so nothing in the format loses expressive
// range.

import { Hono } from "hono";
import { getBank } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";

const MEDIA_TYPE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
/**
 * The reverse table, and the SVG refusal in the header in its usable
 * form: an extension absent from here is not servable, full stop.
 *
 * Exported for Phase 6 Task 7's attempt-scoped sibling in
 * `run/attempt.ts`, so the candidate route and the organiser route refuse
 * the same extensions off one list. Two lists would agree today and
 * disagree on the day somebody adds AVIF to one of them.
 */
export const EXT_MEDIA_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(MEDIA_TYPE_EXT).map(([type, ext]) => [ext, type]),
);

/**
 * Fixture-review finding 7: `c.req.raw.arrayBuffer()` would otherwise buffer
 * whatever an Author's browser sends in full before this route gets a
 * chance to refuse it — a 100 MB body costs the CPU time to receive and
 * SHA-256 it (the Workers CPU budget is 10ms) and a slot in R2, for a route
 * that only ever needed to carry a diagram or a screenshot through.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Reads at most `maxBytes` from `request`'s body, refusing before it reads
 * any of it when a `Content-Length` is present and already over the cap —
 * but a missing or understated one (chunked transfer, or a client that
 * simply lies) does not get a free pass: the stream itself is cut off the
 * moment the running total crosses `maxBytes`, so the worst case is
 * buffering one chunk past the cap, never the whole body.
 *
 * Fix round (whole-branch review, I2): exported so `routes/banks.ts`'s
 * import route can cap its own body the same way — `await c.req.raw.text()`
 * and `await json(c.req.raw)` there used to buffer a request whole before
 * `IMPORT_MAX_QUESTIONS`/`IMPORT_MAX_TEXT_LENGTH` ever got a chance to
 * refuse it, the exact bug this function exists to not have. `what` names
 * the body in the 413 message (an image here, a bank import there).
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
  what = "The request body",
): Promise<ArrayBuffer> {
  const tooLarge = () =>
    new ApiError(413, "payload_too_large", `${what} must be under ${maxBytes / (1024 * 1024)} MB.`);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const body = request.body;
  if (!body) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  // `for await` over the stream directly, rather than a manual
  // `getReader()`/`.read()` loop: the ceiling in this project's own
  // `tsconfig.base.json` (`lib: ["ES2023"]`, no `dom`) has no ambient name
  // for a reader's read-result type to annotate, which turned the manual
  // loop's locals into `any` as far as the linter's type information was
  // concerned even though `tsc` itself resolved them.
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export function mediaRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/:id/banks/:bankId/media", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    if (!(await getBank(deps.db, workspaceId, bankId))) {
      throw new ApiError(404, "not_found", "No such resource.");
    }

    const contentType = c.req.header("content-type") ?? "";
    const ext = MEDIA_TYPE_EXT[contentType];
    if (!ext) {
      throw new ApiError(400, "invalid_request", "Only PNG, JPEG, GIF or WebP images are accepted.");
    }

    const bytes = await readBodyWithLimit(c.req.raw, MAX_UPLOAD_BYTES, "An image");
    const key = `${await sha256Hex(bytes)}.${ext}`;
    await deps.storage.put(`media/${workspaceId}/${key}`, bytes, { contentType });

    return c.json({ key }, 201);
  });

  routes.get("/:id/media/:key", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const key = c.req.param("key");
    const ext = key.slice(key.lastIndexOf(".") + 1);
    const contentType = EXT_MEDIA_TYPE[ext];
    if (!contentType) throw new ApiError(404, "not_found", "No such resource.");

    const bytes = await deps.storage.get(`media/${workspaceId}/${key}`);
    if (!bytes) throw new ApiError(404, "not_found", "No such resource.");

    return c.body(bytes, 200, {
      "Content-Type": contentType,
      // `private`, not `public` (fixture-review finding 8, overruling the
      // brief): this response required a session cookie and `banks.edit` to
      // fetch, with no `Vary: Cookie` — `public` would let a shared cache
      // store and replay it to a second, unauthenticated requester on the
      // same path. `private` keeps the one-browser-cache scope a cookie
      // already implies while keeping the immutability the content-addressed
      // key earns.
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  });

  return routes;
}
