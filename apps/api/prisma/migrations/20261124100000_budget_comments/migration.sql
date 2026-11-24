-- CreateTable
CREATE TABLE "budget_comments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "cause" TEXT NOT NULL DEFAULT 'other',
    "explanation" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'explained',
    "reply" TEXT,
    "gap" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "as_of" TEXT,
    "explained_by" UUID,
    "explained_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_comments_tenant_id_cycle_id_idx" ON "budget_comments"("tenant_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_comments_cycle_id_item_region_key" ON "budget_comments"("cycle_id", "item", "region");

-- AddForeignKey
ALTER TABLE "budget_comments" ADD CONSTRAINT "budget_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_comments" ADD CONSTRAINT "budget_comments_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "budget_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
