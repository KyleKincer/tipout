/*
  Warnings:

  - You are about to drop the column `barTipout` on the `Shift` table. All the data in the column will be lost.
  - You are about to drop the column `hostTipout` on the `Shift` table. All the data in the column will be lost.
  - You are about to drop the column `saTipout` on the `Shift` table. All the data in the column will be lost.
  - You are about to drop the `RoleConfiguration` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "RoleConfiguration" DROP CONSTRAINT "RoleConfiguration_roleId_fkey";

-- DropIndex
DROP INDEX "Role_name_key";

-- AlterTable
ALTER TABLE "Shift" DROP COLUMN "barTipout",
DROP COLUMN "hostTipout",
DROP COLUMN "saTipout";

-- DropTable
DROP TABLE "RoleConfiguration";

-- CreateTable
CREATE TABLE "RoleConfig" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "tipoutType" TEXT NOT NULL,
    "percentageRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "receivesTipout" BOOLEAN NOT NULL DEFAULT false,
    "paysTipout" BOOLEAN NOT NULL DEFAULT true,
    "distributionGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleConfig_roleId_idx" ON "RoleConfig"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleConfig_roleId_tipoutType_effectiveFrom_key" ON "RoleConfig"("roleId", "tipoutType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Role_name_idx" ON "Role"("name");

-- AddForeignKey
ALTER TABLE "RoleConfig" ADD CONSTRAINT "RoleConfig_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
