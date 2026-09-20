// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Link from "next/link";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("does not attach native button attributes when rendered as an anchor", () => {
    render(<Button render={<Link href="/projects" />}>查看项目</Button>);

    const link = screen.getByText("查看项目").closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("type")).toBeNull();
  });
});
