// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectWorkspace } from "@/components/operating/project-workspace";

describe("ProjectWorkspace", () => {
  it("exposes all 12 project work areas through shareable URLs", () => {
    render(<ProjectWorkspace projectId="project-embodied-ai" projectName="灵巧智能" activeView="dd" />);

    expect(screen.getAllByRole("link")).toHaveLength(12);
    expect(screen.getByRole("link", { name: "尽职调查" }).getAttribute("href")).toBe("/projects/project-embodied-ai?view=dd");
    expect(screen.getByRole("link", { name: "尽职调查" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "尽职调查清单" })).toBeTruthy();
    expect(screen.getByText("演示数据")).toBeTruthy();
  });

  it("falls back to overview for an unsupported view", () => {
    render(<ProjectWorkspace projectId="project-embodied-ai" projectName="灵巧智能" activeView="unknown" />);

    expect(screen.getByRole("link", { name: "概览" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "项目工作区" })).toBeTruthy();
  });
});
