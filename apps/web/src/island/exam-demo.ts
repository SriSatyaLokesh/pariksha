// The landing page's one island: the hero's pool draw, plus the build
// status toggle.
//
// Signal direction. The hero shows the single capability that is shipped
// today and impossible in a form tool — a pool handing a different paper
// to every candidate — because the application itself does not exist yet
// and there is no honest screenshot to take.
//
// Progressive enhancement, not hydration: this module upgrades prerendered
// markup in place and never renders a block from scratch. With no
// JavaScript, or on any failure, the prerendered page — a real first draw,
// both status lists, every link — is what the visitor sees; this file's
// job is to never make that worse.
//
// No network call, no storage, no telemetry, ever. See the forbidden list
// in apps/web/test/island-artefact.test.ts.
//
// -----------------------------------------------------------------------
// The contract with the prerendered markup (data attributes only, never
// class names — a renamed block must not break the demo):
//
//   data-signal-rows        the draw's row container. Absent -> the draw
//                           half of this module returns and leaves the
//                           prerendered rows alone.
//   data-signal-chip        a tag filter. `data-tag` names the pool.
//   data-signal-redraw      the "Draw again" button.
//   data-signal-status      a build-status chip. Value "live" or "next".
//   data-signal-list        a build-status list. Value "live" or "next".
// -----------------------------------------------------------------------

/** The banks the chips draw from, by tag. Identifiers follow the worked
 *  example's own (`examples/reasoning-aptitude/questions.json`). */
const BANKS: Record<string, readonly string[]> = {
  reasoning: [
    "LOG-001",
    "LOG-002",
    "LOG-003",
    "LOG-004",
    "LOG-006",
    "LOG-007",
    "LOG-009",
    "SER-001",
    "SER-002",
  ],
  quantitative: [
    "QNT-001",
    "QNT-002",
    "QNT-003",
    "QNT-004",
    "QNT-006",
    "QNT-007",
    "NUM-001",
    "NUM-002",
  ],
  verbal: [
    "VRB-001",
    "VRB-002",
    "VRB-004",
    "VRB-005",
    "RDG-001",
    "RDG-002",
    "RDG-003",
  ],
  all: [
    "LOG-001",
    "LOG-004",
    "SER-002",
    "QNT-003",
    "VRB-001",
    "NUM-002",
    "RDG-001",
    "LOG-009",
    "QNT-006",
  ],
};

const CANDIDATES = ["Ananya Rao", "Rahul Nair", "Fatima Sheikh"] as const;
const DRAW_COUNT = 4;
const DEFAULT_TAG = "reasoning";

/** Draws `n` distinct identifiers from a pool without replacement — the
 *  shape `packages/core`'s pool selection has, with its seed left out
 *  because nothing on this page is an attempt. */
export function drawFrom(pool: readonly string[], n: number): string[] {
  const rest = pool.slice();
  const out: string[] = [];
  for (let i = 0; i < n && rest.length > 0; i += 1) {
    const [picked] = rest.splice(Math.floor(Math.random() * rest.length), 1);
    if (picked !== undefined) out.push(picked);
  }
  return out;
}

function renderDraw(rows: HTMLElement, tag: string): void {
  const pool = BANKS[tag] ?? BANKS[DEFAULT_TAG] ?? [];
  const next = CANDIDATES.map((name) => {
    const row = document.createElement("div");
    row.className = "signal-row";

    const who = document.createElement("b");
    who.textContent = name;

    const ids = drawFrom(pool, DRAW_COUNT);
    const marked = Math.floor(Math.random() * ids.length);
    const list = document.createElement("span");
    ids.forEach((id, i) => {
      if (i > 0) list.append(" · ");
      if (i === marked) {
        const em = document.createElement("em");
        em.textContent = id;
        list.append(em);
      } else {
        list.append(id);
      }
    });

    row.append(who, list);
    return row;
  });
  rows.replaceChildren(...next);
}

function startDraw(): void {
  const rows = document.querySelector<HTMLElement>("[data-signal-rows]");
  if (!rows) return;

  const chips = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-signal-chip]"),
  );
  let tag =
    chips.find((chip) => chip.getAttribute("aria-pressed") === "true")?.dataset
      .tag ?? DEFAULT_TAG;

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((other) => {
        other.setAttribute("aria-pressed", other === chip ? "true" : "false");
      });
      tag = chip.dataset.tag ?? DEFAULT_TAG;
      renderDraw(rows, tag);
    });
  });

  const again = document.querySelector<HTMLButtonElement>(
    "[data-signal-redraw]",
  );
  if (again) {
    again.addEventListener("click", () => {
      renderDraw(rows, tag);
    });
  }
}

function startStatus(): void {
  const chips = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-signal-status]"),
  );
  const lists = Array.from(
    document.querySelectorAll<HTMLElement>("[data-signal-list]"),
  );
  if (chips.length === 0 || lists.length === 0) return;

  const show = (which: string): void => {
    chips.forEach((chip) => {
      chip.setAttribute(
        "aria-pressed",
        chip.dataset.signalStatus === which ? "true" : "false",
      );
    });
    lists.forEach((list) => {
      list.hidden = list.dataset.signalList !== which;
    });
  };

  // Both lists are prerendered and visible, so the page reads whole with
  // no JavaScript. The island is what turns them into a choice, so it is
  // also what first hides one.
  show("live");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      show(chip.dataset.signalStatus ?? "live");
    });
  });
}

startDraw();
startStatus();
