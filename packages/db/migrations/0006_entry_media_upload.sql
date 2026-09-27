ALTER TABLE "entry_media" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_media" ADD CONSTRAINT "entry_media_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_media_upload_idx" ON "entry_media" USING btree ("upload_id");