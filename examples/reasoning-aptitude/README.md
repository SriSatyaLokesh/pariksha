# Example: a reasoning and aptitude test, end to end

This is a complete worked example of one Pariksha test. It shows **what an organiser types in, what the candidate sees, and what comes out at the end** — so you can copy it, change the questions, and run your own.

The test: a 45-minute campus screening round, taken unsupervised in a browser, with Standard proctoring.

| File | What it is | Who writes it |
| --- | --- | --- |
| [`test.json`](test.json) | The whole test: timing, access, registration form, proctoring, scoring, sections, release | Organiser (or exported from the test builder) |
| [`questions.json`](questions.json) | 17 questions with their answer keys and explanations | Question author |
| [`candidates.csv`](candidates.csv) | The list of people allowed to take it | Organiser |
| [`results.csv`](results.csv) | What you download when it is over | Pariksha |

> **Note.** Pariksha is pre-alpha; the app that reads these files lands with v0.1. The formats below are final enough to write questions against today, and the schemas in [`schemas/`](../../schemas/) validate them in CI.

---

## 1. The input

### 1.1 Questions

Questions live in a bank file. Each one carries its type, prompt, options, **answer key**, points and an explanation that is shown only in review — never during the test.

```json
{
  "id": "QNT-001",
  "type": "numeric",
  "prompt": "A train 180 metres long passes a pole in 9 seconds. What is the speed of the train in kilometres per hour?",
  "unit": "km/h",
  "key": { "value": 72, "tolerance": 0, "tolerance_type": "absolute" },
  "difficulty": "easy",
  "tags": ["quantitative", "speed-distance-time"],
  "scoring": { "mode": "all_or_nothing", "points": 2 },
  "explanation": "The train covers its own length: 180 ÷ 9 = 20 m/s. Multiply by 18/5 to get 72 km/h."
}
```

The 17 questions in this example use **all twelve question types**, so the file doubles as a reference:

| # | ID | Type | What it asks | Points |
| --- | --- | --- | --- | --- |
| 1 | QNT-001 | `numeric` | Train speed, answer in km/h | 2 |
| 2 | QNT-002 | `numeric` | Two people working together | 2 |
| 3 | QNT-003 | `select_k` | Pick exactly two primes | 2 |
| 4 | QNT-004 | `multiple` | Every number divisible by 6 | 2 |
| 5 | QNT-005 | `fill_blank` | Fill two gaps in a series | 2 |
| 6 | LOG-001 | `single` | Next term of 3, 7, 15, 31, 63 | 2 |
| 7 | LOG-002 | `single` | Blood relation from a photograph | 2 |
| 8 | LOG-003 | `matching` | Series → the rule behind it | 2 |
| 9 | LOG-004 | `multi_matching` | Every property each number has | 2 |
| 10 | LOG-005 | `assertion_reason` | Why a syllogism fails | 2 |
| 11 | LOG-006 | `ordering` | Five words in dictionary order | 2 |
| 12 | LOG-007 | `true_false` | A letter-shift code | 1 |
| 13 | LOG-008 | `true_false` | A contrapositive | 1 |
| 14 | DIN-001 | `single` | Reads a table (passage group) | 2 |
| 15 | DIN-002 | `numeric` | Percentage rise from the same table | 2 |
| 16 | WRI-001 | `short_answer` | State a rule in one sentence — **marked by a person** | 3 |
| 17 | WRI-002 | `long_answer` | Find the flaw in an argument — **marked with a rubric** | 5 |

DIN-001 and DIN-002 share a **passage group**: one table is shown once, above both questions.

Full field-by-field reference: [docs/question-format.md](../../docs/question-format.md).

### 1.2 The test

`test.json` is everything else. Five blocks matter most:

**Timing** — the clock is the server's, so changing the computer's clock does nothing.

```json
"timing": {
  "timezone": "Asia/Kolkata",
  "opens_at": "2026-11-14T09:00:00+05:30",
  "closes_at": "2026-11-14T13:00:00+05:30",
  "duration_minutes": 45,
  "navigation": "per_section",
  "attempts_allowed": 1
}
```

**Access** — a public URL plus a code the invigilator reads out in the room. The other modes are personal invite links, a one-time code by email, or the candidate's own college sign-in.

```json
"access": { "mode": "link_code", "access_code": "APTI-2026", "allow_email_domains": ["*.edu.in", "*.ac.in"] }
```

**Sections** — this test uses all three ways of choosing questions, one per section:

| Section | Source | What happens |
| --- | --- | --- |
| Quantitative aptitude | `pool` | Each candidate gets 4 questions drawn at random from everything tagged `quantitative` |
| Logical reasoning | `sets` | Two fixed papers, A and B, handed out round-robin, so neighbours never get the same one |
| Data interpretation and written reasoning | `fixed` | Everyone gets the same four questions, in the same order |

