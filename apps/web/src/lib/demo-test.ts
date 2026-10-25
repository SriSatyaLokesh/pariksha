import type { AttemptPaper, CandidateQuestion, PaperSection } from "./paper.js";
import type { LandingPayload } from "./run.js";
import { PROCTORING_DEFAULTS, type Question } from "@pariksha/core";

export const DEMO_SECTION_1_QUESTIONS: CandidateQuestion[] = [
  {
    id: "demo_q1",
    type: "single",
    prompt: "Which data structure operates on a First-In-First-Out (FIFO) principle?",
    points: 2,
    options: [
      { id: "opt_a", text: "Stack" },
      { id: "opt_b", text: "Queue" },
      { id: "opt_c", text: "Binary Tree" },
      { id: "opt_d", text: "Hash Table" },
    ],
  },
  {
    id: "demo_q2",
    type: "multiple",
    prompt: "Select all protocols that operate at the Transport Layer of the OSI model:",
    points: 3,
    options: [
      { id: "opt_tcp", text: "TCP (Transmission Control Protocol)" },
      { id: "opt_udp", text: "UDP (User Datagram Protocol)" },
      { id: "opt_http", text: "HTTP (Hypertext Transfer Protocol)" },
      { id: "opt_ip", text: "IP (Internet Protocol)" },
    ],
  },
  {
    id: "demo_q3",
    type: "true_false",
    prompt: "In TypeScript, the `unknown` type is safer than `any` because operations on `unknown` require type narrowing.",
    points: 1,
    options: [
      { id: "true", text: "True" },
      { id: "false", text: "False" },
    ],
  },
  {
    id: "demo_q4",
    type: "fill_blank",
    prompt: "The standard port used for secure HTTPS connections is [[b1]].",
    points: 2,
    blanks: [{ id: "b1" }],
  },
];

export const DEMO_SECTION_2_QUESTIONS: CandidateQuestion[] = [
  {
    id: "demo_q5",
    type: "numeric",
    prompt: "If a binary search algorithm runs on an array of 1,024 elements, what is the maximum number of comparisons required in the worst case?",
    points: 2,
    unit: "comparisons",
  },
  {
    id: "demo_q6",
    type: "assertion_reason",
    prompt: "Evaluate the relationship between the assertion and the reason.",
    points: 2,
    assertion: "Relational databases use B-tree indices to accelerate point lookups and range queries.",
    reason: "B-trees maintain sorted order and guarantee logarithmic search, insertion, and deletion times.",
    options: [
      { id: "both_correct_reason", text: "Both assertion and reason are true, and the reason is the correct explanation of the assertion." },
      { id: "both_correct_not_reason", text: "Both assertion and reason are true, but the reason is NOT the correct explanation." },
      { id: "assertion_true_reason_false", text: "Assertion is true, but reason is false." },
      { id: "assertion_false_reason_true", text: "Assertion is false, but reason is true." },
      { id: "both_false", text: "Both assertion and reason are false." },
    ],
  },
  {
    id: "demo_q7",
    type: "matching",
    prompt: "Match each time complexity to its representative sorting algorithm (average case):",
    points: 3,
    left: ["Merge Sort", "Quick Sort", "Bubble Sort"],
    right: ["O(n log n)", "O(n log n)", "O(n^2)"],
  },
  {
    id: "demo_q8",
    type: "ordering",
    prompt: "Arrange the following software deployment stages in standard chronological order:",
    points: 2,
    items: ["Code Review", "Automated Testing", "Staging Verification", "Production Release"],
  },
];

export const DEMO_SECTION_3_QUESTIONS: CandidateQuestion[] = [
  {
    id: "demo_q9",
    type: "short_answer",
    prompt: "What is the term for the principle where an edge-computed function executes in response to events without running a persistent host server?",
    points: 3,
  },
  {
    id: "demo_q10",
    type: "select_k",
    prompt: "Select exactly 2 cloud services offered by Cloudflare:",
    points: 2,
    k: 2,
    options: [
      { id: "cf_workers", text: "Workers (Serverless Execution)" },
      { id: "cf_d1", text: "D1 (Serverless Relational SQL)" },
      { id: "aws_s3", text: "Amazon S3" },
      { id: "gcp_bigquery", text: "Google Cloud BigQuery" },
    ],
  },
  {
    id: "demo_q11",
    type: "multi_matching",
    prompt: "Associate database types with their primary persistence paradigm:",
    points: 3,
    left: ["PostgreSQL", "Redis", "Neo4j"],
    right: ["Relational (SQL)", "In-Memory Key-Value", "Graph Database"],
  },
  {
    id: "demo_q12",
    type: "long_answer",
    prompt: "Briefly explain why subrequest budgeting is critical in serverless edge worker environments.",
    points: 4,
  },
];

