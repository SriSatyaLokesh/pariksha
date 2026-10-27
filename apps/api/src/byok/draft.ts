// BYOK AI Question Drafting Engine (Phase 12).
// Implements two-step flow (Option A): strictly computational preview pipeline and atomic commit.
// Enforces tenant isolation, field-level key decryption, UTC calendar month spend limits, and schema validation.

import type { Question, QuestionType } from "@pariksha/core";
import { validateBank } from "@pariksha/core";
import type { DbClient } from "@pariksha/db";
import {
  getByokCredential,
  listByokCredentials,
  recordByokUsage,
  getByokUsageSummary,
  upsertQuestions,
  listQuestionRefIds,
  type ByokProvider,
} from "@pariksha/db";
import { decryptApiKey } from "./crypto.js";
import { routeDraftRequest } from "./router.js";

export interface DraftOptions {
  prompt: string;
  count?: number | undefined;
  types?: QuestionType[] | undefined;
  provider?: ByokProvider | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

export interface DraftOutput {
  questions: Question[];
  validationIssues: Array<{ field?: string; message: string }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    estimatedCostCents: number;
  };
}

/**
 * Step 1: Computational preview generator (Option A).
 * Invokes AI provider, runs schema validation, records token usage to byok_usage,
 * and returns { questions, validationIssues, usage } WITHOUT writing to the database.
 */
export async function draftQuestions(
  db: DbClient,
  workspaceId: string,
  _bankId: string,
  fieldSecret: string,
  options: DraftOptions,
): Promise<DraftOutput> {
  let provider = options.provider;

  if (!provider) {
    const creds = await listByokCredentials(db, workspaceId);
    const active = creds.find((c) => c.status === "active");
    if (!active) {
      throw new Error("No active BYOK API key configured for this workspace. Configure Anthropic or OpenAI in Settings.");
    }
    provider = active.provider;
  }

  const credential = await getByokCredential(db, workspaceId, provider);
  if (!credential || credential.status !== "active") {
    throw new Error(`No active ${provider} BYOK API key configured for this workspace.`);
  }

  // Hard spend cap check over current UTC calendar month (Gate 4)
  if (credential.spendLimitCents != null) {
    const now = new Date();
    const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const currentUsage = await getByokUsageSummary(db, workspaceId, startOfMonth);

    if (currentUsage.totalCostCents >= credential.spendLimitCents) {
      throw new Error(
        `Monthly spend limit of $${(credential.spendLimitCents / 100).toFixed(2)} exceeded ($${(
          currentUsage.totalCostCents / 100
        ).toFixed(2)} used).`,
      );
    }
  }

  // Decrypt key with field secret (Gate 2 & 3)
  const plainApiKey = await decryptApiKey(credential.encryptedKey, fieldSecret);

  // Invoke AI provider via ProviderRouter
  const count = options.count ?? 3;
  const aiResult = await routeDraftRequest(provider, {
    apiKey: plainApiKey,
    prompt: options.prompt,
    count,
    types: options.types,
    model: options.model ?? "",
    baseUrl: options.baseUrl,
  });

  if (!aiResult.questions || aiResult.questions.length === 0) {
    throw new Error("AI provider returned zero questions.");
  }

  // Normalize temporary IDs for preview schema validation
  const questionsToValidate: Question[] = aiResult.questions.map((q, idx) => ({
    ...q,
    id: q.id || `DRAFT-Q${idx + 1}`,
  }));

  const validation = validateBank({
    format: "pariksha/bank@1",
    name: "AI Draft Preview",
    questions: questionsToValidate,
  });

  const validationIssues: Array<{ field?: string; message: string }> = validation.ok
    ? []
    : (validation.issues ?? []).map((i) => ({
        field: i.field,
        message: i.message,
      }));

  // Record token telemetry and cost even for preview (tokens were consumed)
  await recordByokUsage(
    db,
    workspaceId,
    provider,
    aiResult.model,
    aiResult.usage.promptTokens,
    aiResult.usage.completionTokens,
    aiResult.usage.estimatedCostCents,
  );

  return {
    questions: questionsToValidate,
    validationIssues,
    usage: aiResult.usage,
  };
}

function generateUniqueQuestionId(existing: Set<string>): string {
  let id: string;
  do {
    id = "q_" + Math.random().toString(36).slice(2, 10);
  } while (existing.has(id));
  existing.add(id);
  return id;
}

/**
 * Step 2: Atomic commit route handler.
 * Validates bank schema and commits approved/edited questions with unique q_... IDs.
 */
export async function commitDraftQuestions(
  db: DbClient,
  workspaceId: string,
  bankId: string,
  questions: Question[],
): Promise<{ importedCount: number; bankId: string }> {
  if (questions.length === 0) {
    return { importedCount: 0, bankId };
  }

  const existingRefIds = new Set(await listQuestionRefIds(db, workspaceId, bankId));
  const seenIds = new Set<string>(existingRefIds);

  const preparedQuestions: Question[] = questions.map((q) => {
    let id = q.id;
    if (!id || id.startsWith("DRAFT-") || seenIds.has(id) || !id.startsWith("q_")) {
      id = generateUniqueQuestionId(seenIds);
    } else {
      seenIds.add(id);
    }
    return {
      ...q,
      id,
    };
  });

  const validation = validateBank({
    format: "pariksha/bank@1",
    name: "AI Draft Commit",
    questions: preparedQuestions,
  });

  if (!validation.ok) {
    const details = (validation.issues ?? []).map((i) => `[${i.field}] ${i.message}`).join("; ");
    throw new Error(`AI generated batch validation failed: ${details}`);
  }

  const nowMs = Date.now();
  await upsertQuestions(db, workspaceId, bankId, preparedQuestions, nowMs);

  return {
    importedCount: preparedQuestions.length,
    bankId,
  };
}
