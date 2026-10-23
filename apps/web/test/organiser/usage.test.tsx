// Phase 8e Task 3 (`K31`, `K36`, `KG8`, #102): `UsagePanel`'s own
// behaviour. `KG8` here is the web half of "nothing reaches a `node`
// deployment" — `undefined` is the shape the API route answers with on
// `node` (`apps/api/test/usage/project.test.ts` proves that half), and this
// file proves the component renders nothing for it, with its positive
// control in the same file.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import { UsagePanel } from "../../src/components/organiser/UsagePanel";
import type { UsageProjection } from "../../src/lib/api";

const projection: UsageProjection = {
  spentToday: 12_400,
  projected: 40_000,
  limit: 100_000,
  warn: false,
  estimated: true,
};

it("renders no usage element when the payload carries none", () => {
  render(<UsagePanel usage={undefined} />);
  expect(screen.queryByText(/of your daily limit/)).toBeNull();
});

it("renders one when it does — control", () => {
  render(<UsagePanel usage={projection} />);
  expect(screen.getByText(/of your daily limit/)).toBeInTheDocument();
});

describe("the word 'estimated' is on the surface (K31)", () => {
  it("says so in the sentence itself, not only a tooltip", () => {
    render(<UsagePanel usage={projection} />);
    expect(screen.getByText(/estimated/)).toBeInTheDocument();
  });
});

describe("the warn state (WARN_AT)", () => {
  it("says the ceiling is near when the server says warn, in words as well as colour", () => {
    render(<UsagePanel usage={{ ...projection, warn: true }} />);
    expect(screen.getByText(/approaching the free-plan ceiling/)).toBeInTheDocument();
  });

  it("says nothing of the sort when the server does not", () => {
    render(<UsagePanel usage={projection} />);
    expect(screen.queryByText(/approaching the free-plan ceiling/)).toBeNull();
  });
});

describe("accessible", () => {
  it("has no axe violations, warn state included", async () => {
    const { container } = render(<UsagePanel usage={{ ...projection, warn: true }} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
