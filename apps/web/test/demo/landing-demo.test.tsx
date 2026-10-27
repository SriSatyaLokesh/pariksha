import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Landing } from "../../src/routes/landing";
import { DemoModal } from "../../src/components/demo/DemoModal";
import { DemoBanner } from "../../src/components/demo/DemoBanner";

describe("Landing Page Live Demo Entry", () => {
  it("renders 'Try Live Demo' links in nav and hero pointing to /exam?demo=true", () => {
    render(<Landing />);
    const demoLinks = screen.getAllByRole("link", { name: /try live demo/i });
    expect(demoLinks.length).toBeGreaterThanOrEqual(2);
    demoLinks.forEach((link) => {
      expect(link).toHaveAttribute("href", "/exam?demo=true");
    });
  });

  it("highlights 'Try Live Demo' on the primary navigation bar", () => {
    render(<Landing />);
    const nav = screen.getByRole("banner");
    const navDemos = screen.getAllByRole("link", { name: /try live demo/i });
    const navDemo = navDemos[0];
    expect(navDemo).toBeDefined();
    if (!navDemo) throw new Error("navDemo not found");
    expect(navDemo).toBeInTheDocument();
    expect(nav.contains(navDemo)).toBe(true);
    expect(navDemo).toHaveClass("signal-btn");
  });

  it("does not render inline code badge or 'See a real exam' on landing page", () => {
    const { container } = render(<Landing />);
    expect(container.querySelector(".signal-badge-code")).toBeNull();
    expect(screen.queryByRole("link", { name: /see a real exam/i })).toBeNull();
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
  it("displays access code DEMO in bold in exam mode", () => {
    render(<DemoBanner mode="exam" />);
    const bannerText = screen.getByText(
      (_, el) => Boolean(el?.classList.contains("demo-banner-text") && /access code:\s*DEMO/i.test(el.textContent || "")),
    );
    expect(bannerText).toBeInTheDocument();
    expect(screen.getByText("DEMO").tagName.toLowerCase()).toMatch(/^(strong|b)$/);
  });
});
