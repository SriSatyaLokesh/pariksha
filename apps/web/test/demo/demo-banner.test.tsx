import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DemoBanner } from "../../src/components/demo/DemoBanner";

describe("DemoBanner Component", () => {
  it("renders exam mode notice and exit button", () => {
    const onExit = vi.fn();
    render(<DemoBanner mode="exam" onExit={onExit} />);

    expect(screen.getByRole("region", { name: /demo mode/i })).toBeInTheDocument();
    expect(screen.getByText(/public demo/i)).toBeInTheDocument();
    expect(screen.getByText(/no cloudflare subrequests/i)).toBeInTheDocument();

    const exitBtn = screen.getByRole("button", { name: /exit demo/i });
    fireEvent.click(exitBtn);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("renders organiser mode with expiry timer and deploy link", () => {
    render(<DemoBanner mode="organiser" expiresInMs={45 * 60_000} />);

    expect(screen.getByRole("region", { name: /demo mode/i })).toBeInTheDocument();
    expect(screen.getByText(/ephemeral workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/resets in ~45m/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /deploy your own/i })).toBeInTheDocument();
  });
});
