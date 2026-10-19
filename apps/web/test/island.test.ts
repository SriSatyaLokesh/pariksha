// Behaviour tests for the landing page's one island, src/island/exam-demo.ts
// (the Signal hero's pool draw and build-status toggle) — run against a
// hand-built fixture matching the data-attribute contract documented at the
// top of that file, not against apps/web/src/sections/signal/Head.tsx, so
// this file does not depend on that markup staying byte-for-byte identical.
//
// The module has no exported init(): startDraw()/startStatus() run as a
// side effect of importing it, against whatever is in `document` at that
// moment (progressive enhancement, never hydration — see the file's own
// header comment). So every test here mounts its fixture first, then
// vi.resetModules() + a fresh dynamic import to get a clean run of those
// side effects against it.
//
// The artefact checks (network/storage ban, no timers, size budget) live in
// island-artefact.test.ts, which needs esbuild's node-only API and so
// cannot share this file's jsdom environment.
import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadFreshIsland() {
  vi.resetModules();
  return import("../src/island/exam-demo");
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

// A trimmed but real fixture: the draw (rows + three tag chips + redraw)
// and the status toggle (two chips + two lists), using the module's own
// bank keys so drawFrom draws from its real pools.
function drawAndStatusFixture(): void {
  document.body.innerHTML = `
    <div class="signal-chips">
      <button data-signal-chip data-tag="reasoning" aria-pressed="true">reasoning</button>
      <button data-signal-chip data-tag="quantitative" aria-pressed="false">quantitative</button>
      <button data-signal-chip data-tag="verbal" aria-pressed="false">verbal</button>
    </div>
    <div data-signal-rows></div>
    <button data-signal-redraw>Draw again</button>

    <div class="signal-chips">
      <button data-signal-status="live" aria-pressed="true">Live today</button>
      <button data-signal-status="next" aria-pressed="false">Lands with v0.1</button>
    </div>
    <ul data-signal-list="live"><li>a</li></ul>
    <ul data-signal-list="next" hidden><li>b</li></ul>
  `;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("drawFrom", () => {
  it("returns n distinct members of the pool and does not mutate the input", async () => {
    const { drawFrom } = await loadFreshIsland();
    const pool = ["a", "b", "c", "d", "e"];
    const snapshot = [...pool];

    const drawn = drawFrom(pool, 4);
    expect(drawn).toHaveLength(4);
    expect(new Set(drawn).size).toBe(4);
    for (const id of drawn) expect(pool).toContain(id);
    expect(pool).toEqual(snapshot);
  });

  it("never returns more than the pool holds", async () => {
    const { drawFrom } = await loadFreshIsland();
    const pool = ["a", "b"];
    expect(drawFrom(pool, 4)).toHaveLength(2);
  });
});

describe("the hero's chip-filtered draw", () => {
  it("clicking a chip sets aria-pressed on it alone, and redraws three rows", async () => {
    drawAndStatusFixture();
    await loadFreshIsland();

    const [reasoning, quantitative, verbal] = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-signal-chip]"),
    );
    click(quantitative!);

    expect(reasoning!.getAttribute("aria-pressed")).toBe("false");
    expect(quantitative!.getAttribute("aria-pressed")).toBe("true");
    expect(verbal!.getAttribute("aria-pressed")).toBe("false");

    const rows = document.querySelectorAll(
      "[data-signal-rows] .signal-row",
    );
    expect(rows).toHaveLength(3);
  });

  it('"Draw again" re-renders three rows', async () => {
    drawAndStatusFixture();
    await loadFreshIsland();

    // data-signal-rows starts empty in this fixture (the real page's rows
    // are prerendered server-side; startDraw only wires listeners, it
    // never renders on its own) — so the redraw click is what's under
    // test, not whatever was there before it.
    click(document.querySelector("[data-signal-redraw]")!);

    const rows = document.querySelectorAll(
      "[data-signal-rows] .signal-row",
    );
    expect(rows).toHaveLength(3);

    // A second redraw still produces exactly three rows, replacing rather
    // than accumulating.
    click(document.querySelector("[data-signal-redraw]")!);
    expect(
      document.querySelectorAll("[data-signal-rows] .signal-row"),
    ).toHaveLength(3);
  });
});

describe("the build-status toggle", () => {
  it("hides exactly one list from the start, and swaps which one on click", async () => {
    drawAndStatusFixture();
    await loadFreshIsland();

    const live = document.querySelector<HTMLElement>(
      '[data-signal-list="live"]',
    )!;
    const next = document.querySelector<HTMLElement>(
      '[data-signal-list="next"]',
    )!;

    // Both lists are prerendered visible (no-JS fallback); the island's own
    // first act is to hide one of them.
    expect([live.hidden, next.hidden].filter(Boolean)).toHaveLength(1);
    expect(live.hidden).toBe(false);
    expect(next.hidden).toBe(true);

    click(document.querySelector('[data-signal-status="next"]')!);

    expect([live.hidden, next.hidden].filter(Boolean)).toHaveLength(1);
    expect(live.hidden).toBe(true);
    expect(next.hidden).toBe(false);
  });
});

describe("no prerendered hooks", () => {
  it("is a no-op when none of its data attributes are present", async () => {
    document.body.innerHTML = "<p>nothing to upgrade here</p>";
    await expect(loadFreshIsland()).resolves.toBeDefined();
    expect(document.body.innerHTML).toBe("<p>nothing to upgrade here</p>");
  });
});
