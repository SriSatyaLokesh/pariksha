import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Landing } from "../../src/routes/landing";

describe("Landing Page Live Demo Entry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'Try Live Demo' action in hero and navigation", () => {
    render(<Landing />);
    const demoButtons = screen.getAllByRole("button", { name: /try.*demo/i });
    expect(demoButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("opens demo options dialog when 'Try Live Demo' is clicked", () => {
    render(<Landing />);
    const heroBtn = screen.getAllByRole("button", { name: /try.*demo/i })[0]!;
    fireEvent.click(heroBtn);

    expect(screen.getByRole("dialog", { name: /choose demo experience/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /take sample exam/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /explore organiser dashboard/i })).toBeInTheDocument();
  });

  it("links to /exam?demo=true for sample exam candidate test-drive", () => {
    render(<Landing />);
    const heroBtn = screen.getAllByRole("button", { name: /try.*demo/i })[0]!;
    fireEvent.click(heroBtn);

    const candidateLink = screen.getByRole("link", { name: /take sample exam/i });
    expect(candidateLink).toHaveAttribute("href", "/exam?demo=true");
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

    render(<Landing />);
    const heroBtn = screen.getAllByRole("button", { name: /try.*demo/i })[0]!;
    fireEvent.click(heroBtn);

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
