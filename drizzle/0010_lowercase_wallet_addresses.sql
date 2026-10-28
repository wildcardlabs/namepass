ALTER TABLE "names" ADD CONSTRAINT "names_deposit_address_lowercase" CHECK ("deposit_address" = lower("deposit_address"));
--> statement-breakpoint
ALTER TABLE "goldsky"."watched_addresses" ADD CONSTRAINT "watched_addresses_value_lowercase" CHECK ("value" = lower("value"));
