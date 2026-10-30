import { sampleBank } from "./sample.js";

/**
 * BANK_CONVERSION_PROMPT is a few-shot conversion prompt for LLMs (such as ChatGPT,
 * Claude, Gemini, etc.) to convert unstructured question text into a Pariksha
 * question bank JSON adhering to schemas/bank-1.json and validateBank.
 */
export const BANK_CONVERSION_PROMPT = `You are converting raw exam questions into a Pariksha question bank.

Output only a single JSON document, no commentary, no code fence, in this shape:

{ "format": "pariksha/bank@1", "name": "<bank name>", "questions": [ ... ] }

Use the example below as the authority on every field. It supports all twelve question types: single, multiple, select_k, true_false, assertion_reason, matching, multi_matching, ordering, fill_blank, numeric, short_answer, long_answer. Pick the type that fits each question as written — do not convert a question into a different type to make it simpler.

Rules your output must satisfy, because the importer checks every one and rejects the whole file if any fails:
- every question has a unique id within the bank, an answer key, and an explanation — the explanation is what a candidate reads in review, so write it even when the answer looks obvious
- every option id used in a key exists in that question's options
- no two options within one question have identical text
- a select_k key has exactly k entries, and k is fewer than the number of options
- matching and multi_matching keys use only items from left and right, and each matching right-hand item is used at most once
- every fill_blank blank has a matching {{id}} placeholder in the prompt, and every placeholder has a blank
- prefer match: "exact" or "ci" for fill_blank; use "regex" only when genuinely needed, and keep the pattern simple
- numeric questions carry a tolerance when the answer is not exact

Preserve the author's wording. Do not invent questions, do not fix factual errors silently, and if a question is ambiguous or has no determinable answer, leave it out and list it at the end after the JSON, under a line reading SKIPPED:.

Example:
${JSON.stringify(sampleBank(), null, 2)}

Here are my questions:
`;
