import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithData } from "@/test/render";

import { DeletePrinting } from "./delete-printing";

describe("DeletePrinting", () => {
  it("deletes the typed Artwork's Printing in the chosen language", () => {
    const onDelete = vi.fn();
    renderWithData(<DeletePrinting onDelete={onDelete} />);

    fireEvent.change(screen.getByLabelText("Variant ID"), { target: { value: " OP09-001_p1 " } });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "ko" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Printing" }));

    expect(onDelete).toHaveBeenCalledWith("OP09-001_p1", "ko");
  });

  it("offers only Simplified Chinese and Korean, and needs a variant ID", () => {
    const onDelete = vi.fn();
    renderWithData(<DeletePrinting onDelete={onDelete} />);

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Simplified Chinese", "Korean"]);
    expect(screen.getByRole("button", { name: "Delete Printing" })).toBeDisabled();
  });
});
