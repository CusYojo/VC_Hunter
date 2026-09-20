// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyCockpit } from "@/components/daily-cockpit";
import { DEMO_PROJECTS } from "@/fixtures/demo-data";

const projects = DEMO_PROJECTS.map((project) => ({
  id: project.id,
  name: project.name,
  legalName: project.legalName,
  track: project.track,
  subtrack: project.subtrack,
  status: "new" as const,
  urgencyScore: project.urgency,
  qualityScore: project.quality,
  evidenceQuality: project.evidenceQuality,
  evidenceAuthority: project.source.authority,
  whyNow: project.whyNow,
  owner: null,
  signalType: project.signalType,
  eventAt: project.document.publishedAt,
  riskFlags: project.riskFlags,
}));

describe("DailyCockpit", () => {
  it("shows all seven demo signals and separates urgency from quality", () => {
    render(React.createElement(DailyCockpit, { projects }));

    expect(screen.getAllByTestId("signal-row")).toHaveLength(7);
    expect(screen.getAllByText("紧迫度").length).toBeGreaterThan(0);
    expect(screen.getAllByText("项目质量").length).toBeGreaterThan(0);
  });

  it("filters by track without overstating the source authority", () => {
    render(React.createElement(DailyCockpit, { projects }));
    fireEvent.change(screen.getByLabelText("筛选赛道"), { target: { value: "具身智能" } });

    expect(screen.getAllByTestId("signal-row")).toHaveLength(1);
    expect(screen.getByText("边界机器人（演示）")).toBeTruthy();
    expect(screen.getByText(/B 级证据/)).toBeTruthy();
  });
});
