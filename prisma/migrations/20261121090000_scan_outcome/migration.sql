-- What each scan changed (new, came back, fixed), for the Security tab's plain-English report.
ALTER TABLE "SecurityScan" ADD COLUMN "outcome" JSONB;
