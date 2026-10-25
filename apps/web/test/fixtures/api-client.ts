// Task 0 (#228): the one shared `ApiClient` test fixture. 26 files under
// apps/web/test used to each hand-roll this object; one `ApiClient` change
// broke all of them at once, in four different ways in a single day
// (2026-10-23). This is the only place that pays the tax now.
//
// Every member defaults to a thrower rather than reflecting over the
// interface with a Proxy: a Proxy would also silently satisfy a member that
// no longer exists on `ApiClient`, which is the exact failure this fixture
// exists to end. Writing the members out means a compile error the moment
// `ApiClient` gains or loses one.
import type { ApiClient } from "../../src/lib/api";

function notStubbed(name: string): () => never {
  return () => {
    throw new Error(`not stubbed: ${name}`);
  };
}

/** Every member throws "not stubbed: <name>" unless overridden, so a test
 *  that reaches an unexpected call fails loudly instead of on `undefined`. */
export function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: notStubbed("setupStatus"),
    me: notStubbed("me"),
    workspaces: notStubbed("workspaces"),
    completeSetup: notStubbed("completeSetup"),
    requestMagicLink: notStubbed("requestMagicLink"),
    signOut: notStubbed("signOut"),

    listBanks: notStubbed("listBanks"),
    createBank: notStubbed("createBank"),
    listQuestions: notStubbed("listQuestions"),
    deleteQuestion: notStubbed("deleteQuestion"),
    saveQuestion: notStubbed("saveQuestion"),
    regradeQuestion: notStubbed("regradeQuestion"),
    listTags: notStubbed("listTags"),

    listGroups: notStubbed("listGroups"),
    createGroup: notStubbed("createGroup"),
    updateGroup: notStubbed("updateGroup"),
    deleteGroup: notStubbed("deleteGroup"),

    importBank: notStubbed("importBank"),
    exportBank: notStubbed("exportBank"),
    exportQuestion: notStubbed("exportQuestion"),

    tests: notStubbed("tests"),
    createTest: notStubbed("createTest"),
    test: notStubbed("test"),
    updateTest: notStubbed("updateTest"),

    draft: notStubbed("draft"),
    patchDraft: notStubbed("patchDraft"),

    publishTest: notStubbed("publishTest"),
    closeTest: notStubbed("closeTest"),
    archiveTest: notStubbed("archiveTest"),
    versions: notStubbed("versions"),
    checklist: notStubbed("checklist"),
    readiness: notStubbed("readiness"),

    cloneTest: notStubbed("cloneTest"),
    exportTest: notStubbed("exportTest"),
    importTest: notStubbed("importTest"),

    checkUrl: notStubbed("checkUrl"),

    workspaceBranding: notStubbed("workspaceBranding"),
    saveWorkspaceBranding: notStubbed("saveWorkspaceBranding"),
    uploadMedia: notStubbed("uploadMedia"),

    candidates: notStubbed("candidates"),
    importCandidates: notStubbed("importCandidates"),

    lockedAttempts: notStubbed("lockedAttempts"),
    unlockAttempt: notStubbed("unlockAttempt"),
    getMonitor: notStubbed("getMonitor"),
    performProctorAction: notStubbed("performProctorAction"),
    gradingQueue: notStubbed("gradingQueue"),
    grade: notStubbed("grade"),
    recordVerdict: notStubbed("recordVerdict"),
    analytics: notStubbed("analytics"),
    exportPage: notStubbed("exportPage"),

    exportCandidateData: notStubbed("exportCandidateData"),
    deleteCandidateData: notStubbed("deleteCandidateData"),

    usage: notStubbed("usage"),

    listWebhooks: notStubbed("listWebhooks"),
    createWebhook: notStubbed("createWebhook"),
    setWebhookActive: notStubbed("setWebhookActive"),
    deleteWebhook: notStubbed("deleteWebhook"),

    listApiKeys: notStubbed("listApiKeys"),
    createApiKey: notStubbed("createApiKey"),
    revokeApiKey: notStubbed("revokeApiKey"),

    ...overrides,
  };
}
