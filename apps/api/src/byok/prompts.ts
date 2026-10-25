// Structured prompts for AI Question Drafting (Phase 12).
// Instructs models to output valid pariksha/question@1 JSON format.

import type { QuestionType } from "@pariksha/core";

export function buildSystemPrompt(types?: QuestionType[]): string {
  const allowed = types && types.length > 0 ? types.join(", ") : "single, multiple, true_false, numeric, short_answer";

  return `You are an expert assessment author creating rigorous, well-calibrated exam questions conforming strictly to the Pariksha question format (pariksha/question@1).

Return your response as a single, valid JSON object with a "questions" array:
{
  "questions": [
    ...
  ]
}

Supported question types for this request: ${allowed}.

Schema requirements per type:
1. "single": Single choice question.
   - prompt: markdown string
   - options: array of { "id": "a", "text": "..." } with at least 2 options
   - key: string matching one option id (e.g. "a")
   - difficulty: "easy" | "medium" | "hard"
   - scoring: { "mode": "all_or_nothing", "points": 1 }
   - explanation: markdown string explaining why the key is correct

2. "multiple": Multiple response question where any subset can be correct.
   - prompt: markdown string
   - options: array of { "id": "a", "text": "..." }
   - key: array of option ids that are correct (e.g. ["a", "c"])
   - scoring: { "mode": "all_or_nothing", "points": 2 }

3. "true_false": Binary choice question.
   - prompt: markdown string
   - key: boolean true or false
   - scoring: { "mode": "all_or_nothing", "points": 1 }

4. "numeric": Numerical value with optional tolerance.
   - prompt: markdown string
   - unit: optional string (e.g. "kg", "seconds", "m/s")
   - key: { "value": number, "tolerance": number, "tolerance_type": "absolute" }
   - scoring: { "mode": "all_or_nothing", "points": 2 }

5. "short_answer": Text entry matched against acceptable answers.
   - prompt: markdown string
   - accepted: array of string answers accepted as correct
   - match: "exact" | "case_insensitive"
   - scoring: { "mode": "all_or_nothing", "points": 2 }

Do NOT include any commentary, prose, or conversational wrappers. Output ONLY the JSON object.`;
}

export function buildUserPrompt(topicOrText: string, count: number): string {
  return `Generate exactly ${count} distinct, high-quality question(s) based on the following topic or source material:

"""
${topicOrText.trim()}
"""`;
}
