// BYOK API Routes (Phase 12, S-15).
// Endpoints for workspace-level Anthropic and OpenAI key management and AI question drafting.

import { Hono } from "hono";
import { z } from "zod";
import {
  appendAudit,
  listByokCredentials,
  setByokCredential,
  deleteByokCredential,
  getByokUsageSummary,
  getBank,
  urlRefusal,
  type ByokProvider,
} from "@pariksha/db";
import { QUESTION_TYPES, type Question } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";
import { encryptApiKey, formatKeyHint } from "../byok/crypto.js";
import { draftQuestions, commitDraftQuestions } from "../byok/draft.js";
import {
  getAllSupportedModels,
  fetchLiveOpenRouterModels,
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  GEMINI_MODELS,
  OPENCODE_MODELS,
} from "../byok/models.js";

const putKeySchema = z.object({
  apiKey: z.string().min(1).max(500),
  spendLimitCents: z.number().int().nonnegative().nullable().optional(),
});

const draftAiSchema = z.object({
  prompt: z.string().min(1).max(10000),
  count: z.number().int().min(1).max(10).default(3),
  types: z.array(z.enum(QUESTION_TYPES)).optional(),
  provider: z.enum(["anthropic", "openai", "openrouter", "gemini", "opencode"]).optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
});

const commitDraftSchema = z.object({
  questions: z.array(z.record(z.string(), z.unknown())),
});

function validProviderOr400(param: string): ByokProvider {
  if (
    param !== "anthropic" &&
    param !== "openai" &&
    param !== "openrouter" &&
    param !== "gemini" &&
    param !== "opencode"
  ) {
    throw new ApiError(
      400,
      "invalid_provider",
      `Unsupported provider "${param}". Must be "anthropic", "openai", "openrouter", "gemini", or "opencode".`,
    );
  }
  return param;
}

