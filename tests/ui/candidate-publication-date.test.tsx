// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CandidateDiscoveryDetails } from "@/components/candidate-discovery-details";
import type { CandidateView } from "@/workbench/candidate-details";
it("displays the original news date in Shanghai rather than truncating its UTC timestamp", () => {
  const candidate: CandidateView = { id: "today", companyName: "新闻项目", track: "AI", investorNames: [], signalType: "funding", summary: "摘要", confidence: 0.9, status: "pending_review", version: 1, createdAt: "2026-09-04", projectId: null, lead: { title: "融资来源", url: "https://36kr.com/p/example", publishedAt: "2026-09-03T16:00:00.000Z" } };
  render(<CandidateDiscoveryDetails candidate={candidate} />);
  expect(screen.getByText("2026-09-04")).toBeVisible();
  expect(screen.queryByText("2026-09-03")).not.toBeInTheDocument();
});