export const DEMO_PAPER_SECTIONS: PaperSection[] = [
  {
    id: "sec_core",
    title: "Section 1: Computer Science Fundamentals",
    instructions: "Answer all 4 questions. Standard multiple choice and fill in the blank.",
    timeLimitMinutes: 20,
    questions: DEMO_SECTION_1_QUESTIONS,
  },
  {
    id: "sec_algo",
    title: "Section 2: Algorithms & Quantitative Analysis",
    instructions: "Calculators and scratch work permitted. Review your numeric calculations.",
    timeLimitMinutes: 25,
    questions: DEMO_SECTION_2_QUESTIONS,
  },
  {
    id: "sec_cloud",
    title: "Section 3: Systems & Distributed Architecture",
    instructions: "Includes matching, short answers, and architectural conceptual questions.",
    timeLimitMinutes: 15,
    questions: DEMO_SECTION_3_QUESTIONS,
  },
];

export const DEMO_PAPER_FIXTURE: AttemptPaper = {
  attemptId: "att_demo_evaluator",
  sections: DEMO_PAPER_SECTIONS,
  responses: {},
  clientSeq: 0,
  navigation: "free",
  maxIndex: 0,
  remainingMs: 3_600_000,
  sectionRemainingMs: 1_200_000,
  warnAtMinutes: [5, 1],
  lateSyncGraceSeconds: 60,
  allowCalculator: true,
  serverNow: Date.now(),
  submittedAt: null,
  lockedAt: null,
  proctoring: {
    ...PROCTORING_DEFAULTS.off,
    allowCalculator: true,
  },
  violations: 0,
};

export const DEMO_LANDING_FIXTURE: LandingPayload = {
  name: "Pariksha Interactive Demo Exam",
  description: "Experience the candidate exam interface across multiple sections and all 12 question types with zero registration required.",
  durationMinutes: 60,
  questionCount: 12,
  sections: [
    { id: "sec_core", title: "Section 1: Computer Science Fundamentals", questionCount: 4, timeLimitMinutes: 20 },
    { id: "sec_algo", title: "Section 2: Algorithms & Quantitative Analysis", questionCount: 4, timeLimitMinutes: 25 },
    { id: "sec_cloud", title: "Section 3: Systems & Distributed Architecture", questionCount: 4, timeLimitMinutes: 15 },
  ],
  rules: "Calculators allowed. You may navigate freely between sections.",
  proctoring: {
    profile: "off",
    requirements: ["No proctoring active — public demonstration mode."],
  },
  accessMode: "link_code",
  state: "open",
  opensAt: null,
  closesAt: null,
  latestStartAt: null,
  timezone: "UTC",
  branding: {
    logo: null,
    logoAlt: null,
    primaryColour: "#2f6fd0",
    footerText: "Powered by Pariksha Open Source Examination Platform",
    startMessage: "Welcome to the Pariksha Public Demo! Take this sample test to evaluate candidate navigation and section breakdown.",
  },
  candidateList: false,
  serverNow: Date.now(),
};

