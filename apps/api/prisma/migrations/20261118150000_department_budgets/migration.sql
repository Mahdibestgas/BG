-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "department" TEXT;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "department" TEXT;

-- CreateTable
CREATE TABLE "budget_settings" (
    "tenant_id" UUID NOT NULL,
    "pack" TEXT NOT NULL DEFAULT 'ksa-lpg',
    "regions" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "budget_cycles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_month" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "deadline" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_submissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "body" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_cycles_tenant_id_idx" ON "budget_cycles"("tenant_id");

-- CreateIndex
CREATE INDEX "budget_submissions_tenant_id_cycle_id_idx" ON "budget_submissions"("tenant_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_submissions_cycle_id_department_revision_key" ON "budget_submissions"("cycle_id", "department", "revision");

-- AddForeignKey
ALTER TABLE "budget_settings" ADD CONSTRAINT "budget_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_cycles" ADD CONSTRAINT "budget_cycles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_submissions" ADD CONSTRAINT "budget_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_submissions" ADD CONSTRAINT "budget_submissions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "budget_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

