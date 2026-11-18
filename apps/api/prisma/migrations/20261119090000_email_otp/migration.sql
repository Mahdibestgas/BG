-- Sign-in codes by email: on/off per account, the hash of the current code and when it expires.
ALTER TABLE "accounts" ADD COLUMN "email_otp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "accounts" ADD COLUMN "email_otp_hash" TEXT;
ALTER TABLE "accounts" ADD COLUMN "email_otp_expires" TIMESTAMP(3);
