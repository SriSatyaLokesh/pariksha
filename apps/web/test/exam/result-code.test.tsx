// `C-09`'s return visit, from the browser (#75, P6.11).
//
// A week after the test. The attempt cookie is gone, the candidate has
// their receipt and the address they registered with, and the only way
// back to their result is a code the server emails to that address.
//
// **Every assertion starts at `ExamApp` and clicks its way there**, from a
// browser with no attempt at all. `requestResultCode` and
// `verifyResultCode` shipped implemented and called from nowhere: a
// client method with no view is `C-09` reported done and not delivered,
// which is what this file exists to make impossible to do again.
//
// The release gate itself is the server's (`apps/api/test/run/result.test.ts`
// and `release.test.ts`). What is argued here is the browser's half of the
// same rule: it renders what it was handed, through the one `ResultView`
// the finish page uses, and it never says which half of the pair was
// wrong.

import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ExamApp } from "../../src/routes/exam";
import { RunError, type LandingPayload, type ReleasedResult, type RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
    fireEvent.click(element);
    await Promise.resolve();
  });
}

async function type(label: RegExp, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await Promise.resolve();
  });
}

/** The test has closed by the time a candidate comes back for a result,
 *  which is the state this screen is really reached in. */
const landing: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 7,
  sections: [{ id: "logic", title: "Logic", questionCount: 7, timeLimitMinutes: null }],
  rules: null,
  proctoring: { profile: "off", requirements: [] },
  accessMode: "link_code",
  state: "closed",
  opensAt: null,
  closesAt: NOW - 86_400_000,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: {
    logo: null,
    logoAlt: null,
    primaryColour: null,
    footerText: null,
    startMessage: null,
  },
  candidateList: false,
  serverNow: NOW,
};

const released: ReleasedResult = {
  show: "score_and_sections",
  total: 31,
  max: 40,
  percent: 77.5,
  passed: true,
  pending: [],
  sections: [{ sectionId: "logic", title: "Logic", points: 31, max: 40 }],
};

/** A browser with no attempt in it: `resume()` answers `null`, which is
 *  the ordinary first visit and the only state this screen is for. */
