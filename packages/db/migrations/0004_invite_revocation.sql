ALTER TABLE "invites" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;