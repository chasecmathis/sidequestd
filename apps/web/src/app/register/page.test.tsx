import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

import RegisterPage from "./page";

const push = vi.fn();
const register = vi.fn();

// The shells render a theme control, which the root layout provides for in the
// real app. Stubbed rather than wrapped, matching how auth and notifications are
// handled just below; `importActual` keeps the module's constants real so a
// renamed export still breaks loudly.
vi.mock("@/lib/theme", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/theme")>()),
  useTheme: () => ({ theme: "system" as const, resolved: "dark" as const, setTheme: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ register }),
}));

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Username"), "ripley");
  await userEvent.type(screen.getByLabelText("Email"), "ripley@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery-staple");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("RegisterPage", () => {
  it("submits the form and sends the user to Home", async () => {
    register.mockResolvedValue(undefined);
    render(<RegisterPage />);

    await fillAndSubmit();

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        username: "ripley",
        email: "ripley@example.com",
        password: "correct-horse-battery-staple",
        displayName: "",
      }),
    );
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("attaches a uniqueness conflict to the field that caused it", async () => {
    register.mockRejectedValue(new ApiError("That username is already taken.", 409, "username"));
    render(<RegisterPage />);

    await fillAndSubmit();

    const input = await screen.findByLabelText("Username");
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("That username is already taken.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a form-level error when the failure names no field", async () => {
    register.mockRejectedValue(new ApiError("Can't reach the server. Is the API running?", 0));
    render(<RegisterPage />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
