PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`external_source` text,
	`external_id` text,
	`parent_id` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "items_kind" CHECK("__new_items"."kind" IN ('restaurant', 'movie', 'book', 'dish')),
	CONSTRAINT "items_parent" CHECK(("__new_items"."kind" = 'dish') = ("__new_items"."parent_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "kind", "title", "external_source", "external_id", "created_by", "created_at") SELECT "id", "kind", "title", "external_source", "external_id", "created_by", "created_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `items_external_idx` ON `items` (`external_source`,`external_id`);--> statement-breakpoint
CREATE INDEX `items_kind_title_idx` ON `items` (`kind`,`title`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_parent_title_idx` ON `items` (`parent_id`,lower(`title`));