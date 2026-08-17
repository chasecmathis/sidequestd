import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

// No mocks for auth or navigation: the footer deliberately depends on neither,
// and this file failing to compile without them is the signal that it started to.

describe("SiteFooter", () => {
  it("links to the About, Privacy and Terms pages", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(within(footer).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  it("credits IGDB for the game data", () => {
    render(<SiteFooter />);

    expect(screen.getByText(/not affiliated with IGDB or Twitch/i)).toBeInTheDocument();

    const igdb = screen.getByRole("link", { name: "IGDB" });
    expect(igdb).toHaveAttribute("href", "https://www.igdb.com");
    // Leaving the app for a credit link should not lose the reader's place.
    expect(igdb).toHaveAttribute("target", "_blank");
    expect(igdb).toHaveAttribute("rel", "noreferrer");
  });

  it("shows the app version", () => {
    render(<SiteFooter />);

    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument();
  });

  it("omits links that a signed-out visitor cannot follow", () => {
    render(<SiteFooter />);

    // The footer renders identically for everyone, so "Write a review" — which
    // bounces to /login — must not be in it.
    expect(screen.queryByRole("link", { name: /write a review/i })).not.toBeInTheDocument();
  });
});