Sets A and B are both worth 7 points. Pariksha warns you before publishing if your sets drift apart in total points, or if a pool holds fewer questions than you asked it to draw.

**Scoring** — set once for the test, overridable per question:

```json
"scoring": { "default_mode": "negative", "negative_fraction": 0.25, "pass_mark_percent": 50 }
```

A wrong answer costs a quarter of that question's points. A blank costs nothing — which is the point of saying so in the instructions.

**Release** — nobody sees a score until two days later, and then only their total and the three section scores. Correct answers stay hidden.

```json
"release": { "when": "on_date", "at": "2026-11-16T18:00:00+05:30", "show": "score_and_sections" }
```

### 1.3 Candidates

```csv
roll_number,full_name,email,set
21CS0147,Ananya Rao,ananya.rao@vce.edu.in,A
21CS0162,Rohit Verma,rohit.verma@vce.edu.in,B
```

Upload this to limit who may register, to send one personal link each, or to fix which set each person gets. Leave out the `set` column and Pariksha assigns sets itself.

---

## 2. The registration form

Every test has its own form, built from the field types below. This example asks thirteen questions of its own and uses every field type at least once, so you can see what each looks like.

```
┌──────────────────────────────────────────────────────────────┐
│  VCE Placement Cell          Reasoning and Aptitude 2026     │
├──────────────────────────────────────────────────────────────┤
│  Before you start                                            │
│  All fields marked * are required. Use the email address     │
│  your college uses for placements — your result is sent      │
│  there.                                                      │
│                                                              │
│  Full name *                                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Ananya Rao                                             │  │   short_text
│  └────────────────────────────────────────────────────────┘  │
│  As it appears on your college records.                      │
│                                                              │
│  College email address *                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ananya.rao@vce.edu.in                                  │  │   email · unique
│  └────────────────────────────────────────────────────────┘  │
│  We send your result here. Personal addresses are not        │
│  accepted.                                                   │
│                                                              │
│  Mobile number *                                             │
│  ┌──────┬─────────────────────────────────────────────────┐  │
│  │ +91 ▾│ 98765 43210                                     │  │   phone
│  └──────┴─────────────────────────────────────────────────┘  │
│                                                              │
│  Roll number *                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 21CS0147                                               │  │   short_text · unique · pattern
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Degree *                 Year of graduation *   CGPA *      │
│  ┌──────────────────┐     ┌──────────────┐    ┌───────────┐  │
│  │ B.Tech        ▾  │     │ 2027      ⇅  │    │ 8.40   ⇅  │  │   dropdown · number · number
│  └──────────────────┘     └──────────────┘    └───────────┘  │
│                                                              │
│  Date of birth *                                             │
│  ┌──────────────────┐                                        │
│  │ 14 / 07 / 2005 📅│                                        │   date
│  └──────────────────┘                                        │
│                                                              │
│  Link to your resume *                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ https://drive.google.com/file/d/1xYz9                  │  │   url · allowed domains
│  └────────────────────────────────────────────────────────┘  │
│  A Google Drive, OneDrive or GitHub link that anyone with    │
│  the link can open.                                          │
│                                                              │
│  Which role are you applying for? *                          │
│   ( ) Software engineering                                   │
│   (•) Data and analytics                                     │   radio
│   ( ) Quality engineering                                    │
│                                                              │
│  Do you need any of these?                                   │
│   [ ] Extra time (approved accommodation)                    │
│   [x] Larger text                                            │   checkbox
│   [ ] High-contrast colours                                  │
│   [ ] Screen reader support                                  │
│                                                              │
│  Anything else the organiser should know?                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                                                        │  │   long_text
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│   [x] I have read and accept how my data is used.            │   consent
│       What we collect and why ⓘ                              │
│                                                              │
│                      ┌───────────────────────────────────┐   │
│                      │        Start the test  →          │   │
│                      └───────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Field types you can use

| `type` | Candidate sees | Validation you can set |
| --- | --- | --- |
| `short_text` | One-line box | `min_length`, `max_length`, `pattern` + `pattern_message` |
| `long_text` | Text area | `max_length` |
| `email` | Email box | `allowed_domains` (globs, e.g. `*.ac.in`) |
| `phone` | Country code + number | `default_country` |
| `number` | Number box with steppers | `min`, `max`, `integer`, `decimals` |
| `date` | Date picker | `min`, `max` |
| `dropdown` | Select list | `options` (required) |
| `radio` | One of several | `options` (required) |
| `checkbox` | Any of several | `options` (required) |
| `url` | Link box | `allowed_domains`, `check_reachable` |
| `consent` | Tick box with linked text | — |

Two flags matter on every field:

- `required: true` — blocks submission with a message **on the field**, not a page-level alert.
- `unique: true` — a second registration with the same value is refused. Put it on email, phone or roll number to stop one person taking the test twice.

**Every rule is re-checked on the server.** The browser's version is there to be helpful, not to be trusted.

### Error states

```
│  Roll number *                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 21cs147                                                │  │  ← red border
│  └────────────────────────────────────────────────────────┘  │
│  ⚠ Format: 21CS0147 — two digits, two letters, four digits.  │
│                                                              │
│  College email address *                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ananya.rao@vce.edu.in                                  │  │  ← red border
│  └────────────────────────────────────────────────────────┘  │
│  ⚠ Someone has already registered with this email. If that   │
│    was you, use the link in your inbox to continue.          │
```

Write `pattern_message` for every pattern you use. "Invalid format" tells a nervous candidate nothing.

---

## 3. What the candidate sees

### 3.1 Landing page

```
┌──────────────────────────────────────────────────────────────┐
│  Reasoning and Aptitude Screening 2026                       │
│  VCE Placement Cell                                          │
│                                                              │
│  45 minutes  ·  3 sections  ·  12 questions  ·  27 points    │
│  Opens  14 Nov 2026, 9:00 AM IST                             │
│  Closes 14 Nov 2026, 1:00 PM IST (last start 12:00 PM)       │
│                                                              │
│  Before you begin                                            │
│  • Laptop or desktop computer only. Phones and tablets       │
│    cannot open this test.                                    │
│  • The test runs in fullscreen. Leaving fullscreen or        │
│    switching tabs is recorded and shown to the organiser.    │
│  • A wrong answer loses a quarter of that question's         │
│    points. Leaving it blank loses nothing.                   │
│  • Your camera is NOT used in this test.                     │
│  • Each section has its own clock. Once you leave a          │
│    section you cannot return to it.                          │
│                                                              │
│  Access code                                                 │
│  ┌──────────────────┐   ┌──────────────────────┐             │
│  │ APTI-2026        │   │  Check my device     │             │
│  └──────────────────┘   └──────────────────────┘             │
│                                                              │
│                      ┌───────────────────────────────────┐   │
│                      │           Continue  →             │   │
│                      └───────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Check my device** runs the browser, screen-size and (for Strict tests) camera checks before the window opens, so nobody discovers a problem at 9:00 AM.

