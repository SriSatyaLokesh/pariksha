// BYOK AI Question Drafting Engine (Phase 12).
// Validates batches atomically against JSON schema and import rules before storage.
// Enforces tenant isolation, field-level key decryption, and spend limits.

import type { Question, QuestionType } from "@pariksha/core";
import { validateBank } from "@pariksha/core";
import type { DbClient } from "@pariksha/db";
import {
  getByokCredential,
  listByokCredentials,
  recordByokUsage,
  getByokUsageSummary,
  upsertQuestions,
  type ByokProvider,
} from "@pariksha/db";
import { decryptApiKey } from "./crypto.js";
import { invokeAiDrafting, type AiDraftResponse } from "./client.js";

export interface DraftOptions {
  prompt: string;
  count?: number | undefined;
  types?: QuestionType[] | undefined;
  provider?: ByokProvider | undefined;
  model?: string | undefined;
}

export interface DraftOutput {
  questions: Question[];
  usage: AiDraftResponse["usage"];
}

export async function draftQuestions(
  db: DbClient,
  workspaceId: string,
  bankId: string,
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

  // Hard spend cap check (Gate 4)
  if (credential.spendLimitCents != null) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
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

  // Invoke AI provider
  const count = options.count ?? 3;
  const aiResult = await invokeAiDrafting({
    provider,
    apiKey: plainApiKey,
    prompt: options.prompt,
    count,
    types: options.types,
    model: options.model,
  });

  if (!aiResult.questions || aiResult.questions.length === 0) {
    throw new Error("AI provider returned zero questions.");
  }

  // Normalize IDs and check all-or-nothing validation (Gate 1)
  const questionsToValidate: Question[] = aiResult.questions.map((q, idx) => ({
    ...q,
    id: q.id || `DRAFT-Q${idx + 1}`,
  }));

  const validation = validateBank({
    format: "pariksha/bank@1",
    name: "AI Draft",
    questions: questionsToValidate,
  });

  if (!validation.ok) {
    const details = (validation.issues ?? []).map((i) => `[${i.field}] ${i.message}`).join("; ");
    throw new Error(`AI generated batch validation failed: ${details}`);
  }

  const nowMs = Date.now();

  // Atomically write validated draft questions to bank
  await upsertQuestions(db, workspaceId, bankId, questionsToValidate, nowMs);

  // Record token telemetry and cost
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
    usage: aiResult.usage,
  };
}
