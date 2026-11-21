-- Risk tiers by file path: advice on how careful to be when accepting a change.
ALTER TABLE "ItRequest" ADD COLUMN "riskLevel" TEXT;
ALTER TABLE "ItRequest" ADD COLUMN "riskAreas" TEXT[];
