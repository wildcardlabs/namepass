ALTER TABLE "chain_events" ADD COLUMN "renewal_reconciled_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "chain_events_pending_renewals_idx" ON "chain_events" ("event_id")
	WHERE "canonical" = true AND "event_family" = 'namepass'
		AND "event_type" = 'Renewed' AND "renewal_reconciled_at" IS NULL;
