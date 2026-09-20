import { expect, test } from "@playwright/test";

const observedAt = "2026-09-14T08:00:00.000+08:00";
const evidence = (ref: string, suffix: string) => ({ ref, title: `端到端来源 ${suffix}`, url: `https://example.com/e2e/${suffix}`, publishedAt: "2026-09-13T08:00:00.000+08:00", observedAt, excerpt: `端到端公开来源披露 ${suffix} 的最新信号。`, authority: "B", accessClass: "public", collectionMethod: "codex", allowExternalModel: true });
const base = { candidateKind: "new_entity", eventDate: "2026-09-13", channel: "manual_codex", investmentHighlights: ["公开信号明确，值得进入人工复核"], openQuestions: ["核心事实能否由第二个独立来源交叉验证？"], scores: { technology: 3, team: 3, commercial: 2, signal: 4, evidence: 4 }, relationships: [], contacts: [] };

test("administrator previews a mixed intelligence bundle and reviews company, person, and technology", async ({ page }) => {
  const items = [
    { ...base, externalId: "e2e-company", entityType: "company", name: "端到端星云材料", track: "新材料", subtrack: "高温复合材料", city: "苏州", signalType: "funding", discoveryReason: "官网披露融资与客户验证。", investmentSummary: "端到端星云材料面向商业航天热防护开发高温复合材料，公开公告显示其完成融资并启动客户验证。投资亮点是产品验证场景明确；关键待核问题是量产良率、订单转化和知识产权边界，需要补充客户、专利及工商来源交叉确认。", evidence: [evidence("company-source", "company")], assertions: [{ field: "products", label: "产品", valueStatus: "known", epistemicType: "fact", value: ["高温复合材料"], confidence: 0.85, evidenceRefs: ["company-source"] }], company: { officialWebsite: "https://example.com/e2e-company", products: ["高温复合材料"], coreTechnologies: [], competitors: [], researchLocations: ["苏州"], fundingHistory: [], mergersAndAcquisitions: [] } },
    { ...base, externalId: "e2e-person", entityType: "person", name: "端到端研究员", track: "AI", subtrack: "多模态", city: "北京", signalType: "award", discoveryReason: "公开榜单披露青年人才入选信息。", investmentSummary: "端到端研究员具备多模态模型研究和产业研发经历，近期进入公开技术人才榜单。投资相关亮点是技术方向与产业需求衔接紧密；关键待核问题是当前创业意向、成果权属和代表论文影响力，需要结合机构主页、论文库及公开访谈进一步核验。", evidence: [evidence("person-source", "person")], assertions: [{ field: "education", label: "教育", valueStatus: "known", epistemicType: "fact", value: ["示例大学博士"], confidence: 0.8, evidenceRefs: ["person-source"] }], person: { organization: "端到端实验室", title: "研究员", education: ["示例大学博士"], employment: [], technicalBackground: "多模态模型", publications: [], patents: [], reports: [] } },
    { ...base, externalId: "e2e-technology", entityType: "technology", name: "端到端片上光互连", track: "半导体", subtrack: "硅光", city: "上海", signalType: "technology_breakthrough", discoveryReason: "公开论文披露工程原型。", investmentSummary: "端到端片上光互连面向高带宽低功耗芯片间通信，公开论文披露工程原型。投资亮点是有机会改善算力系统互连瓶颈；关键待核问题是指标复现、封装良率、量产成本和知识产权归属，需要继续核对论文、专利和产业验证材料。", evidence: [evidence("technology-source", "technology")], assertions: [{ field: "definition", label: "定义", valueStatus: "known", epistemicType: "fact", value: "利用硅光器件完成芯片间高速互连", confidence: 0.9, evidenceRefs: ["technology-source"] }], technology: { normalizedName: "片上光互连", definition: "利用硅光器件完成芯片间高速互连。", maturity: "engineering_validation", keyMetrics: ["带宽密度"], papers: [], patents: [], alternatives: ["电互连"], competitors: [] } },
  ];
  const bundle = { schemaVersion: "1.0", batch: { id: `e2e-${Date.now()}`, createdAt: observedAt, createdBy: "Playwright", accessClass: "public" }, items };

  await page.goto("/projects?view=discovery");
  await page.getByLabel("上传 Codex 数据包").setInputFiles({ name: "intelligence-e2e.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.getByText("预检完成：3 条可导入")).toBeVisible();
  await expect(page.getByRole("region", { name: "数据包预检差异" })).toContainText("无字段错误");
  await page.getByRole("button", { name: "确认写入待审队列" }).click();
  await expect(page.getByText("3 条已进入待审队列")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "近一周" }).click();
  for (const name of ["端到端星云材料", "端到端研究员", "端到端片上光互连"]) {
    await page.getByRole("button", { name: `入库${name}` }).click();
    const dialog = page.getByRole("dialog", { name: `审核入库：${name}` });
    await dialog.getByLabel("审核意见").fill("来源与主体信息已人工确认。");
    await dialog.getByRole("button", { name: "确认入库" }).click();
    await expect(page.getByText("已入库", { exact: true }).last()).toBeVisible();
  }

  await page.goto("/research?view=technology");
  await expect(page.getByText("端到端片上光互连", { exact: true })).toBeVisible();
  await page.goto("/resources?view=people");
  await expect(page.getByText("端到端研究员", { exact: true })).toBeVisible();
});

test("project discovery remains usable on a mobile viewport", async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/projects?view=discovery");
    await expect(page.getByRole("tab", { name: "项目发现" })).toBeVisible();
    await expect(page.getByRole("region", { name: "待查看项目列表" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "重点新项目" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "统一情报队列" })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});
