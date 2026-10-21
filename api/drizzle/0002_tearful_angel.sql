PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`experienced_on` text,
	`enjoyment` integer NOT NULL,
	`impact` integer NOT NULL,
	`value` integer NOT NULL,
	`aesthetic` integer NOT NULL,
	`revisit` text NOT NULL,
	`recommend_to` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reviews_enjoyment" CHECK("enjoyment" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_impact" CHECK("impact" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_value" CHECK("value" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_aesthetic" CHECK("aesthetic" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_revisit" CHECK("revisit" IN ('never', 'once_more', 'a_few_times', 'regularly', 'forever')),
	CONSTRAINT "reviews_recommend_to" CHECK("recommend_to" IN ('everyone', 'most', 'specific_people', 'nobody'))
);
--> statement-breakpoint
INSERT INTO `__new_reviews`("id", "user_id", "item_id", "experienced_on", "enjoyment", "impact", "value", "aesthetic", "revisit", "recommend_to", "notes", "created_at", "updated_at") SELECT "id", "user_id", "item_id", "experienced_on", "enjoyment", "impact", "value", "aesthetic", CASE "revisit" WHEN 'once' THEN 'once_more' ELSE "revisit" END, "recommend_to", "notes", "created_at", "updated_at" FROM `reviews`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reviews_item_idx` ON `reviews` (`item_id`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_user_idx` ON `reviews` (`user_id`,`id`);