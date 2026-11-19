-- Guidance figures per company: monthly averages from history (bank, P&L), shown to department heads as a starting point.
ALTER TABLE "budget_settings" ADD COLUMN "guidance" JSONB;
