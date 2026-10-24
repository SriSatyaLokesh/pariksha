import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { seedWorkspace } from "../seed";
import { ORGANISER, signIn } from "../seed";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "e2e/screenshots");

// In-line detect.js logic from ui-review skill
const DETECT_SCRIPT = `
(() => {
  const CAP = 15;
  const de = document.documentElement;
  const vw = de.clientWidth, vh = de.clientHeight;

  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) return s + "#" + el.id;
    if (el.classList.length) s += "." + [...el.classList].slice(0, 2).join(".");
    const t = (el.textContent || "").trim().slice(0, 40);
    return t ? s + ' ("' + t.replace(/"/g, "'") + '")' : s;
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  };

  const issues = {
    viewport: vw + "x" + vh,
    viewportMetaMissing: !document.querySelector("meta[name=viewport]"),
    horizontalScroll: de.scrollWidth > de.clientWidth + 1,
    offenders: [], clippedText: [], overlaps: [], tinyTapTargets: [],
    brokenImages: [], distortedImages: [], overflowingMedia: [],
    smallText: [], wrappedControls: [], placeholderText: []
  };

  const PLACEHOLDER_RE = /\\b(lorem ipsum|undefined|NaN|\\[object Object\\]|TODO:)/i;

  const collectAll = (root, out) => {
    for (const el of root.querySelectorAll("*")) {
      out.push(el);
      if (el.shadowRoot) collectAll(el.shadowRoot, out);
    }
    return out;
  };
  const everything = collectAll(document.body, []);
  const all = everything.filter(visible);
  const textLeaves = [];

  for (const el of all) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

    if (issues.horizontalScroll && issues.offenders.length < CAP && (r.right > vw + 1 || r.left < -1)) {
      issues.offenders.push({ el: sel(el), left: Math.round(r.left), right: Math.round(r.right) });
    }

    if (hasText) {
      textLeaves.push({ el, r });
      const clipX = el.scrollWidth > el.clientWidth + 2 && (s.overflowX === "hidden" || s.overflowX === "clip") && s.textOverflow !== "ellipsis";
      const clipY = el.scrollHeight > el.clientHeight + 4 && (s.overflowY === "hidden" || s.overflowY === "clip") && s.webkitLineClamp === "none";
      if ((clipX || clipY) && issues.clippedText.length < CAP) {
        issues.clippedText.push({ el: sel(el), axis: clipX ? "x" : "y", scroll: clipX ? el.scrollWidth : el.scrollHeight, client: clipX ? el.clientWidth : el.clientHeight });
      }
      if (parseFloat(s.fontSize) < 12 && issues.smallText.length < CAP) {
        issues.smallText.push({ el: sel(el), fontSize: s.fontSize });
      }
      const txt = el.textContent.trim().slice(0, 200);
      if (PLACEHOLDER_RE.test(txt) && issues.placeholderText.length < CAP) {
        issues.placeholderText.push({ el: sel(el), text: txt.slice(0, 80) });
      }
    }
  }

  for (const el of everything.filter(e => e.matches("a,button,input:not([type=hidden]),select,textarea,[role=button],[role=link]"))) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (issues.tinyTapTargets.length < CAP && !(el.tagName === "A" && s.display === "inline") && (r.width < 24 || r.height < 24)) {
      issues.tinyTapTargets.push({ el: sel(el), size: Math.round(r.width) + "x" + Math.round(r.height) });
    }
    if (issues.wrappedControls.length < CAP && (el.tagName === "BUTTON" || el.tagName === "A") && s.display !== "inline" && el.textContent.trim()) {
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = [...range.getClientRects()].filter(x => x.width > 1 && x.height > 1).map(x => x.top);
      range.detach();
      if (tops.length && Math.max(...tops) - Math.min(...tops) > lh * 0.8) {
        issues.wrappedControls.push({ el: sel(el), height: Math.round(r.height) });
      }
    }
  }

  return JSON.stringify(issues);
})()
`;

