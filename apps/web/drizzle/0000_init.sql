CREATE TYPE "public"."owner" AS ENUM('design', 'code', 'register');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('open', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('accept', 'reject', 'comment');--> statement-breakpoint
CREATE TYPE "public"."route" AS ENUM('auto', 'reset', 'explain', 'owner');--> statement-breakpoint
CREATE TYPE "public"."surface_kind" AS ENUM('code', 'claude-design', 'figma', 'pen');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_answer" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" text NOT NULL,
	"question_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" jsonb NOT NULL,
	"p_raw" real NOT NULL,
	"p_calibrated" real,
	"provider" text NOT NULL,
	"cost_microusd" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drift_report" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" text NOT NULL,
	"commit_sha" text,
	"health_score" integer NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_installation_id" integer,
	"account" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_github_installation_id_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"source" "surface_kind" NOT NULL,
	"intent" text NOT NULL,
	"status" "proposal_status" DEFAULT 'open' NOT NULL,
	"route" "route" NOT NULL,
	"decider" "owner",
	"risk" text NOT NULL,
	"confidence" real NOT NULL,
	"base_sha" text,
	"branch" text,
	"pull_request" integer,
	"evaluation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" text,
	"slug" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"register_path" text DEFAULT '.accord' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" text NOT NULL,
	"user_id" text,
	"decision" "review_decision" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "snapshot" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" text NOT NULL,
	"surface" "surface_kind" NOT NULL,
	"hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surface" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" text NOT NULL,
	"kind" "surface_kind" NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_answer" ADD CONSTRAINT "check_answer_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_report" ADD CONSTRAINT "drift_report_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_installation_id_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surface" ADD CONSTRAINT "surface_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_repository" ON "audit_log" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "drift_report_repository" ON "drift_report" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_repository_key" ON "proposal" USING btree ("repository_id","key");--> statement-breakpoint
CREATE INDEX "proposal_status" ON "proposal" USING btree ("repository_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_slug" ON "repository" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "snapshot_repository_surface" ON "snapshot" USING btree ("repository_id","surface","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "surface_repository_kind" ON "surface" USING btree ("repository_id","kind");