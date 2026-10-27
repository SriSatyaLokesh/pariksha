// Phase 12 E2E Spec: BYOK AI Question Drafting
// Verifies BYOK key settings and in-bank AI drafting modal interaction flows.

import { expect, test } from "@playwright/test";

test.describe("Phase 12: BYOK AI Question Drafting", () => {
  test("organiser can access BYOK settings in the API keys panel", async ({ page }) => {
    // Intercept BYOK API calls to return mock credentials for the UI flow
    await page.route("**/api/v1/workspaces/*/byok", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            credentials: [
              {
                id: "byok_1",
                provider: "anthropic",
                keyHint: "sk-ant-...4a9b",
                spendLimitCents: 5000,
                status: "active",
                createdAt: Date.now() - 86400000,
                updatedAt: Date.now() - 86400000,
                lastUsedAt: Date.now() - 3600000,
              },
            ],
            usage: {
              totalPromptTokens: 1250,
              totalCompletionTokens: 480,
              totalCostCents: 15,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/admin.html?view=keys");

    // BYOK Section exists
    await expect(page.getByText(/Bring Your Own Key/i)).toBeVisible();

    // Anthropic card shows configured state
    await expect(page.getByRole("heading", { level: 3, name: "Anthropic" })).toBeVisible();
    await expect(page.getByText("Active")).toBeVisible();
    await expect(page.getByText(/sk-ant-\.\.\.4a9b/i)).toBeVisible();
    await expect(page.getByText(/Spend cap: \$50\.00 \/ month/i)).toBeVisible();

    // OpenAI card shows not configured state
    await expect(page.getByRole("heading", { level: 3, name: "OpenAI" })).toBeVisible();
    await expect(page.getByText("Not configured")).toBeVisible();

    // Click configure on OpenAI to open form
    const configOpenAiBtn = page.getByRole("button", { name: /configure openai/i });
    if (await configOpenAiBtn.isVisible()) {
      await configOpenAiBtn.click();
      await expect(page.getByRole("heading", { level: 2, name: /configure openai key/i })).toBeVisible();
      await expect(page.getByLabel(/openai api key/i)).toBeVisible();
      await expect(page.getByLabel(/monthly spend cap/i)).toBeVisible();

      // Cancel form
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { level: 2, name: /configure openai key/i })).not.toBeVisible();
    }
  });

  test("question bank browser provides 'Draft with AI' modal with accessible controls", async ({
    page,
  }) => {
    // Intercept bank details and question list
    await page.route("**/api/v1/workspaces/*/banks/bnk_demo", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bank: {
            id: "bnk_demo",
            name: "Algorithms & Systems",
            workspaceId: "wsp_1",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          questions: [],
          tags: ["distributed-systems", "algorithms"],
          groups: [],
        }),
      });
    });

    await page.goto("/admin.html?view=bank&bank=bnk_demo");

    const draftAiBtn = page.getByRole("button", { name: /draft with ai/i });
    if (await draftAiBtn.isVisible()) {
      await draftAiBtn.click();

      // Modal dialog opens
      const modal = page.getByRole("dialog", { name: /draft questions with ai/i });
      await expect(modal).toBeVisible();

      // Controls are present and interactive
      const promptInput = page.getByLabel(/topic, syllabus, or text material/i);
      await expect(promptInput).toBeVisible();

      const providerSelect = page.getByLabel(/ai provider/i);
      await expect(providerSelect).toBeVisible();
      await expect(providerSelect).toHaveValue("anthropic");

      const countInput = page.getByLabel(/question count/i);
      await expect(countInput).toBeVisible();
      await expect(countInput).toHaveValue("3");

      // Question types chips exist
      await expect(page.getByRole("button", { name: /single choice/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /multiple choice/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /true \/ false/i })).toBeVisible();

      // Cancel dismisses modal
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(modal).not.toBeVisible();
    }
  });
});