test.describe.serial("UI/UX Full Screen Audit Walkthrough", () => {
  const auditResults: Record<string, Record<string, unknown>> = {};

  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  test.afterAll(() => {
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "audit-detect-results.json"),
      JSON.stringify(auditResults, null, 2),
      "utf-8"
    );
  });

  async function auditScreen(page: Page, name: string) {
    const viewports = [
      { width: 1280, height: 800, label: "desktop" },
      { width: 768, height: 1024, label: "tablet" },
      { width: 360, height: 740, label: "mobile" },
    ];

    auditResults[name] = {};

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300);
      const screenshotPath = path.join(SCREENSHOT_DIR, `${name}-${vp.label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      const rawJson = (await page.evaluate(DETECT_SCRIPT)) as string;
      const findings = JSON.parse(rawJson);
      auditResults[name][vp.label] = {
        viewport: `${vp.width}x${vp.height}`,
        horizontalScroll: findings.horizontalScroll,
        offenderCount: findings.offenders.length,
        clippedCount: findings.clippedText.length,
        tinyTapCount: findings.tinyTapTargets.length,
        wrappedControlsCount: findings.wrappedControls.length,
        placeholderCount: findings.placeholderText.length,
        details: findings,
      };
    }
  }

  test("1. Landing page across viewports", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await auditScreen(page, "01-landing");
  });

  test("2. Sign-in page across viewports", async ({ page }) => {
    await page.goto(ORGANISER);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await auditScreen(page, "02-signin");
  });

  test("3. Authenticated Organiser Dashboard, Tests & Banks", async ({ page, request }) => {
    // Seed workspace
    await seedWorkspace(request, {
      banks: 2,
      questionsPerBank: 5,
      tests: 2,
    });

    await page.goto(ORGANISER);
    await signIn(page);
    await page.waitForTimeout(500);

    // 3a. Organiser Home / Dashboard
    await auditScreen(page, "03-organiser-home");

    // 3b. Tests catalog
    await page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: "Tests" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tests" })).toBeVisible();
    await auditScreen(page, "04-tests-catalog");

    // 3c. Test Builder (click first test)
    await page.locator("main#main-content table.testbuilder-list tbody tr .button-link").first().click();
    await expect(page.getByRole("heading", { name: "Sections" })).toBeVisible();
    await auditScreen(page, "05-test-builder");

    // 3d. Question Banks Catalog
    await page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: "Banks" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
    await auditScreen(page, "06-banks-catalog");

    // 3e. Bank Browser
    await page.locator(".bank-list__item").first().click();
    await expect(page.locator("table.bank-browser__table")).toBeAttached();
    await auditScreen(page, "07-bank-browser");
  });

  test("4. Candidate Exam Runtime across viewports", async ({ page, request }) => {
    // Authenticate request context via stub IdP
    await request.get("/api/v1/auth/stub/start");

    // Create candidate test with open access
    const wsRes = await request.get("/api/v1/workspaces");
    const workspaces = (await wsRes.json()).workspaces;
    const ws = workspaces[0];

    const bankRes = await request.post(`/api/v1/workspaces/${ws.id}/banks`, { data: { name: "Exam Audit Bank" } });
    const bankId = (await bankRes.json()).id;
    await request.post(`/api/v1/workspaces/${ws.id}/banks/${bankId}/import`, {
      data: {
        format: "pariksha/bank@1",
        name: "Exam Audit Bank",
        questions: [
          { id: "Q01", type: "multiple_choice", prompt: "Which principle dictates sub-300ms UI animation?", options: ["Emil Kowalski Motion Craft", "Slow Motion", "Lag", "Bounce"], key: [0], points: 1 }
        ]
      }
    });

    const qRes = await request.get(`/api/v1/workspaces/${ws.id}/banks/${bankId}/questions`);
    const qId = (await qRes.json()).questions[0]?.id;

    const testSlug = `exam-audit-${Date.now().toString(36)}`;
    const tRes = await request.post(`/api/v1/workspaces/${ws.id}/tests`, {
      data: { name: "Exam UI Audit", slug: testSlug }
    });
    const testId = (await tRes.json()).id;

    await request.patch(`/api/v1/workspaces/${ws.id}/tests/${testId}/draft`, {
      data: {
        settings: {
          timing: { duration_minutes: 45 },
          access: { mode: "open" },
          proctoring: { profile: "off", overrides: { desktop_only: false } }
        },
        sections: [{ id: "sec-1", title: "General", source: { kind: "fixed", questions: [qId] } }]
      }
    });
    await request.post(`/api/v1/workspaces/${ws.id}/tests/${testId}/publish`, { data: {} });

    // Open candidate runtime URL
    await page.goto(`/${ws.slug}/${testSlug}`);
    await page.waitForTimeout(500);

    // Registration screen
    await auditScreen(page, "08-exam-registration");

    // Click Start Exam if present
    const startBtn = page.getByRole("button", { name: /start|continue|begin|enter/i });
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(500);
      await auditScreen(page, "09-exam-runner");
    }
  });
});