### 3.2 Test screen

```
┌──────────────────────────────────────────────────────────────┐
│ Section 2 of 3 · Logical reasoning     Section 08:41 ▸ Total 22:10 │
├────────────────────────────────────────────┬─────────────────┤
│                                            │  Questions      │
│  Question 6 of 12                   2 pts  │                 │
│                                            │  Section 1      │
│  What comes next in the series?            │  ① ② ③ ④        │
│                                            │                 │
│      3, 7, 15, 31, 63, ?                   │  Section 2      │
│                                            │  ⑤ ⑥ ⑦ ⑧        │
│   ( ) 95                                   │   ▲             │
│   (•) 127                                  │   you are here  │
│   ( ) 117                                  │                 │
│   ( ) 131                                  │  Section 3      │
│                                            │  🔒 locked      │
│                                            │                 │
│  ┌──────────┐  ┌──────────────────┐        │  ■ answered     │
│  │ ← Previous│  │ Mark for review  │        │  ▣ marked      │
│  └──────────┘  └──────────────────┘        │  □ not answered │
│  ┌───────────────┐ ┌─────────────┐         │                 │
│  │ Clear answer  │ │   Next →    │         │  🖩 Calculator  │
│  └───────────────┘ └─────────────┘         │  A⁻ A⁺  ◐       │
├────────────────────────────────────────────┴─────────────────┤
│  ✓ Saved 2 seconds ago                     Ananya Rao 21CS0147│
└──────────────────────────────────────────────────────────────┘
```

- The **palette** on the right is the whole test at a glance. Section 3 is locked because navigation is `per_section`.
- **Saved** is shown after every change; if the network drops it turns into *Offline — your answers are kept and will be sent when you reconnect*. Nothing is lost.
- The options are **shuffled per candidate** (127 is not always second), and so is the order of questions inside a section.
- A⁻ A⁺ and ◐ are the font-size and high-contrast controls, on every screen.
- The watermark with the candidate's name and roll number sits faintly over the question area.

### 3.3 How each question type is answered

| Type | Input |
| --- | --- |
| `single` | Radio buttons — one choice |
| `multiple` | Check boxes — any number |
| `select_k` | Check boxes that stop accepting picks after *k*, with "2 of 2 chosen" shown |
| `true_false` | Two large buttons |
| `assertion_reason` | Assertion and reason shown in boxes, then four fixed options |
| `matching` | A dropdown beside each left item, or drag the right items across; each right item can be used once |
| `multi_matching` | A grid of check boxes, left items as rows, right items as columns |
| `ordering` | Drag the items, or move them with ↑ / ↓ buttons and the keyboard |
| `fill_blank` | Boxes sitting inline in the sentence |
| `numeric` | A number box, with the unit printed beside it |
| `short_answer` | One-line box with a character counter |
| `long_answer` | Text area with a character counter; the rubric is **not** shown |

