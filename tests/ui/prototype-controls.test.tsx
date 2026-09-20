// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PrototypeControls } from "@/components/operating/prototype-controls";
import { dispatchPrototype } from "@/prototype/store";

describe("PrototypeControls", () => {
  beforeEach(() => {
    localStorage.clear();
    dispatchPrototype({ type: "prototype.reset" });
  });

  it("restores the default persona without implying real data deletion", () => {
    dispatchPrototype({ type: "persona.select", persona: "finance" });
    render(<PrototypeControls />);
    fireEvent.click(screen.getByRole("button", { name: "重置演示数据" }));

    expect(screen.getByRole("status").textContent).toContain("演示数据已恢复");
    expect(screen.getByText(/真实 API 与数据库内容不受影响/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("vc-hunter:prototype:v1") ?? "{}").persona).toBe("investment_manager");
  });
});
