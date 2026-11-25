import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { APP_NAME } from "@/lib/koperca-brand";
import { HubMark, HubWordmark, loadHostedMark, preloadHostedMark } from "./hub-mark";

describe("Koperca brand seam", () => {
  it("draws the geometric hub mark through the upstream state contract", () => {
    const { container } = render(<HubMark state="applying" title={APP_NAME} />);
    const mark = screen.getByRole("img", { name: APP_NAME });
    expect(mark).toHaveAttribute("data-mark", "koperca-hub");
    expect(mark).toHaveAttribute("data-state", "applying");
    expect(mark).toHaveAttribute("data-bead");
    expect(container.querySelector(".kh-k")).not.toBeNull();
    expect(container.querySelectorAll(".kh-node")).toHaveLength(8);
  });

  it("publishes the full product name without the upstream wordmark", () => {
    render(<HubWordmark />);
    const wordmark = screen.getByRole("img", { name: APP_NAME });
    expect(wordmark).toHaveTextContent("Koperca");
    expect(wordmark).toHaveTextContent("Agent Hub");
    expect(wordmark).not.toHaveTextContent("Collie");
  });

  it("maps every legacy dog preference to the hosted mark without loading a dog component", async () => {
    for (const id of ["collie", "collie-collar", "collie-blaze"] as const) {
      await expect(loadHostedMark(id)).resolves.toBe(HubMark);
      await expect(preloadHostedMark(id)).resolves.toBeUndefined();
    }
  });
});

