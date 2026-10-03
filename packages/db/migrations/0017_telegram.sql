CREATE TABLE "telegram_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_guest_hints" (
	"chat_id" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_guest_hints_chat_id_telegram_user_id_pk" PRIMARY KEY("chat_id","telegram_user_id")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD COLUMN "chat_title" text;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD COLUMN "media_group_id" text;--> statement-breakpoint
ALTER TABLE "telegram_codes" ADD CONSTRAINT "telegram_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_codes" ADD CONSTRAINT "telegram_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_messages_media_group_idx" ON "telegram_messages" USING btree ("chat_id","media_group_id");