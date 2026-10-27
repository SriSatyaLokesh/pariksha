// Phase 12 E2E Spec: BYOK AI Question Drafting
// Verifies OpenRouter key configuration, spend caps, and two-step in-bank AI drafting preview, review & commit flows.

import { expect, test, type Page } from "@playwright/test";
import { seedWorkspace } from "./seed";

async function ensureSignedIn(page: Page): Promise<void> {
  await page.goto("/admin.html");
  const continueLink = page.getByRole("link", { name: /continue with/i });
  if (await continueLink.isVisible()) {
    await continueLink.click();
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("Phase 12: BYOK AI Question Drafting", () => {
  test.beforeAll(async ({ request }) => {
    await seedWorkspace(request, { banks: 1, questionsPerBank: 1, tests: 0 });
  });

  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test("organiser can configure OpenRouter key and spend cap in API keys panel", async ({
    page,
  }) => {
    let openRouterConfigured = false;

    // Intercept BYOK API calls to return mock credentials for the UI flow
    await page.route("**/api/v1/workspaces/*/byok**", async (route) => {
      const method = route.request().method();
      const url = route.request().url();

      if (method === "GET" && !url.includes("/byok/")) {
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
              ...(openRouterConfigured
                ? [
                    {
                      id: "byok_3",
                      provider: "openrouter",
                      keyHint: "sk-or-...6789",
                      spendLimitCents: 2500,
                      status: "active",
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                      lastUsedAt: null,
                    },
                  ]
                : []),
            ],
            usage: {
              totalPromptTokens: 1250,
              totalCompletionTokens: 480,
              totalCostCents: 15,
            },
          }),
        });
      } else if (method === "PUT" && url.includes("/byok/openrouter")) {
        openRouterConfigured = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            credential: {
              id: "byok_3",
              provider: "openrouter",
              keyHint: "sk-or-...6789",
              spendLimitCents: 2500,
              status: "active",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastUsedAt: null,
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
    await expect(page.getByText(/Monthly Cap: \$50\.00 \/ month/i)).toBeVisible();

    // OpenAI card shows not configured state
    const openAiHeading = page.getByRole("heading", { level: 3, name: "OpenAI" });
    await expect(openAiHeading).toBeVisible();
    const openAiCard = page.locator(".byok-card").filter({ has: openAiHeading });
    await expect(openAiCard.getByText("Not configured")).toBeVisible();

    // OpenRouter card shows not configured state
    const openRouterHeading = page.getByRole("heading", { level: 3, name: "OpenRouter" });
    await expect(openRouterHeading).toBeVisible();

    const openRouterCard = page.locator(".byok-card").filter({ has: openRouterHeading });
    await expect(openRouterCard.getByText("Not configured")).toBeVisible();

    // Click "Configure Key" inside OpenRouter card
    await openRouterCard.getByRole("button", { name: /configure key/i }).click();

    // Form opens
    await expect(
      page.getByRole("heading", { level: 3, name: /configure openrouter key/i }),
    ).toBeVisible();
    const keyInput = page.getByLabel(/openrouter api key/i);
    await expect(keyInput).toBeVisible();
    await keyInput.fill("sk-or-v1-abcdef0123456789");

    const spendCapInput = page.getByLabel(/monthly spend cap/i);
    await expect(spendCapInput).toBeVisible();
    await spendCapInput.fill("25.00");

    // Save key
    await page.getByRole("button", { name: /save key/i }).click();

    // Success notification
    await expect(
      page.getByText(/successfully configured openrouter api key/i),
    ).toBeVisible();
  });

  test("two-step AI drafting flow: modal setup -> generate draft questions -> review & flag -> atomic commit to bank", async ({
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
            name: "Distributed Systems Bank",
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

    // Intercept POST **/draft-ai (Step 1: preview generator)
    let interceptedDraftPayload: unknown = null;
    await page.route("**/api/v1/workspaces/*/banks/bnk_demo/draft-ai", async (route) => {
      if (route.request().method() === "POST") {
        interceptedDraftPayload = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            questions: [
              {
                id: "draft_1",
                type: "single",
                prompt: "What consensus protocol uses leader election and log replication?",
                options: [
                  { id: "opt_a", text: "Raft" },
                  { id: "opt_b", text: "Two-phase commit" },
                  { id: "opt_c", text: "Gossip protocol" },
                ],
                key: "opt_a",
                difficulty: "medium",
              },
              {
                id: "draft_2",
                type: "true_false",
                prompt:
                  "Paxos guarantees termination in an asynchronous network with crash failures.",
                key: false,
                difficulty: "hard",
              },
            ],
            validationIssues: [],
            usage: {
              promptTokens: 420,
              completionTokens: 180,
              estimatedCostCents: 8,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Intercept POST **/draft-ai/commit (Step 2: atomic bank commit)
    let interceptedCommitPayload: unknown = null;
    await page.route(
      "**/api/v1/workspaces/*/banks/bnk_demo/draft-ai/commit",
      async (route) => {
        if (route.request().method() === "POST") {
          interceptedCommitPayload = route.request().postDataJSON();
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              importedCount: interceptedCommitPayload?.questions?.length ?? 1,
              bankId: "bnk_demo",
            }),
          });
        } else {
          await route.continue();
        }
      },
    );

    await page.goto("/admin.html?view=bank&bank=bnk_demo");

    // Open "Draft with AI" modal
    const draftAiBtn = page.getByRole("button", { name: /draft with ai/i });
    await expect(draftAiBtn).toBeVisible();
    await draftAiBtn.click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /draft questions with ai/i }),
    ).toBeVisible();

    // Enter prompt topic
    const promptInput = page.getByLabel(/topic, syllabus, or text material/i);
    await promptInput.fill("Consensus algorithms: Raft and Paxos edge cases");

    // Select OpenRouter provider
    const providerSelect = page.getByLabel(/ai provider/i);
    await providerSelect.selectOption("openrouter");

    // Select curated model
    const modelSelect = page.getByLabel(/ai model/i);
    await expect(modelSelect).toBeVisible();
    await modelSelect.selectOption("deepseek/deepseek-chat");

    // Click "Generate Draft Questions"
    const generateBtn = page.getByRole("button", { name: /generate draft questions/i });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // Verify modal transitions to the review step (.draft-ai-review)
    expect(interceptedDraftPayload).not.toBeNull();
    await expect(page.locator(".draft-ai-review")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /review drafted questions/i }),
    ).toBeVisible();

    // Verify header telemetry displays approved count (2 Approved) and estimated cost ($0.08)
    await expect(page.locator(".draft-ai-stat--approved")).toContainText("2 Approved");
    await expect(page.getByText("$0.08")).toBeVisible();

    // Verify question cards render with schema validation badges (✓ Schema Valid)
    const cards = page.locator(".draft-ai-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByText(/✓ Schema Valid/i)).toBeVisible();
    await expect(cards.nth(1).getByText(/✓ Schema Valid/i)).toBeVisible();

    // Question 1 & 2 prompt texts are visible
    await expect(cards.nth(0)).toContainText("What consensus protocol uses leader election");
    await expect(cards.nth(1)).toContainText(
      "Paxos guarantees termination in an asynchronous network",
    );

    // Click "Flag as Incorrect" on Question 2
    const flagBtnQ2 = cards.nth(1).getByRole("button", { name: /flag as incorrect/i });
    await expect(flagBtnQ2).toBeVisible();
    await flagBtnQ2.click();

    // Question 2 card receives .draft-ai-card--flagged class
    await expect(cards.nth(1)).toHaveClass(/draft-ai-card--flagged/);

    // Approved counter decrements to "1 Approved"
    await expect(page.locator(".draft-ai-stat--approved")).toContainText("1 Approved");
    await expect(page.locator(".draft-ai-stat--flagged")).toContainText("1 Flagged");

    // Bottom bar indicates "1 flagged item will be excluded"
    await expect(page.locator(".draft-ai-bottom-bar__summary")).toContainText(
      "1 flagged item will be excluded",
    );

    // Bottom action button reads "Import 1 Approved Question to Bank →"
    const importBtn = page.getByRole("button", {
      name: /import 1 approved question to bank/i,
    });
    await expect(importBtn).toBeVisible();

    // Click "Import 1 Approved Question to Bank →"
    await importBtn.click();

    // Assert the intercepted commit payload sends only the approved Question 1 (Question 2 excluded)
    expect(interceptedCommitPayload).not.toBeNull();
    const commitBody = interceptedCommitPayload as {
      questions?: Array<{ id?: string; prompt: string }>;
    };
    expect(commitBody.questions).toHaveLength(1);
    expect(commitBody.questions?.[0]?.prompt).toContain(
      "What consensus protocol uses leader election",
    );

    // Verify modal closes on success
    await expect(modal).not.toBeVisible();
  });
});
