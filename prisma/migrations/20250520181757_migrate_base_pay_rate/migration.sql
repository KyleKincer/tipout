-- Add basePayRate column to RoleConfig
ALTER TABLE "RoleConfig" ADD COLUMN "basePayRate" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Data Migration
-- Step 2.1: Ensure all roles have at least one RoleConfig entry for the migration.
-- Create a temporary holding table for Role basePayRates to avoid issues with the column being dropped later.
CREATE TEMPORARY TABLE "RoleBaseRates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "basePayRate" DECIMAL(65,30) NOT NULL
);

INSERT INTO "RoleBaseRates" ("id", "basePayRate")
SELECT "id", "basePayRate" FROM "Role";

-- Step 2.2: For Roles that DO NOT have any RoleConfig entries, create a default one.
-- This ensures every role has a RoleConfig to store the migrated basePayRate.
-- Make sure uuid-ossp extension is enabled or replace uuid_generate_v4() with an alternative if necessary.
INSERT INTO "RoleConfig" ("id", "roleId", "tipoutType", "effectiveFrom", "basePayRate", "percentageRate", "receivesTipout", "paysTipout")
SELECT
    uuid_generate_v4(), -- Generate a new UUID for the RoleConfig id
    r."id",
    'BASE_PAY_RATE_MIGRATION', -- Special type to denote this was a migrated record
    '1970-01-01T00:00:00.000Z', -- Default early effective date
    COALESCE(rbr."basePayRate", 0), -- Use the rate from the temp table, default to 0 if somehow not found
    0,    -- Default percentageRate
    false, -- Default receivesTipout
    false  -- Default paysTipout (assuming base rate config doesn't imply tip payment)
FROM "Role" r
LEFT JOIN "RoleBaseRates" rbr ON r."id" = rbr."id"
WHERE NOT EXISTS (SELECT 1 FROM "RoleConfig" rc WHERE rc."roleId" = r."id");

-- Step 2.3: For Roles that DO have existing RoleConfig entries, update their basePayRate.
-- This will update ALL existing configs for a role with that role's basePayRate.
-- This assumes that if multiple configs exist, they should all reflect the (now former) single basePayRate of the parent Role.
UPDATE "RoleConfig"
SET "basePayRate" = COALESCE(rbr."basePayRate", 0)
FROM "Role" r
JOIN "RoleBaseRates" rbr ON r."id" = rbr."id"
WHERE "RoleConfig"."roleId" = r."id";

-- Drop basePayRate column from Role
ALTER TABLE "Role" DROP COLUMN "basePayRate";

-- Clean up temporary table
DROP TABLE "RoleBaseRates";
