-- AlterEnum
ALTER TYPE "ItRequestStatus" ADD VALUE 'PROPOSED';
ALTER TYPE "ItRequestStatus" ADD VALUE 'APPLIED';

-- AlterTable
ALTER TABLE "ItRequest" ADD COLUMN     "workflowProposalId" TEXT,
ADD COLUMN     "workflowId" TEXT;