export function byokRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  // GET /api/v1/workspaces/:id/byok
  routes.get("/:id/byok", requires("keys.manage"), async (c) => {
    const workspaceId = c.req.param("id");
    const credentials = await listByokCredentials(deps.db, workspaceId);
    const usage = await getByokUsageSummary(deps.db, workspaceId);
    return c.json({ credentials, usage });
  });

  // GET /api/v1/workspaces/:id/byok/models
  routes.get("/:id/byok/models", requires("banks.edit"), async (c) => {
    const live = c.req.query("live") === "true";
    if (live) {
      const liveOpenRouter = await fetchLiveOpenRouterModels();
      if (liveOpenRouter.length > 0) {
        return c.json({
          models: [...ANTHROPIC_MODELS, ...OPENAI_MODELS, ...GEMINI_MODELS, ...OPENCODE_MODELS, ...liveOpenRouter],
        });
      }
    }
    return c.json({ models: getAllSupportedModels() });
  });

  // PUT /api/v1/workspaces/:id/byok/:provider
  routes.put("/:id/byok/:provider", requires("keys.manage"), async (c) => {
    const workspaceId = c.req.param("id");
    const provider = validProviderOr400(c.req.param("provider"));

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiError(400, "invalid_json", "Malformed JSON body.");
    }

    const parsed = putKeySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "validation_error", parsed.error.issues.map((i) => i.message).join(", "));
    }

    const secretKey = deps.env.sessionSecret;
    const encrypted = await encryptApiKey(parsed.data.apiKey, secretKey);
    const hint = formatKeyHint(parsed.data.apiKey);

    const credential = await setByokCredential(
      deps.db,
      workspaceId,
      provider,
      encrypted,
      hint,
      parsed.data.spendLimitCents ?? null,
    );

    const actor = c.get("actor");
    await appendAudit(deps.db, workspaceId, {
      action: "byok.updated",
      actor: actor?.userId ?? "system",
      target: credential.id,
      detail: { provider, keyHint: hint, spendLimitCents: credential.spendLimitCents },
      now: deps.now(),
    });

    return c.json({ credential });
  });

  // DELETE /api/v1/workspaces/:id/byok/:provider
  routes.delete("/:id/byok/:provider", requires("keys.manage"), async (c) => {
    const workspaceId = c.req.param("id");
    const provider = validProviderOr400(c.req.param("provider"));

    await deleteByokCredential(deps.db, workspaceId, provider);

    const actor = c.get("actor");
    await appendAudit(deps.db, workspaceId, {
      action: "byok.deleted",
      actor: actor?.userId ?? "system",
      target: provider,
      detail: { provider },
      now: deps.now(),
    });

    return c.body(null, 204);
  });

  // POST /api/v1/workspaces/:id/banks/:bankId/draft-ai
  // Computational preview generator - returns questions, validation issues, and usage without DB write.
  routes.post("/:id/banks/:bankId/draft-ai", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");

    const bank = await getBank(deps.db, workspaceId, bankId);
    if (!bank) {
      throw new ApiError(404, "not_found", "Question bank not found.");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiError(400, "invalid_json", "Malformed JSON body.");
    }

    const parsed = draftAiSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "validation_error", parsed.error.issues.map((i) => i.message).join(", "));
    }

    if (parsed.data.baseUrl) {
      const refused = urlRefusal(parsed.data.baseUrl);
      if (refused !== null) {
        throw new ApiError(422, "url_refused", `${refused}.`);
      }
    }

    const secretKey = deps.env.sessionSecret;

    try {
      const result = await draftQuestions(deps.db, workspaceId, bankId, secretKey, {
        prompt: parsed.data.prompt,
        count: parsed.data.count,
        types: parsed.data.types,
        provider: parsed.data.provider,
        model: parsed.data.model,
        baseUrl: parsed.data.baseUrl,
      });

      const actor = c.get("actor");
      await appendAudit(deps.db, workspaceId, {
        action: "bank.ai_drafted",
        actor: actor?.userId ?? "system",
        target: bankId,
        detail: {
          count: result.questions.length,
          provider: parsed.data.provider,
          tokens: result.usage.promptTokens + result.usage.completionTokens,
        },
        now: deps.now(),
      });

      return c.json({
        questions: result.questions,
        validationIssues: result.validationIssues,
        usage: result.usage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("spend limit") && msg.includes("exceeded")) {
        throw new ApiError(402, "spend_limit_exceeded", msg);
      }
      if (msg.includes("No active") || msg.includes("No BYOK API key")) {
        throw new ApiError(400, "missing_byok_key", msg);
      }
      if (msg.includes("validation failed")) {
        throw new ApiError(422, "schema_validation_failed", msg);
      }
      throw new ApiError(500, "ai_draft_failed", msg);
    }
  });

  // POST /api/v1/workspaces/:id/banks/:bankId/draft-ai/commit
  // Atomic commit endpoint - persists vetted/edited questions to the bank with unique q_... IDs.
  routes.post("/:id/banks/:bankId/draft-ai/commit", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");

    const bank = await getBank(deps.db, workspaceId, bankId);
    if (!bank) {
      throw new ApiError(404, "not_found", "Question bank not found.");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiError(400, "invalid_json", "Malformed JSON body.");
    }

    const parsed = commitDraftSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "validation_error", parsed.error.issues.map((i) => i.message).join(", "));
    }

    try {
      const result = await commitDraftQuestions(
        deps.db,
        workspaceId,
        bankId,
        parsed.data.questions as unknown as Question[],
      );

      const actor = c.get("actor");
      await appendAudit(deps.db, workspaceId, {
        action: "bank.ai_committed",
        actor: actor?.userId ?? "system",
        target: bankId,
        detail: {
          importedCount: result.importedCount,
        },
        now: deps.now(),
      });

      return c.json(result, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("validation failed")) {
        throw new ApiError(422, "schema_validation_failed", msg);
      }
      throw new ApiError(500, "commit_failed", msg);
    }
  });

  return routes;
}
