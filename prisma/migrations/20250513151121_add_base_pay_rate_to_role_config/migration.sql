-- Applied to production on 2025-05-13 from an unmerged branch; recorded here so the migration
-- history matches the database. The column is unused (all values are null).
ALTER TABLE "RoleConfig" ADD COLUMN "basePayRate" DECIMAL(65,30);
