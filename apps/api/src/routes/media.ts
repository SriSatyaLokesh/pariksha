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

import { Hono } from "hono";
import { getBank } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";

/** `pariksha/question@1` allows `media.kind: "image"` only (docs/design.md,
 * "What was rejected and why"), so this is the whole set. */
const MEDIA_TYPE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const EXT_MEDIA_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(MEDIA_TYPE_EXT).map(([type, ext]) => [ext, type]),
);

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
      throw new ApiError(400, "invalid_request", "Only PNG, JPEG, GIF, WebP or SVG images are accepted.");
    }

    const bytes = await c.req.raw.arrayBuffer();
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
      // Content-addressed: the bytes behind this exact key never change.
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  return routes;
}
