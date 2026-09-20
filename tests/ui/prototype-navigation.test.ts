import { describe, expect, it } from "vitest";
import {
  demoPersonas,
  getDesktopNavigation,
  getMobileNavigation,
  getProjectsView,
  isDemoActionVisible,
  getWorkspaceNavigation,
} from "@/prototype/navigation";

describe("prototype navigation", () => {
  it("shows organization to members and administration only with an explicit real capability", () => {
    expect(getWorkspaceNavigation().map((item) => item.href)).toContain("/organization");
    expect(getWorkspaceNavigation().map((item) => item.href)).not.toContain("/admin");
    expect(getWorkspaceNavigation(true).map((item) => item.href)).toContain("/admin");
  });
  it("separates institutions and discovery in the authenticated workspace", () => {
    const navigation = getWorkspaceNavigation();
    expect(navigation.map((item) => item.label)).toContain("机构追踪");
    expect(navigation.map((item) => item.label)).toContain("新项目发现");
    for (const href of ["/finance", "/funds", "/ai", "/settings", "/research", "/resources"]) expect(navigation.map((item) => item.href)).toContain(href);
  });
  it("defines every PRD demo persona and keeps investment manager as the default", () => {
    expect(demoPersonas).toHaveLength(10);
    expect(demoPersonas.find((persona) => persona.isDefault)?.id).toBe("investment_manager");
  });

  it("prioritizes work by persona without hiding shared business centers", () => {
    const investmentNavigation = getDesktopNavigation("investment_manager");
    const financeNavigation = getDesktopNavigation("finance");

    expect(investmentNavigation.map((item) => item.href)).toContain("/projects");
    expect(investmentNavigation.map((item) => item.href)).toContain("/finance");
    expect(investmentNavigation[1]?.href).toBe("/projects");
    expect(financeNavigation[1]?.href).toBe("/finance");
  });

  it("limits mobile navigation to the five agreed top-level destinations", () => {
    expect(getMobileNavigation().map((item) => item.href)).toEqual([
      "/",
      "/projects",
      "/work",
      "/approvals",
      "/more",
    ]);
  });

  it("normalizes project views to the two rebuilt modules", () => {
    expect(getProjectsView("discovery")).toBe("discovery");
    expect(getProjectsView("pipeline")).toBe("manage");
    expect(getProjectsView("unknown")).toBe("manage");
    expect(getProjectsView(null)).toBe("manage");
  });

  it("changes demo actions without implying server-side permission elevation", () => {
    expect(isDemoActionVisible("partner", "approve_investment")).toBe(true);
    expect(isDemoActionVisible("viewer", "approve_investment")).toBe(false);
    expect(isDemoActionVisible("external_advisor", "edit_project")).toBe(false);
  });
});
