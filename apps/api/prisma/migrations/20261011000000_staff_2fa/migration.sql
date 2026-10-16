-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER;

-- Existing accounts were created with a shared seed password: force a new
-- password (and 2FA enrolment, enforced by the API) at their next sign-in.
UPDATE "StaffUser" SET "mustChangePassword" = true;
