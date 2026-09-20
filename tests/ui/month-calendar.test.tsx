// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonthCalendar } from "@/components/operating/month-calendar";
import { defaultPrototypeState } from "@/prototype/fixtures";

describe("editorial month calendar", () => {
  it("places meetings and tasks on the correct Shanghai calendar day", () => {
    render(<MonthCalendar meetings={defaultPrototypeState.meetings} workItems={defaultPrototypeState.workItems} />);

    expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();
    const septemberThird = screen.getByLabelText("2026年9月3日");
    expect(within(septemberThird).getByText("灵巧智能创始人访谈")).toBeTruthy();
    expect(within(septemberThird).getByText("补齐具身机器人客户访谈")).toBeTruthy();
  });

  it("supports keyboard-accessible month navigation and reset", () => {
    render(<MonthCalendar meetings={defaultPrototypeState.meetings} workItems={defaultPrototypeState.workItems} />);

    fireEvent.click(screen.getByRole("button", { name: "下个月" }));
    expect(screen.getByRole("heading", { name: "2026年10月" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回本月" }));
    expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();
  });
});
