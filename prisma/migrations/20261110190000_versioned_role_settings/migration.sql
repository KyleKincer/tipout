-- Role settings become dated versions, plus pay period locks and a change log.
-- Additive only: the legacy RoleConfig table and Role.basePayRate are left in place, untouched.
-- Run scripts/backfill-role-versions.ts after this to copy the legacy settings into RoleVersion.

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "RoleVersion" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "basePayRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tipPoolGroup" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "RoleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleVersionTipout" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "tipoutType" TEXT NOT NULL,
    "percentageRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paysTipout" BOOLEAN NOT NULL DEFAULT false,
    "receivesTipout" BOOLEAN NOT NULL DEFAULT false,
    "distributionGroup" TEXT,

    CONSTRAINT "RoleVersionTipout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleVersion_roleId_idx" ON "RoleVersion"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleVersion_roleId_effectiveFrom_key" ON "RoleVersion"("roleId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "RoleVersionTipout_versionId_tipoutType_key" ON "RoleVersionTipout"("versionId", "tipoutType");

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_startDate_key" ON "PayPeriod"("startDate");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "RoleVersion" ADD CONSTRAINT "RoleVersion_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleVersionTipout" ADD CONSTRAINT "RoleVersionTipout_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RoleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A version must cover at least one day, and a pay period must end on or after it starts.
ALTER TABLE "RoleVersion" ADD CONSTRAINT "RoleVersion_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_dates_check" CHECK ("endDate" >= "startDate");
