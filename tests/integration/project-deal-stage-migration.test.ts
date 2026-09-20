import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectDealStageMigration } from "@/db/project-deal-stage-migration";

describe("project deal stage migration", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,status TEXT NOT NULL,technology_stage TEXT NOT NULL)");
  });

  afterEach(() => database.close());

  it("backfills workflow stage without changing the imported technology stage", () => {
    database.prepare("INSERT INTO projects VALUES (?,?,?)").run("manual-label", "new", "内决会");
    database.prepare("INSERT INTO projects VALUES (?,?,?)").run("status-fallback", "dd", "客户验证");

    database.exec(projectDealStageMigration.upSql);

    expect(database.prepare("SELECT id,status,technology_stage,deal_stage FROM projects ORDER BY id").all()).toEqual([
      { id: "manual-label", status: "new", technology_stage: "内决会", deal_stage: "pre_ic" },
      { id: "status-fallback", status: "dd", technology_stage: "客户验证", deal_stage: "dd" },
    ]);
  });
});
