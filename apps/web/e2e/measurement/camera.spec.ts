// Phase 7d Task 2 (`P-06`/`Q11a`, D-R1): the encoder measurement jsdom
// cannot run.
//
// `test/exam/camera-gate.test.tsx`'s own header explains why at length —
// jsdom implements neither `HTMLCanvasElement.getContext` nor `toBlob`
// (confirmed against this workspace's jsdom source: with no `canvas` npm
// package installed, `getContext` returns `null` and `toBlob` never calls
// its callback at all). The brief's fourth test —
//
//     const blob = await captureJpeg(fakeStream({ width: 1280, height: 720 }));
//     expect(blob!.type).toBe("image/jpeg");
//     expect(blob!.size).toBeLessThan(60_000);
//     expect(await dimensionsOf(blob!)).toEqual({ width: 320, height: 240 });
//
// moves here, verbatim in spirit, against a REAL encode: Chromium launched
// with `--use-fake-device-for-media-stream` (a real synthetic camera,
// `getUserMedia` included) and `--use-fake-ui-for-media-stream` (the
// permission prompt answers itself, the same way a real candidate's
// "Allow" click does — there is no dialog for Playwright to drive, and
// `--use-fake-ui-for-media-stream` is the standard way to skip one in a
// headless run rather than a shortcut around `P-05`'s own gate, which this
// file also exercises for real by going through the whole registration
// flow). `test.use` below scopes those flags to this file alone — nothing
// else in this suite asks a real camera for anything.
//
// Placed in `measurement/` for the reason every file here gives
// (`field-rows.spec.ts`'s header, at length): Playwright runs files in
// sorted-path order under `workers: 1`, and `measurement/` sorts after
// `e2e/first-run.spec.ts`, which needs an instance nothing has seeded yet.
// AND it seeds its own workspace (`createWorkspace`), never `workspaces[0]`
// — `D13`'s density ratchet's own isolation rule, one level down.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createWorkspace } from "../seed";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

interface SeededAttempt {
  workspaceSlug: string;
  testSlug: string;
  accessCode: string;
}

