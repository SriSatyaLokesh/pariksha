import type { SaveState } from "../../lib/queue";

/**
 * `C-05`'s save banner: the one line that tells a candidate whether the
 * last twenty minutes of their life is on a server.
 *
 * Four states, and the candidate who needs it most is reading it with the
 * network down and a clock running. So:
 *
 *  * **A word, always.** `DESIGN.md`: "Colour is never the only carrier
 *    here". The four words differ from each other, not just from blank,
 *    which is the property `autosave.test.tsx` asserts — a banner that
 *    said "Saved" in four colours would pass a per-state check and fail
 *    a candidate who cannot see them.
 *  * **A mark beside it**, in the mono face the device report uses, for
 *    the glance that does not read. `aria-hidden`, because the word next
 *    to it already says this.
 *  * **A live region from the first render**, not inserted with its
 *    content: a `role="status"` a screen reader has never seen is one it
 *    does not announce.
 *  * **The refusal is an `alert`, separately.** "Not saved" is the state
 *    and goes in the polite region; *why* is assertive, because a
 *    candidate who does not hear it keeps typing into nothing. The two
 *    are siblings rather than nested, so neither is announced twice.
 *  * **Nothing moves.** No spinner, no fade. A candidate who thinks the
 *    page reloaded thinks their answer went with it.
 */

const MARK: Readonly<Record<SaveState["kind"], string>> = {
  idle: "",
  saving: "…",
  saved: "OK",
  offline: "OFF",
  refused: "!",
};

function label(state: SaveState): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "saving":
      return state.pending > 1 ? `Saving ${String(state.pending)} answers…` : "Saving…";
    case "saved":
      return "Saved";
    case "offline":
      // The count is the point: "Offline" alone does not say whether one
      // answer is waiting or the whole paper is.
      return state.pending === 1
        ? "Offline — 1 answer waiting"
        : `Offline — ${String(state.pending)} answers waiting`;
    case "refused":
      return "Not saved";
  }
}

export function SaveBanner({ state }: { state: SaveState }) {
  return (
    <p className="exam-save-banner" data-state={state.kind}>
      {/* Named, because out of context "Saved" says nothing about what
          was saved — and the name is additional to the text, never a
          replacement for it (WCAG 2.5.3). */}
      <span role="status" aria-label="Save status" className="exam-save-status">
        <span className="exam-save-mark" aria-hidden="true">
          {MARK[state.kind]}
        </span>
        <span className="exam-save-text">{label(state)}</span>
      </span>
      {state.kind === "refused" && (
        <span role="alert" className="exam-save-alert">
          {state.message}
        </span>
      )}
    </p>
  );
}
