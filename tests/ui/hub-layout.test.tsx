// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HubHeader, SectionHeading } from "@/components/operating/hub-layout";

describe("workspace headings", () => {
  it("omits the subtitle beneath a page title", () => {
    render(<HubHeader eyebrow="Deal flow" title="项目中心" description="不应显示的页面副标题" />);

    expect(screen.getByRole("heading", { name: "项目中心" })).toBeTruthy();
    expect(screen.queryByText("不应显示的页面副标题")).toBeNull();
  });

  it("omits the subtitle beneath a section title", () => {
    render(<SectionHeading title="项目列表" description="不应显示的区块副标题" />);

    expect(screen.getByRole("heading", { name: "项目列表" })).toBeTruthy();
    expect(screen.queryByText("不应显示的区块副标题")).toBeNull();
  });
});