### 3.4 A violation

```
        ┌────────────────────────────────────────────────┐
        │  ⚠  You left the test window                   │
        │                                                │
        │  Leaving the test window is not allowed during │
        │  this test. Your clock kept running.           │
        │                                                │
        │  Warning 2 of 4.                               │
        │  Reaching 4 flags your attempt for review by   │
        │  the organiser.                                │
        │                                                │
        │              ┌───────────────────┐             │
        │              │  Back to the test │             │
        │              └───────────────────┘             │
        └────────────────────────────────────────────────┘
```

The event — when, and how long they were away — goes in the log either way. Pariksha **flags**; a person decides.

### 3.5 Submitting

```
        ┌────────────────────────────────────────────────┐
        │  Submit the test?                              │
        │                                                │
        │  Answered           10 of 12                   │
        │  Marked for review   2                         │
        │  Not answered        2                         │
        │                                                │
        │  You cannot reopen the test after submitting.  │
        │                                                │
        │   ┌──────────────┐   ┌──────────────────────┐  │
        │   │ Keep working │   │  Submit now          │  │
        │   └──────────────┘   └──────────────────────┘  │
        └────────────────────────────────────────────────┘
```

Afterwards the candidate gets a receipt — attempt reference and time — and **nothing about the score**, because this test releases results on 16 November. At 6:00 PM that day they can sign in with that reference and their email to see their total and the three section scores.

---

## 4. What comes out

### 4.1 Scoring, worked through

Ananya answered QNT-003 (pick exactly two primes, 2 points, `partial`) with **53 and 51**. One of her two picks is in the key, the other is not:

```
points × (correct parts − wrong parts) ÷ total parts
   2   × (     1        −      1      ) ÷      2        = 0
```

Never below zero. Had she picked 53 and 59 she would have scored 2; had she left it blank she would have scored 0 with no negative marking.

On LOG-006 (five words in dictionary order, 2 points, `position`) she placed three of the five correctly:

```
points × items in the right position ÷ items  =  2 × 3 ÷ 5 = 1.2
```

WRI-002 is marked by a person against the rubric in the question file — 0, 2, 4 or 5 points, with the levels described so two reviewers reach the same number.

### 4.2 The results file

[`results.csv`](results.csv), one row per candidate, UTF-8 with a BOM so Excel opens non-Latin names correctly:

| Column group | Columns |
| --- | --- |
| Registration | one per form field, named with the field's **label** — *Full name*, *College email address*, *CGPA so far*, … |
| Attempt | Set, Started at, Submitted at, Time taken, Submit reason (`manual`, `timeout`, `auto_submit`) |
| Score | Score, Max score, Percent, Rank, Result (Pass / Fail against the pass mark) |
| Sections | one column per section — *Quantitative aptitude*, *Logical reasoning*, … |
| Integrity | Tab switches, Fullscreen exits, Integrity flag (`clean` / `review` / `high_risk`) |
| Review | Reviewer verdict, Reviewer note, Review link |

```csv
Full name,...,Set,...,Score,Max score,Percent,Rank,Result,...,Integrity flag,Reviewer verdict,...
Fatima Sheikh,...,A,...,24.00,27,88.9,1,Pass,...,clean,,...
Ananya Rao,...,A,...,21.50,27,79.6,2,Pass,...,review,Clear,...
Divya Menon,...,A,...,9.50,27,35.2,6,Fail,...,high_risk,Suspicious,...
```

Divya's row shows the whole point of the design: the app recorded five tab switches and three fullscreen exits and marked the attempt `high_risk`. It did **not** cancel her result. A reviewer looked, wrote a note, and invited her to a supervised re-test.

You can also pull a per-answer CSV (every response, whether it was right, points, time spent), an events CSV, and the test itself as JSON.

---

## 5. Run this yourself

Validate both files against the schemas — the same command CI runs:

```bash
npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json \
  -d "examples/*/questions.json"

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/test-1.json -d "examples/*/test.json"
```

To build your own test from this one:

1. Copy this folder and rename it.
2. Replace the questions. Keep the `tags` you filter pools on, or change both.
3. Change `name`, `slug`, the times and the access code in `test.json`.
4. Rewrite the registration form to ask only for what you will actually use. Every extra field is personal data you then have to look after.
5. Rewrite the consent text to match what you kept.

The full field reference lives in [docs/test-format.md](../../docs/test-format.md) and [docs/question-format.md](../../docs/question-format.md).

---

Content in this folder is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Use it, change it, ship it with your own tests.
