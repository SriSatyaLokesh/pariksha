// `itemAnalysis()` (Phase 8c Task 2, `R-07`) — the per-question half of
// "was this test any good": share correct, a discrimination index, and
// option pick rates, for every question a test's attempts touched.
//
// The caller hands this one fetch of a whole test's attempts and responses
// (Task 1); this makes ONE pass over the response set (`K19`) rather than a
// sort or filter per question — the 300-candidate x 60-question fixture is
// the size that matters under the Worker's 10ms-per-invocation budget.
//
// `K2`: no time figure. Per-question time was cut from this phase — the
// only free derivation (gaps between response save times) measures the gap
// between saves, not between reading and answering, so it would publish a
// number nobody can stand behind. Nothing here computes one.
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

/** K20's floor: below this the index is withheld and the cell says why. */
export const DISCRIMINATION_MIN_N = 10;

/** The standard upper-/lower-27% split used to compute discrimination. */
const DISCRIMINATION_EDGE = 0.27;

export interface ItemStat {
  questionId: string;
  /** 0-1. */
  shareCorrect: number;
  /** null below DISCRIMINATION_MIN_N, and null for a question with no
   *  variance (everyone right or everyone wrong) — never NaN. */
  discrimination: number | null;
  /** Why it is null, for the surface to render. */
  discriminationWithheld: "too_few_attempts" | "no_variance" | null;
  /** optionId -> share. Empty for a non-choice question. */
  optionPickRates: Record<string, number>;
  n: number;
}

interface Accumulator {
  correct: number;
  total: number;
  topCorrect: number;
  topTotal: number;
  bottomCorrect: number;
  bottomTotal: number;
  optionCounts: Record<string, number>;
  /** Responses that named at least one option — the pick-rate denominator.
   *  Not the same as the sum of `optionCounts`: a multi-select response
   *  names several options but is still one response. */
  optionResponses: number;
}

function emptyAccumulator(): Accumulator {
  return { correct: 0, total: 0, topCorrect: 0, topTotal: 0, bottomCorrect: 0, bottomTotal: 0, optionCounts: {}, optionResponses: 0 };
}

// A response's `value` is `unknown` at this boundary (Task 1's fetch hands
// back whatever was stored as JSON); only `ResponseValue`'s choice-family
// kinds — single-choice "option" and multi-select "options" — contribute to
// pick rates. Anything else — text, number, blank, a non-choice question
// entirely — is simply never recognised here, which is what leaves
// `optionPickRates` empty for it without a special case.
function pickedOptions(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  if (v.kind === "option" && typeof v.option === "string") return [v.option];
  if (v.kind === "options" && Array.isArray(v.options)) {
    return v.options.filter((o): o is string => typeof o === "string");
  }
  return [];
}

/** ONE pass over the whole response set. `K19`. */
export function itemAnalysis(input: {
  attempts: readonly { attemptId: string; percent: number }[];
  responses: readonly { attemptId: string; questionId: string; correct: boolean | null; value: unknown }[];
}): ItemStat[] {
  const { attempts, responses } = input;
  const n = attempts.length;

  // Sort once, slice the edges once — not a sort per question.
  const byPercent = [...attempts].sort((a, b) => b.percent - a.percent);
  const edgeSize = Math.round(n * DISCRIMINATION_EDGE);
  const top = new Set<string>();
  const bottom = new Set<string>();
  for (const a of byPercent.slice(0, edgeSize)) top.add(a.attemptId);
  for (const a of byPercent.slice(n - edgeSize)) bottom.add(a.attemptId);

  const byQuestion = new Map<string, Accumulator>();
  const order: string[] = [];

  for (const r of responses) {
    const { questionId } = r;
    let acc = byQuestion.get(questionId);
    if (!acc) {
      acc = emptyAccumulator();
      byQuestion.set(questionId, acc);
      order.push(questionId);
    }

    // `correct: null` means ungraded/not applicable — it contributes to
    // neither the correctness count nor the top/bottom split, so a
    // question nobody reached (every row null) never divides by zero.
    const { correct } = r;
    if (correct !== null) {
      acc.total++;
      if (correct) acc.correct++;
      if (top.has(r.attemptId)) {
        acc.topTotal++;
        if (correct) acc.topCorrect++;
      } else if (bottom.has(r.attemptId)) {
        acc.bottomTotal++;
        if (correct) acc.bottomCorrect++;
      }
    }

    const picks = pickedOptions(r.value);
    if (picks.length > 0) {
      acc.optionResponses++;
      for (const option of picks) {
        acc.optionCounts[option] = (acc.optionCounts[option] ?? 0) + 1;
      }
    }
  }

  return order.map((questionId) => {
    const acc = byQuestion.get(questionId)!;
    const shareCorrect = acc.total > 0 ? acc.correct / acc.total : 0;

    let discrimination: number | null = null;
    let discriminationWithheld: ItemStat["discriminationWithheld"] = null;
    if (n < DISCRIMINATION_MIN_N) {
      discriminationWithheld = "too_few_attempts";
    } else if (acc.correct === 0 || acc.correct === acc.total) {
      // Covers both "everyone right/wrong" and "nobody answered" (total 0,
      // correct 0) — neither carries a measurable discrimination.
      discriminationWithheld = "no_variance";
    } else {
      const topShare = acc.topTotal > 0 ? acc.topCorrect / acc.topTotal : 0;
      const bottomShare = acc.bottomTotal > 0 ? acc.bottomCorrect / acc.bottomTotal : 0;
      discrimination = topShare - bottomShare;
    }

    // Divided by respondents, not by picks: a single-choice respondent
    // picks exactly one option, so those rates sum to 1 — but a
    // multi-select respondent can name several, so dividing by the pick
    // count would understate every option on a checkbox question. Dividing
    // by `optionResponses` instead makes each rate read "share of
    // candidates who selected this option", which is the number worth
    // hunting a bad distractor with; multi-select rates are expected to sum
    // above 1.
    const optionPickRates: Record<string, number> =
      acc.optionResponses > 0
        ? Object.fromEntries(Object.entries(acc.optionCounts).map(([id, count]) => [id, count / acc.optionResponses]))
        : {};

    return { questionId, shareCorrect, discrimination, discriminationWithheld, optionPickRates, n };
  });
}
