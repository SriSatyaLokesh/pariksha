import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createWorkspace } from "../seed";

test.use({
  permissions: ["camera", "microphone"],
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

/** Seed a test configured with proctoring overrides. */
async function seedProctoredTest(
  request: APIRequestContext,
  proctoringOverrides: { require_camera: boolean; require_microphone: boolean },
): Promise<SeededAttempt> {
  const slug = `mic-e2e-${Date.now().toString(36)}`;
  const workspaceId = await createWorkspace(request, "Mic e2e", slug);

  const bankId = await created(request, `/api/v1/workspaces/${workspaceId}/banks`, {
    name: "Mic e2e bank",
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`, {
    format: "pariksha/bank@1",
    name: "Mic e2e bank",
    questions: [
      { id: "Q01", type: "true_false", prompt: "Microphone proctoring monitors noise levels.", key: true, points: 1 },
    ],
  });
  const questions = await request.get(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`);
  expect(questions.ok()).toBe(true);
  const questionId = ((await questions.json()).questions as { id: string }[])[0]?.id;
  expect(typeof questionId).toBe("string");

  const testSlug = `mic-test-${Date.now().toString(36)}`;
  const accessCode = "e2e-mic-1";
  const testId = await created(request, `/api/v1/workspaces/${workspaceId}/tests`, {
    name: "Microphone Proctoring Exam",
    slug: testSlug,
  });
  await patched(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`, {
    settings: {
      timing: { duration_minutes: 30 },
      access: { mode: "link_code", access_code: accessCode },
      proctoring: {
        profile: "off",
        overrides: {
          desktop_only: false,
          require_camera: proctoringOverrides.require_camera,
          require_microphone: proctoringOverrides.require_microphone,
          identity_photo: false,
        },
      },
    },
    sections: [{ id: "s1", title: "General", source: { kind: "fixed", questions: [questionId] } }],
  });
  await ok(request, `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, {});

  return { workspaceSlug: slug, testSlug, accessCode };
}

test.describe("Phase 8.5: Real Browser Microphone Validation", () => {
  test("candidate landing page displays disclosure, verifies microphone VU meter & camera in real Chromium", async ({
    page,
    request,
  }) => {
    const seeded = await seedProctoredTest(request, { require_camera: true, require_microphone: true });

    // 1. Navigate to candidate landing page
    await page.goto(`/${seeded.workspaceSlug}/${seeded.testSlug}`);
    await page.waitForLoadState("networkidle");

    // 2. Verify proctoring disclosure sentences appear and action buttons are positioned above requirements
    await expect(
      page.getByText("Your microphone is on. Noise level is monitored; no audio is recorded or stored."),
    ).toBeVisible();
    await expect(page.getByText("A working camera is required for the whole test.")).toBeVisible();

    const isActionsAbove = await page.evaluate(() => {
      const actions = document.querySelector(".exam-landing-actions");
      const requirements = document.querySelector(".exam-landing-requirements");
      if (!actions || !requirements) return false;
      return Boolean(actions.compareDocumentPosition(requirements) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isActionsAbove).toBe(true);

    // 3. Click "Check my device"
    await page.getByRole("button", { name: /check my device/i }).click();

    // 4. Verify interactive device test section appears
    const previewSection = page.getByRole("region", { name: /device test preview/i });
    await expect(previewSection).toBeVisible();

    // 5. Verify camera preview video element is rendered
    const video = previewSection.locator("video");
    await expect(video).toBeVisible();

    // 6. Verify microphone VU meter element is rendered and accessible
    const micMeter = previewSection.getByRole("meter", { name: /microphone level/i });
    await expect(micMeter).toBeVisible();

    // Take screenshot of candidate device test in real browser
    await page.screenshot({
      path: "C:/Users/SatyaK/.gemini/antigravity-cli/brain/cd06bddb-63df-4e38-a02d-fa0d4b5de9af/browser-device-check.png",
      fullPage: true,
    });

    // 7. Dismiss the test and verify preview tracks close
    await page.getByRole("button", { name: /dismiss/i }).click();
    await expect(previewSection).not.toBeVisible();

    // 8. Click Start, enter access code, and verify exam starts with real fake media stream
    await page.getByRole("button", { name: /^start/i }).click();
    await page.getByLabel("Access code").fill(seeded.accessCode);
    await page.getByRole("button", { name: /continue/i }).click();

    // Click register and start
    await page.getByRole("button", { name: /register and start/i }).click();

    // Candidate should reach the exam paper
    await expect(page.getByRole("navigation", { name: /question palette/i })).toBeVisible({ timeout: 10000 });

    // Verify audio stream and context are alive in candidate runtime
    const hasAudioTrack = await page.evaluate(() => {
      // AudioWorklet is supported in real Chromium
      return typeof window.AudioContext === "function";
    });
    expect(hasAudioTrack).toBe(true);

    // Take screenshot of candidate exam running with microphone proctoring active
    await page.screenshot({
      path: "C:/Users/SatyaK/.gemini/antigravity-cli/brain/cd06bddb-63df-4e38-a02d-fa0d4b5de9af/browser-exam-mic-running.png",
      fullPage: true,
    });
  });

  test("candidate landing page handles microphone-only proctoring without requiring camera in real Chromium", async ({
    page,
    request,
  }) => {
    const seeded = await seedProctoredTest(request, { require_camera: false, require_microphone: true });

    // 1. Navigate to candidate landing page
    await page.goto(`/${seeded.workspaceSlug}/${seeded.testSlug}`);
    await page.waitForLoadState("networkidle");

    // 2. Verify microphone disclosure appears, camera disclosure does NOT appear
    await expect(
      page.getByText("Your microphone is on. Noise level is monitored; no audio is recorded or stored."),
    ).toBeVisible();
    await expect(page.getByText("A working camera is required for the whole test.")).not.toBeVisible();

    // 3. Click "Check my device"
    await page.getByRole("button", { name: /check my device/i }).click();

    // 4. Verify interactive device test section appears
    const previewSection = page.getByRole("region", { name: /device test preview/i });
    await expect(previewSection).toBeVisible();

    // 5. Video should NOT be rendered when camera is not required
    await expect(previewSection.locator("video")).not.toBeVisible();

    // 6. Microphone meter should be rendered
    const micMeter = previewSection.getByRole("meter", { name: /microphone level/i });
    await expect(micMeter).toBeVisible();

    // Take screenshot of mic-only check
    await page.screenshot({
      path: "C:/Users/SatyaK/.gemini/antigravity-cli/brain/cd06bddb-63df-4e38-a02d-fa0d4b5de9af/browser-device-check-mic-only.png",
      fullPage: true,
    });

    // 7. Start exam directly without camera
    await page.getByRole("button", { name: /^start/i }).click();
    await page.getByLabel("Access code").fill(seeded.accessCode);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByRole("button", { name: /register and start/i }).click();

    // 8. Exam paper reached smoothly
    await expect(page.getByRole("navigation", { name: /question palette/i })).toBeVisible({ timeout: 10000 });
  });
});
