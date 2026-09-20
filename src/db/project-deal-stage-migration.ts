import type { DatabaseMigration } from "./migrations";

export const projectDealStageMigration: DatabaseMigration = {
  id: "0041_project_deal_stage",
  upSql: `
    ALTER TABLE projects ADD COLUMN deal_stage TEXT NOT NULL DEFAULT 'contact';
    UPDATE projects SET deal_stage = CASE
      WHEN technology_stage IN ('contact','接触') THEN 'contact'
      WHEN technology_stage IN ('initiation','立项') THEN 'initiation'
      WHEN technology_stage IN ('dd','尽调') THEN 'dd'
      WHEN technology_stage IN ('pre_ic','内决会') THEN 'pre_ic'
      WHEN technology_stage IN ('ic','投决会') THEN 'ic'
      WHEN technology_stage IN ('closing','签约交割','交割') THEN 'closing'
      WHEN technology_stage IN ('post','投后') THEN 'post'
      WHEN status='researching' THEN 'initiation'
      WHEN status='dd' THEN 'dd'
      WHEN status='ic' THEN 'ic'
      WHEN status='invested' THEN 'closing'
      WHEN status='exited' THEN 'post'
      ELSE 'contact'
    END;
  `,
  downSql: "ALTER TABLE projects DROP COLUMN deal_stage;",
};