async function created(request: APIRequestContext, url: string, body: unknown): Promise<string> {
  const res = await request.post(url, { data: body });
  expect(res.ok(), `POST ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  const id = (await res.json()).id;
  expect(typeof id, `${url} answered no id`).toBe("string");
  return id as string;
}

async function ok(request: APIRequestContext, url: string, body: unknown): Promise<void> {
  const res = await request.post(url, { data: body });
  expect(res.ok(), `POST ${url} → ${res.status()} ${await res.text()}`).toBe(true);
}

async function patched(request: APIRequestContext, url: string, body: unknown): Promise<void> {
  const res = await request.patch(url, { data: body });
  expect(res.ok(), `PATCH ${url} → ${res.status()} ${await res.text()}`).toBe(true);
}

/** One workspace, one bank, one question, one published test —
 *  `require_camera` and `identity_photo` on, `desktop_only` off so Task
 *  3's device gate never competes for the floor with this file's own
 *  assertions (the same isolation `seedProctoringTest` and
 *  `seedWatermarkTest` each take for their own one control). */
async function seedCameraTest(request: APIRequestContext): Promise<SeededAttempt> {
  const slug = "camera-e2e";
  const workspaceId = await createWorkspace(request, "Camera e2e", slug);

  const bankId = await created(request, `/api/v1/workspaces/${workspaceId}/banks`, {
    name: "Camera e2e bank",
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`, {
    format: "pariksha/bank@1",
    name: "Camera e2e bank",
    questions: [
      { id: "Q01", type: "true_false", prompt: "This statement is true.", key: true, points: 1 },
    ],
  });
  const questions = await request.get(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`);
  expect(questions.ok()).toBe(true);
  const questionId = ((await questions.json()).questions as { id: string }[])[0]?.id;
  expect(typeof questionId, "the imported bank answered no question id").toBe("string");

  const testSlug = `camera-e2e-${Date.now().toString(36)}`;
  const accessCode = "e2e-camera-1";
  const testId = await created(request, `/api/v1/workspaces/${workspaceId}/tests`, {
    name: "Camera e2e",
    slug: testSlug,
  });
  await patched(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`, {
    settings: {
      timing: { duration_minutes: 30 },
      access: { mode: "link_code", access_code: accessCode },
      proctoring: {
        profile: "off",
        overrides: { desktop_only: false, require_camera: true, identity_photo: true },
      },
    },
    sections: [{ id: "s1", title: "Section", source: { kind: "fixed", questions: [questionId] } }],
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, {});

  return { workspaceSlug: slug, testSlug, accessCode };
}

/**
 * The minimal JPEG segment walk needed to read SOF0/SOF2's own width and
 * height — no new dependency for this (`sharp`/`image-size` are not
 * installed, and a two-byte-at-a-time scan is the whole of what reading a
 * JPEG header takes). Throws if no SOF marker is found, which fails the
 * test with a clear reason rather than returning a dimension of `{0, 0}`
 * that would compare false against `{320, 240}` just as loudly but less
 * clearly.
 */
function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  expect(bytes[0], "not a JPEG: no SOI marker").toBe(0xff);
  expect(bytes[1], "not a JPEG: no SOI marker").toBe(0xd8);
  let offset = 2;
  while (offset + 1 < bytes.length) {
    expect(bytes[offset], `expected a marker at byte ${String(offset)}`).toBe(0xff);
    const marker = bytes[offset + 1] as number;
    // Markers with no payload: SOI/EOI and the eight restart markers.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0..SOF15 except DHT (0xC4), JPG (0xC8) and DAC (0xCC) — the real
    // "start of frame" markers, every one of them shaped
    // length(2) + precision(1) + height(2) + width(2).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("no SOF marker found — this is not a readable JPEG");
}

/** Landing → access code → (no registration fields) → Start, which is
 *  where `P-05`'s gate asks the real fake camera for a real frame. */
async function openAttempt(page: Page, seeded: SeededAttempt): Promise<void> {
  await page.goto(`/${seeded.workspaceSlug}/${seeded.testSlug}`);
  await page.getByRole("button", { name: /^start/i }).click();
  await page.getByLabel("Access code").fill(seeded.accessCode);
  await page.getByRole("button", { name: /continue/i }).click();
}

test("P-06/Q11a: the identity photo is really 320×240 JPEG, under 60 KB (D-R1, real Chromium)", async ({
  page,
  request,
}) => {
  const seeded = await seedCameraTest(request);
  await openAttempt(page, seeded);

  // `page.waitForRequest`'s own `postDataBuffer()` comes back `null` for a
  // `fetch()` call whose body is a `Blob` (Playwright's CDP capture does
  // not retain it) — `page.route` intercepts the request before it leaves
  // the browser instead, which does.
  // Collected into an array rather than a `let … | null`: TypeScript
  // narrows a `let` that only the route callback ever assigns, so the use
  // site below would need a cast to read it back. An array also lets the
  // assertion be the stronger one — exactly one identity snapshot, not
  // merely "something arrived".
  const captured: Buffer[] = [];
  const contentTypes: string[] = [];
  await page.route("**/attempt/snapshot**", async (route) => {
    const body = route.request().postDataBuffer();
    if (body !== null) captured.push(body);
    const header = route.request().headers()["content-type"];
    if (header !== undefined) contentTypes.push(header);
    await route.continue();
  });

  await page.getByRole("button", { name: /register and start/i }).click();
  await page.waitForResponse(
    (res) => res.url().includes("/attempt/snapshot") && res.url().includes("reason=identity"),
  );

  // `P-05`: the gate really did acquire the fake camera and the attempt
  // really did start — the palette is the same proof every other exam
  // suite in this package uses.
  await expect(page.getByRole("navigation", { name: /question palette/i })).toBeVisible();

  expect(captured, "expected exactly one identity snapshot upload").toHaveLength(1);
  expect(contentTypes).toEqual(["image/jpeg"]);
  const bytes = captured[0]!;

  console.log(`CAMERA identity photo: ${String(bytes.length)} bytes (${(bytes.length / 1024).toFixed(2)} KB)`);

  expect(bytes.length).toBeLessThan(60_000);
  expect(jpegDimensions(bytes)).toEqual({ width: 320, height: 240 });
});
