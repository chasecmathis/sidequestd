import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PrivacyPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/privacy",
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    authedRequest: vi.fn(),
    user: null,
    isLoading: false,
    logout: vi.fn(),
    syncUser: vi.fn(),
  }),
}));

vi.mock("@/lib/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

/**
 * Smoke tests, on purpose.
 *
 * Asserting on policy wording would mean editing this file every time a sentence
 * is tuned, and a test that is always in the way of an edit gets deleted rather
 * than maintained. The claims worth pinning are that the document renders at
 * all, and that the metadata section still says what the pipeline actually does
 * — that one is a promise to users, and the API is free to break it from a file
 * nobody would think to read this page alongside.
 */
describe("PrivacyPage", () => {
  it("renders the policy", () => {
    render(<PrivacyPage />);

    expect(screen.getByRole("heading", { name: "Privacy policy", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/^Last updated /)).toBeInTheDocument();
  });

  it("states that camera metadata is stripped before storage", () => {
    render(<PrivacyPage />);

    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { name: /camera metadata/i })).toBeInTheDocument();
    // Backed by `strip_metadata` on both upload paths in the API
    // (apps/api/app/services/media.py, covered by test_media_pipeline.py). If
    // that ever stops running, this promise becomes false and has to be rewritten
    // — which is the whole reason it is asserted here rather than left to drift.
    expect(main.getByText(/removes all of it before your file is stored/i)).toBeInTheDocument();
  });

  it("says how to get an account deleted", () => {
    render(<PrivacyPage />);

    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { name: "Deleting your account" })).toBeInTheDocument();
    expect(main.getAllByRole("link", { name: "hello@sidequestd.app" }).length).toBeGreaterThan(0);
  });

  it("states that personal information is not sold or shared", () => {
    render(<PrivacyPage />);

    // "Sell" and "share" are the CCPA/CPRA terms of art, not loose synonyms —
    // a reader (or a regulator) looking for this claim looks for those words.
    const main = within(screen.getByRole("main"));
    expect(
      main.getByText(/does not sell your personal information, and does not share it/i),
    ).toBeInTheDocument();
  });

  it("names no infrastructure vendors", () => {
    const { container } = render(<PrivacyPage />);

    // The policy discloses the *categories* of provider that handle your data,
    // which is what the disclosure obligations ask for, but deliberately not
    // which companies they are — that is reconnaissance for whoever is probing
    // the service and of no use to a reader. Easy to undo by accident while
    // making the section more specific, so it is asserted rather than trusted.
    expect(container.textContent).not.toMatch(/fly\.io|amazon|aws|\bs3\b|smtp|postgres/i);
  });
});