/** Full question catalog with scoring keys for instant client-side grading. */
export const DEMO_QUESTIONS_CATALOG: Question[] = [
  {
    id: "demo_q1",
    type: "single",
    prompt: "Which data structure operates on a First-In-First-Out (FIFO) principle?",
    scoring: { points: 2 },
    tags: ["cs"],
    options: [
      { id: "opt_a", text: "Stack" },
      { id: "opt_b", text: "Queue" },
      { id: "opt_c", text: "Binary Tree" },
      { id: "opt_d", text: "Hash Table" },
    ],
    key: "opt_b",
  },
  {
    id: "demo_q2",
    type: "multiple",
    prompt: "Select all protocols that operate at the Transport Layer of the OSI model:",
    scoring: { points: 3 },
    tags: ["networking"],
    options: [
      { id: "opt_tcp", text: "TCP (Transmission Control Protocol)" },
      { id: "opt_udp", text: "UDP (User Datagram Protocol)" },
      { id: "opt_http", text: "HTTP (Hypertext Transfer Protocol)" },
      { id: "opt_ip", text: "IP (Internet Protocol)" },
    ],
    key: ["opt_tcp", "opt_udp"],
  },
  {
    id: "demo_q3",
    type: "true_false",
    prompt: "In TypeScript, the `unknown` type is safer than `any` because operations on `unknown` require type narrowing.",
    scoring: { points: 1 },
    tags: ["typescript"],
    key: true,
  },
  {
    id: "demo_q4",
    type: "fill_blank",
    prompt: "The standard port used for secure HTTPS connections is [[b1]].",
    scoring: { points: 1 },
    tags: ["web"],
    blanks: [{ id: "b1", accepted: ["443"], match: "exact" }],
  },
  {
    id: "demo_q5",
    type: "numeric",
    prompt: "If a binary search algorithm runs on an array of 1,024 elements, what is the maximum number of comparisons required in the worst case?",
    scoring: { points: 2 },
    tags: ["algorithms"],
    key: { value: 10, tolerance: 0 },
  },
  {
    id: "demo_q6",
    type: "assertion_reason",
    prompt: "Evaluate the relationship between the assertion and the reason.",
    scoring: { points: 2 },
    tags: ["databases"],
    assertion: "Relational databases use B-tree indices to accelerate point lookups and range queries.",
    reason: "B-trees maintain sorted order and guarantee logarithmic search, insertion, and deletion times.",
    key: "both_true_explains",
  },
  {
    id: "demo_q7",
    type: "matching",
    prompt: "Match each time complexity to its representative sorting algorithm (average case):",
    scoring: { points: 3 },
    tags: ["algorithms"],
    left: ["Merge Sort", "Quick Sort", "Bubble Sort"],
    right: ["O(n log n)", "O(n log n)", "O(n^2)"],
    key: {
      "Merge Sort": "O(n log n)",
      "Quick Sort": "O(n log n)",
      "Bubble Sort": "O(n^2)",
    },
  },
  {
    id: "demo_q8",
    type: "ordering",
    prompt: "Arrange the following software deployment stages in standard chronological order:",
    scoring: { points: 2 },
    tags: ["devops"],
    items: ["Code Review", "Automated Testing", "Staging Verification", "Production Release"],
  },
  {
    id: "demo_q9",
    type: "short_answer",
    prompt: "What is the term for the principle where an edge-computed function executes in response to events without running a persistent host server?",
    scoring: { points: 3 },
    tags: ["architecture"],
    model_answer: "serverless",
  },
  {
    id: "demo_q10",
    type: "select_k",
    prompt: "Select exactly 2 cloud services offered by Cloudflare:",
    scoring: { points: 2 },
    tags: ["cloud"],
    k: 2,
    options: [
      { id: "cf_workers", text: "Workers (Serverless Execution)" },
      { id: "cf_d1", text: "D1 (Serverless Relational SQL)" },
      { id: "aws_s3", text: "Amazon S3" },
      { id: "gcp_bigquery", text: "Google Cloud BigQuery" },
    ],
    key: ["cf_workers", "cf_d1"],
  },
  {
    id: "demo_q11",
    type: "multi_matching",
    prompt: "Associate database types with their primary persistence paradigm:",
    scoring: { points: 3 },
    tags: ["databases"],
    left: ["PostgreSQL", "Redis", "Neo4j"],
    right: ["Relational (SQL)", "In-Memory Key-Value", "Graph Database"],
    key: {
      PostgreSQL: ["Relational (SQL)"],
      Redis: ["In-Memory Key-Value"],
      Neo4j: ["Graph Database"],
    },
  },
  {
    id: "demo_q12",
    type: "long_answer",
    prompt: "Briefly explain why subrequest budgeting is critical in serverless edge worker environments.",
    scoring: { points: 4 },
    tags: ["edge"],
    rubric: [
      { level: "full", points: 2, description: "Mentions platform subrequest limits (e.g. 50 subrequests per invocation)" },
      { level: "partial", points: 2, description: "Explains prevention of cascade latency or denial of service" },
    ],
  },
];
