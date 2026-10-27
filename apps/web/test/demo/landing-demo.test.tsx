import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Landing } from "../../src/routes/landing";
import { DemoModal } from "../../src/components/demo/DemoModal";
import { DemoBanner } from "../../src/components/demo/DemoBanner";

describe("Landing Page Live Demo Entry", () => {
  it("renders 'Try Live Demo' link in hero pointing to /exam?demo=true", () => {
    render(<Landing />);
    const demoLink = screen.getByRole("link", { name: /try live demo/i });
    expect(demoLink).toBeInTheDocument();
    expect(demoLink).toHaveAttribute("href", "/exam?demo=true");
  });

  it("renders demo access code 'DEMO' prominently in landing hero", () => {
    render(<Landing />);
    const heroDemo = screen.getByRole("link", { name: /try live demo/i });
    expect(heroDemo).toBeInTheDocument();
    const codeBadge = screen.getByText(
      (_, el) => Boolean(el?.classList.contains("signal-badge-code") && /code:\s*DEMO/i.test(el.textContent || "")),
    );
    expect(codeBadge).toBeInTheDocument();
  });
});

describe("DemoModal Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders demo options dialog when open", () => {
    render(<DemoModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /choose demo experience/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /take sample exam/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /explore organiser dashboard/i })).toBeInTheDocument();
  });

  it("links to /exam?demo=true for sample exam candidate test-drive", () => {
    render(<DemoModal isOpen={true} onClose={() => {}} />);
    const candidateLink = screen.getByRole("link", { name: /take sample exam/i });
    expect(candidateLink).toHaveAttribute("href", "/exam?demo=true");
  });

  it("displays DEMO access code for candidate sample exam", () => {
    render(<DemoModal isOpen={true} onClose={() => {}} />);
    const codePill = screen.getByText(
      (_, el) => Boolean(el?.classList.contains("demo-code-pill") && /access code:\s*DEMO/i.test(el.textContent || "")),
    );
    expect(codePill).toBeInTheDocument();
  });

  it("provisions demo workspace when 'Explore Organiser Dashboard' is clicked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          workspace: { id: "wsp_demo_123", slug: "demo-showcase", isDemo: true },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const assignMock = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, assign: assignMock },
    });

    render(<DemoModal isOpen={true} onClose={() => {}} />);
    const exploreBtn = screen.getByRole("button", { name: /explore organiser dashboard/i });
    fireEvent.click(exploreBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/demo/provision",
        expect.objectContaining({ method: "POST" }),
      );
    });

    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });
});

describe("DemoBanner Component Access Code", () => {
  it("displays access code DEMO in exam mode", () => {
    render(<DemoBanner mode="exam" />);
    expect(screen.getByText(/access code:\s*DEMO/i)).toBeInTheDocument();
  });
});
