import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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
// L2 (whole-branch review): `sourceFiles` (`css-chain.ts`) only walks
// `.ts`/`.tsx`, which left `apps/web/public/` — plain static assets,
// including any future `AudioWorkletProcessor` script — invisible to every
// scan below. That is exactly where issue #209's `noise-worklet.js` will
// land, so it is widened here while it is free rather than after.
const WEB_PUBLIC_DIR = resolve(TEST_DIR, "../../public");
const REPO_ROOT = resolve(TEST_DIR, "../../../..");

function displayPath(file: string): string {
  return relative(REPO_ROOT, file).replaceAll("\\", "/");
}

/** Every plain `.js` file under `dir`, recursively — `sourceFiles`'s own
 *  walk shape (`css-chain.ts`), but for the extension `apps/web/public/`
 *  actually ships (L2): it is static assets, never `.ts`/`.tsx`. */
function publicJsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) publicJsFiles(full, out);
    else if (/\.js$/.test(full)) out.push(full);
  }
  return out;
}

/** Every line, across every file in `files`, that matches `pattern` once
 *  comments are stripped — `path:line: text`, the verbatim offending line,
 *  not just a filename, so a hit is fast to tell apart from a false one. */
function findings(files: string[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const stripped = stripAllComments(readFileSync(file, "utf8"));
    stripped.split("\n").forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(`${displayPath(file)}:${String(index + 1)}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

const MEDIA_RECORDER_PATTERN = /MediaRecorder/;
const RETAINED_AUDIO_PATTERN = /AudioBuffer|getChannelData/;
const BIOMETRIC_PATTERN = /landmark|embedding|descriptor|faceprint|voiceprint/i;

const webFiles = (): string[] => [...sourceFiles(WEB_SRC_DIR), ...publicJsFiles(WEB_PUBLIC_DIR)];

describe("AG2: no MediaRecorder anywhere in apps/web/src or apps/web/public", () => {
  it("has web source files to scan", () => {
    expect(sourceFiles(WEB_SRC_DIR).length).toBeGreaterThan(50);
  });

  it("never references MediaRecorder", () => {
    expect(findings(webFiles(), MEDIA_RECORDER_PATTERN)).toEqual([]);
  });
});

describe("AG2: no retained audio anywhere in apps/web/src or apps/web/public", () => {
  it("never references AudioBuffer or getChannelData", () => {
    expect(findings(webFiles(), RETAINED_AUDIO_PATTERN)).toEqual([]);
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
    expect(findings([...webFiles(), ...sourceFiles(API_SRC_DIR)], BIOMETRIC_PATTERN)).toEqual([]);
  });
});

// L2 (whole-branch review): the three scans' own control used to be
// `sourceFiles(DIR).length > 50` — proof the WALKER found files, not that
// `findings()` can ever return a hit. A scan whose pattern never matches
// anything (an over-eager `stripAllComments`, a typo'd regex) would still
// pass that control while quietly returning `[]` forever — the fourth shape
// the brief warns against. Each scan below gets its own fixture, through
// the SAME `findings()` the real scan calls, so a broken stripper or a
// broken pattern fails HERE rather than in a silent `toEqual([])` above.
describe("L2: each scan's own pattern can really produce a hit", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A throwaway one-file directory, through the real `.ts` extension
   *  `sourceFiles` requires. */
  function fixture(contents: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), "no-recording-control-"));
    dirs.push(dir);
    writeFileSync(join(dir, "fixture.ts"), contents);
    return sourceFiles(dir);
  }

  it("the MediaRecorder pattern matches a real reference", () => {
    const files = fixture("const r = new MediaRecorder(stream);\n");
    expect(findings(files, MEDIA_RECORDER_PATTERN)).toHaveLength(1);
  });

  it("the retained-audio pattern matches a real reference", () => {
    const files = fixture("const data = buffer.getChannelData(0);\n");
    expect(findings(files, RETAINED_AUDIO_PATTERN)).toHaveLength(1);
  });

  it("the biometric pattern matches a real reference", () => {
    const files = fixture("const faceDescriptor = computeSomething();\n");
    expect(findings(files, BIOMETRIC_PATTERN)).toHaveLength(1);
  });

  it("the walker now sees a plain .js file under apps/web/public", () => {
    const dir = mkdtempSync(join(tmpdir(), "no-recording-control-"));
    dirs.push(dir);
    writeFileSync(join(dir, "noise-worklet.js"), "const r = new MediaRecorder(stream);\n");
    expect(findings(publicJsFiles(dir), MEDIA_RECORDER_PATTERN)).toHaveLength(1);
  });
});
