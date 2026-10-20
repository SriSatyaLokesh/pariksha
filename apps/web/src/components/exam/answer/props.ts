import type { ResponseValue } from "@pariksha/core";
import type { CandidateQuestion } from "../../../lib/paper";

/** The one prop shape all three answer families take. Its own module so
 * `index.tsx` can import the three components without any of them having
 * to import `index.tsx` back. */
export interface AnswerProps {
  question: CandidateQuestion;
  value: ResponseValue | null;
  onChange: (next: ResponseValue | null) => void;
  disabled: boolean;
}
