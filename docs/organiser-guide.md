# Pariksha Organiser Guide

This comprehensive manual covers question authoring, test design, proctoring policies, candidate access controls, live exam monitoring, and result evaluations in Pariksha (`O-04`).

---

## 1. Workspaces and Team Roles

Pariksha organises assessment assets inside tenant-isolated **workspaces** (`AC-23`). Each workspace contains its own question banks, tests, candidate registries, API keys, webhooks, and audit logs.

### Role Permission Matrix
- **Owner:** Complete control over workspace settings, billing, domain names, API keys, and deletion.
- **Admin:** Manages tests, authoring, user memberships, and exports; cannot delete the workspace.
- **Author:** Can create and edit question banks and test drafts; cannot publish tests or view final scored candidate identities.
- **Proctor:** Observes live exam monitoring sessions, receives integrity flags, and issues candidate messages or unlocks; cannot edit questions or settings.
- **Evaluator:** Evaluates manual subjective questions, grading rubrics, and model answer reviews.

---

## 2. Question Banks and Authoring

Pariksha supports 12 standardized question types defined in [question-format.md](question-format.md):
1. **Single Choice (`single`):** Radio button selection with exactly one correct answer.
2. **Multiple Choice (`multiple`):** Multi-select checkboxes with partial credit or penalty modes.
3. **True / False (`true_false`):** Binary assertion testing.
4. **Numeric (`numeric`):** Numerical input with exact match, tolerance bands (`± tolerance`), or decimal ranges.
5. **Fill in the Blank (`fill_in_the_blank`):** Single or multiple text inputs with case-sensitive, normalized, or regex matching.
6. **Matching (`matching`):** Pairwise item matching with randomized distractor keys.
7. **Ordering (`ordering`):** Sequence arrangement of steps, chronological dates, or processes.
8. **Short Answer (`short_answer`):** Single-paragraph textual answer evaluated against accepted regex patterns or manual rubric.
9. **Essay (`essay`):** Long-form subjective answer with rich formatting, word counters, and multi-criteria rubrics.
10. **Code Runner (`code`):** Programming code submission with syntax highlighting and language selection.
11. **File Upload (`file_upload`):** Candidate file submissions (PDF, images, archives) stored directly in encrypted object storage.
12. **Passage / Group (`passage_group`):** Reading comprehension passages or case studies shared across multiple nested child questions.

### Authoring Features
- **Live Preview:** Instant split-screen preview supporting Markdown, LaTeX equations (`$...$`, `$$...$$`), and code syntax highlighting.
- **Import Formats:** Import entire banks via Pariksha JSON, CSV, or Moodle GIFT format with line-by-line validation reports.
- **Tagging & Metadata:** Group questions by subject, cognitive difficulty (`easy`, `medium`, `hard`), and curriculum tags.

---

## 3. Test Builder & Assembly

Tests follow a versioned lifecycle: `Draft` → `Scheduled` → `Open` → `Closed` → `Archived`.

### Structure & Sections
- **Section Division:** Divide your test into distinct sections (e.g. "Section A: Quantitative", "Section B: Reasoning", "Section C: Verbal").
- **Question Allocation Modes:**
  - **Fixed List:** Exact specific questions presented in fixed or randomized order.
  - **Random Pool Draw:** Dynamically draws `N` questions per candidate from tagged bank pools, ensuring no two candidates receive the same exam paper.
  - **Balanced Sets:** Assigns candidates to pre-defined set variants (`Set 1`, `Set 2`).
- **Scoring Configurations:**
  - Configure point weights per question.
  - Choose scoring mode: `all_or_nothing`, `partial_credit`, `partial_with_penalty`, or `proportional`.

### Timing & Navigation Policies
- **Exam Duration:** Fixed overall countdown timer in minutes.
- **Per-Section Timers:** Dedicated time ceilings per section.
- **Navigation Modes:**
  - `Free`: Candidate may jump between any questions and sections freely.
  - `Linear`: Candidate proceeds question by question without returning to previous items.
  - `Per-Section`: Candidate may review within the active section, but cannot revisit previous sections once submitted.

---

## 4. Proctoring & Integrity Controls

Configure proctoring intensity based on exam stakes:
- **Off:** Unproctored testing suitable for practice, homework, or low-stakes quizzes.
- **Standard:** Fullscreen enforcement, browser tab-switch detection, and blur logging.
- **Strict:** Includes initial identity photo capture, periodic webcam snapshot sampling, strict violation thresholds, and automatic exam freeze/lock on repeated anomalies.
- **Violation Limits & Actions:**
  - Specify threshold limit (e.g., 3 violations).
  - Select trigger action: `flag` (alerts proctors silently), `warn` (candidate banner alert), `kick` (immediate termination), or `lock` (candidate interface is frozen until organiser issues unlock code).

---

## 5. Live Monitoring and Results

- **Live Monitor:** Real-time dashboard showing candidate connection statuses, progress percentages, latest heartbeat timestamps, and anomaly counts.
- **Proctor Broadcast:** Send live advisory announcements directly to active candidates.
- **Item Analysis & Analytics:** Detailed facility index, discrimination score, and response distribution per question item.
- **Results Export:** Instant CSV export carrying scores, attempt timelines, proctoring outcomes, and cryptographic verification links.
