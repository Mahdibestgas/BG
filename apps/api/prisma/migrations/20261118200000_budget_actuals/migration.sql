-- CreateTable
CREATE TABLE "budget_actuals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_actuals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_actuals_tenant_id_cycle_id_month_idx" ON "budget_actuals"("tenant_id", "cycle_id", "month");

-- AddForeignKey
ALTER TABLE "budget_actuals" ADD CONSTRAINT "budget_actuals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_actuals" ADD CONSTRAINT "budget_actuals_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "budget_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

