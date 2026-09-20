export const newsPublicationMigration = {
  id: "0030_news_publication_verification",
  upSql: "ALTER TABLE web_search_leads ADD COLUMN publication_verified_at TEXT;",
  downSql: "ALTER TABLE web_search_leads DROP COLUMN publication_verified_at;",
};
