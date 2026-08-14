import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationErrorBoundary } from "./ErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows a safe application fallback for a root render failure", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  render(
    <ApplicationErrorBoundary>
      <BrokenApplication />
    </ApplicationErrorBoundary>,
  );

  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("heading", { name: "The application could not load" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload application" })).toBeVisible();
  expect(screen.queryByText("private failure details")).not.toBeInTheDocument();
});

function BrokenApplication(): never {
  throw new Error("private failure details");
}