function client(overrides: Partial<RunClient> = {}): RunClient {
  return {
    landing: () => Promise.resolve(landing),
    resume: () => Promise.resolve(null),
    start: () => Promise.reject(new Error("nothing is started here")),
    access: () => Promise.reject(new Error("this screen passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("this screen sends no entry code")),
    form: () => Promise.reject(new Error("this screen reads no form")),
    register: () => Promise.reject(new Error("this screen registers nobody")),
    putAnswer: () => Promise.reject(new Error("nothing is saved here")),
    ...RESULT_STUB,
    ...overrides,
  };
}

/** The whole way in: land, press "See my result", give the pair. */
async function askForCode(runClient: RunClient, ref = "att_finish01", email = "ravi@example.com") {
  const view = render(<ExamApp client={runClient} />);
  await screen.findByRole("button", { name: /see my result/i });
  await click(screen.getByRole("button", { name: /see my result/i }));
  await type(/attempt reference/i, ref);
  await type(/email address/i, email);
  await click(screen.getByRole("button", { name: /email me a code/i }));
  return view;
}

afterEach(() => {
  localStorage.clear();
});

it("C-09: a reference, an address and the emailed code open the released result", async () => {
  const requestResultCode = vi.fn<RunClient["requestResultCode"]>(() => Promise.resolve());
  const verifyResultCode = vi.fn<RunClient["verifyResultCode"]>(() => Promise.resolve(released));
  await askForCode(client({ requestResultCode, verifyResultCode }));

  expect(requestResultCode).toHaveBeenCalledWith("att_finish01", "ravi@example.com");
  // Whitespace and a stray capital are a candidate reading their own
  // handwriting back; the code is salted with the address the server
  // normalises, so neither should cost them the result.
  await type(/code from your email/i, " 428913 ");
  await click(screen.getByRole("button", { name: /see my result/i }));

  expect(verifyResultCode).toHaveBeenCalledWith("att_finish01", "ravi@example.com", "428913");
  // The same `ResultView` the finish page renders, with exactly what the
  // server released and nothing it did not (`AC-16`).
  expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
  expect(screen.getByText(/out of 40/)).toBeVisible();
  const table = screen.getByRole("table");
  expect(within(table).getByText("Logic")).toBeVisible();
  expect(within(table).getByText("31")).toBeVisible();
  expect(screen.queryByText(/correct answer/i)).toBeNull();
});

// `B-1`: the counted figure `/result/verify` already sends must reach this
// screen too, not just the finish page — the same positive/negative
// control pair `receipt.test.tsx` runs for the finish page, driven through
// the real return-visit path instead of rendering `ResultView` directly.
it("B-1: a week later, the returning candidate sees the counted figure too, not just this attempt's", async () => {
  const withCounted: ReleasedResult = { ...released, counted: { percent: 81, attemptId: "att_2", of: 2 } };
  const verifyResultCode = vi.fn<RunClient["verifyResultCode"]>(() => Promise.resolve(withCounted));
  await askForCode(client({ requestResultCode: () => Promise.resolve(), verifyResultCode }));
  await type(/code from your email/i, "428913");
  await click(screen.getByRole("button", { name: /see my result/i }));

  await screen.findByRole("heading", { name: "Your result" });
  expect(screen.getByText(/This attempt: 77\.5%/)).toBeInTheDocument();
  expect(screen.getByText(/Counted for your result: 81%, your best of 2/)).toBeInTheDocument();
});

it("B-1: without a counted block, only this attempt's figure shows — the positive control's own negative", async () => {
  const verifyResultCode = vi.fn<RunClient["verifyResultCode"]>(() => Promise.resolve(released));
  await askForCode(client({ requestResultCode: () => Promise.resolve(), verifyResultCode }));
  await type(/code from your email/i, "428913");
  await click(screen.getByRole("button", { name: /see my result/i }));

  await screen.findByRole("heading", { name: "Your result" });
  expect(screen.getByText(/This attempt: 77\.5%/)).toBeInTheDocument();
  expect(screen.queryByText(/Counted for your result/)).toBeNull();
});

it("a test that releases nothing says so, rather than showing an empty score", async () => {
  await askForCode(client({ requestResultCode: () => Promise.resolve(), verifyResultCode: () => Promise.resolve(null) }));
  await type(/code from your email/i, "428913");
  await click(screen.getByRole("button", { name: /see my result/i }));

  expect(await screen.findByText(/results for this test are not shown here/i)).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Your result" })).toBeNull();
});

it("a wrong reference and a wrong address produce the very same sentence", async () => {
  // The server answers `202` to an unknown reference, to somebody else's
  // reference and to a right reference with the wrong address, and sends
  // nothing. A browser that narrowed that down — "we have no such
  // attempt", "that is not the address on it" — would undo the whole
  // point and say whether an address sat a test.
  const said = async (ref: string, email: string): Promise<string> => {
    const view = await askForCode(client({ requestResultCode: () => Promise.resolve() }), ref, email);
    const sentence = screen.getByRole("status").textContent ?? "";
    view.unmount();
    return sentence;
  };

  const real = await said("att_finish01", "ravi@example.com");
  const strangersReference = await said("att_nobody", "ravi@example.com");
  const wrongAddress = await said("att_finish01", "someone.else@example.com");

  expect(real).toMatch(/if that reference and address match/i);
  expect(strangersReference).toBe(real);
  expect(wrongAddress).toBe(real);
});

it("a spent or expired code is refused in the server's own words, and the candidate can try again", async () => {
  const verifyResultCode = vi
    .fn<RunClient["verifyResultCode"]>()
    .mockRejectedValueOnce(
      new RunError(410, "code_expired", "That code has been used or has expired. Ask for a new one."),
    )
    .mockResolvedValueOnce(released);
  await askForCode(client({ requestResultCode: () => Promise.resolve(), verifyResultCode }));
  await type(/code from your email/i, "000000");
  await click(screen.getByRole("button", { name: /see my result/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/used or has expired/i);
  // One sentence for unknown, lapsed, already spent, and minted against
  // another reference — and no hint of which.
  expect(screen.getByRole("alert")).not.toHaveTextContent(/reference|address|email/i);

  await type(/code from your email/i, "428913");
  await click(screen.getByRole("button", { name: /see my result/i }));
  expect(await screen.findByRole("heading", { name: "Your result" })).toBeVisible();
});

it("a half-filled form asks for both halves at once and sends nothing", async () => {
  const requestResultCode = vi.fn<RunClient["requestResultCode"]>(() => Promise.resolve());
  render(<ExamApp client={client({ requestResultCode })} />);
  await screen.findByRole("button", { name: /see my result/i });
  await click(screen.getByRole("button", { name: /see my result/i }));
  await type(/attempt reference/i, "att_finish01");
  await click(screen.getByRole("button", { name: /email me a code/i }));

  // Naming only the missing one would be the same leak by a shorter road
  // on the step that follows.
  expect(screen.getByRole("alert")).toHaveTextContent(
    /enter the reference from your receipt and the email address/i,
  );
  expect(requestResultCode).not.toHaveBeenCalled();
});

it("the candidate can go back to the test, and back out of a code they cannot use", async () => {
  await askForCode(client({ requestResultCode: () => Promise.resolve() }));
  await click(screen.getByRole("button", { name: /use a different reference/i }));
  expect(screen.getByLabelText(/attempt reference/i)).toBeVisible();

  await click(screen.getByRole("button", { name: /back to the test/i }));
  expect(await screen.findByRole("heading", { name: /aptitude/i })).toBeVisible();
});

it("the code step moves the keyboard to itself rather than leaving it on a button that is gone", async () => {
  await askForCode(client({ requestResultCode: () => Promise.resolve() }));
  expect(screen.getByRole("heading", { name: /enter the code/i })).toHaveFocus();
});

it("neither step has an axe violation", async () => {
  await askForCode(client({ requestResultCode: () => Promise.resolve(), verifyResultCode: () => Promise.resolve(released) }));
  expect(await axe(document.body)).toHaveNoViolations();

  await type(/code from your email/i, "428913");
  await click(screen.getByRole("button", { name: /see my result/i }));
  await screen.findByRole("heading", { name: "Your result" });
  expect(await axe(document.body)).toHaveNoViolations();
});
