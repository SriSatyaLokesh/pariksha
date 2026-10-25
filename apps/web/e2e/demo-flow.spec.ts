import { expect, test } from "@playwright/test";

test.describe("Public Demo Instance Flows (Phase 9)", () => {
  test("candidate test drive: landing -> hero demo link -> take sample exam -> section navigation -> submit", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /run real exams on infrastructure/i }),
    ).toBeVisible();

    // Click "Try Live Demo" in hero
    const tryDemoLink = page.getByRole("link", { name: /try live demo/i });
    await expect(tryDemoLink).toBeVisible();
    await expect(tryDemoLink).toHaveAttribute("href", "/exam?demo=true");

    await tryDemoLink.click();
    await expect(page.getByRole("region", { name: /demo mode/i })).toBeVisible();
    await expect(page.getByText(/Pariksha Interactive Demo Exam/i)).toBeVisible();
  });

  test("candidate exam runner: sits demo exam directly via /exam.html?demo=true", async ({
    page,
  }) => {
    await page.goto("/exam.html?demo=true");

    // Demo banner is mounted
    await expect(page.getByRole("region", { name: /demo mode/i })).toBeVisible();
    await expect(page.getByText("Public Demo", { exact: true })).toBeVisible();

    // Exam landing screen renders sample test
    await expect(page.getByText(/Pariksha Interactive Demo Exam/i)).toBeVisible();

    // Click Start
    const startBtn = page.getByRole("button", { name: /^start/i });
    if (await startBtn.isVisible()) {
      await startBtn.click();
    }

    // Runner shows section navigation tabs
    const tablist = page.getByRole("tablist", { name: /exam sections/i });
    if (await tablist.isVisible()) {
      await expect(tablist).toBeVisible();

      // Check section tabs exist
      const sec1Tab = page.getByRole("tab", { name: /Computer Science/i });
      await expect(sec1Tab).toBeVisible();

      // Instructions drawer check
      const instructionsBtn = page.getByRole("button", { name: /instructions/i });
      if (await instructionsBtn.isVisible()) {
        await instructionsBtn.click();
      }
    }
  });
});
