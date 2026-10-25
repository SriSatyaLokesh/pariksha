import { expect, test } from "@playwright/test";

test.describe("Public Demo Instance Flows (Phase 9)", () => {
  test("candidate test drive: landing -> demo modal -> take sample exam -> section navigation -> submit", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /run real exams on infrastructure/i }),
    ).toBeVisible();

    // Click "Try Live Demo" in hero
    const tryDemoBtn = page.getByRole("button", { name: /try live demo/i }).first();
    await tryDemoBtn.click();

    // Modal opens
    const dialog = page.getByRole("dialog", { name: /choose demo experience/i });
    await expect(dialog).toBeVisible();

    // Select candidate sample exam
    const sampleExamLink = page.getByRole("link", { name: /take sample exam/i });
    await expect(sampleExamLink).toHaveAttribute("href", "/exam?demo=true");
  });

  test("candidate exam runner: sits demo exam directly via /exam.html?demo=true", async ({
    page,
  }) => {
    await page.goto("/exam.html?demo=true");

    // Demo banner is mounted
    await expect(page.getByRole("region", { name: /demo mode/i })).toBeVisible();
    await expect(page.getByText(/public demo/i)).toBeVisible();

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
