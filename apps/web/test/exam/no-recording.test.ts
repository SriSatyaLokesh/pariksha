import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceFiles, stripCssComments } from "../css-chain";

// `AG2`/`AG3`: three mechanical, permanent scans. `Q12b`'s microphone
// feature (noise monitoring) is cut from this phase — deferred to issue
// #209 against Phase 8 — but these scans ship now anyway, against a field
// nothing can fill yet: the plan's own argument for the biometric scan
// ("already in place when Phase 8 turns face counting on") applies
// identically to the two audio ones.
//
// `D-R2` (not re-litigable): every scan below strips comments before
// matching. `stripCssComments` (`css-chain.ts`) already strips the `/* */`
// block form JS/TS/CSS share — reused here rather than writing a second
// block-comment stripper. `//` line comments are stripped too, for the same
// reason `D-R2` gives: real prose in this tree already uses every one of
// these words to explain what the code does NOT do, and a scan that reddens
// on its own documentation gets loosened until green, which is worse than no
// scan at all. Confirmed present on this branch: `camera.ts`'s own `AG2`
// note ("never a `MediaRecorder`", a `//` comment), `Runner.tsx`'s ARIA note
// (`landmark`, inside a `{/* */}` JSX comment) and `OrganiserShell.tsx`'s
// doc comment (`descriptor`, a `/* */` block).
function stripAllComments(text: string): string {
  return stripCssComments(text).replace(/\/\/.*$/gm, "");
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = resolve(TEST_DIR, "../../src");
const API_SRC_DIR = resolve(TEST_DIR, "../../../api/src");
const REPO_ROOT = resolve(TEST_DIR, "../../../..");

function displayPath(file: string): string {
  return relative(REPO_ROOT, file).replaceAll("\\", "/");
}

/** Every line, across every `.ts`/`.tsx` file under `dirs`, that matches
 *  `pattern` once comments are stripped — `path:line: text`, the verbatim
 *  offending line, not just a filename, so a hit is fast to tell apart from
 *  a false one. */
function findings(dirs: string[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of dirs.flatMap((dir) => sourceFiles(dir))) {
    const stripped = stripAllComments(readFileSync(file, "utf8"));
    stripped.split("\n").forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(`${displayPath(file)}:${String(index + 1)}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

describe("AG2: no MediaRecorder anywhere in apps/web/src", () => {
  it("has web source files to scan", () => {
    expect(sourceFiles(WEB_SRC_DIR).length).toBeGreaterThan(50);
  });

  it("never references MediaRecorder", () => {
    expect(findings([WEB_SRC_DIR], /MediaRecorder/)).toEqual([]);
  });
});

describe("AG2: no retained audio anywhere in apps/web/src", () => {
  it("never references AudioBuffer or getChannelData", () => {
    expect(findings([WEB_SRC_DIR], /AudioBuffer|getChannelData/)).toEqual([]);
  });
});

describe("AG3: no biometric template anywhere in apps/web/src or apps/api/src", () => {
  it("has api source files to scan", () => {
    expect(sourceFiles(API_SRC_DIR).length).toBeGreaterThan(5);
  });

  // No `\b` word boundaries: a field named `faceDescriptor` or
  // `landmarkIndex` must be caught too, and a leading `\b` would miss it —
  // the boundary before `Descriptor` inside `faceDescriptor` does not exist
  // (letter to letter), which is exactly how this regex missed `Q10a`'s own
  // probe on its first draft. Plain substrings, over-inclusive on purpose.
  it("never references a landmark, embedding, descriptor, faceprint or voiceprint", () => {
    expect(
      findings([WEB_SRC_DIR, API_SRC_DIR], /landmark|embedding|descriptor|faceprint|voiceprint/i),
    ).toEqual([]);
  });
});
