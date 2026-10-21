CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`visited_on` text NOT NULL,
	`enjoyment` integer NOT NULL,
	`impact` integer NOT NULL,
	`value` integer NOT NULL,
	`aesthetic` integer NOT NULL,
	`revisit` text NOT NULL,
	`recommend_to` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "visits_enjoyment" CHECK("visits"."enjoyment" BETWEEN 1 AND 10),
	CONSTRAINT "visits_impact" CHECK("visits"."impact" BETWEEN 1 AND 10),
	CONSTRAINT "visits_value" CHECK("visits"."value" BETWEEN 1 AND 10),
	CONSTRAINT "visits_aesthetic" CHECK("visits"."aesthetic" BETWEEN 1 AND 10),
	CONSTRAINT "visits_revisit" CHECK("visits"."revisit" IN ('never', 'once_more', 'a_few_times', 'regularly', 'forever')),
	CONSTRAINT "visits_recommend_to" CHECK("visits"."recommend_to" IN ('everyone', 'most', 'specific_people', 'nobody'))
);
--> statement-breakpoint
CREATE INDEX `visits_review_idx` ON `visits` (`review_id`,`visited_on`);--> statement-breakpoint
-- Every existing review becomes a visit. Duplicate reviews of the same item by the same
-- user fold into the newest one (highest ULID), which stays as the current opinion.
INSERT INTO `visits`(`id`, `review_id`, `visited_on`, `enjoyment`, `impact`, `value`, `aesthetic`, `revisit`, `recommend_to`, `note`, `created_at`)
SELECT r.`id`,
       (SELECT MAX(r2.`id`) FROM `reviews` r2 WHERE r2.`user_id` = r.`user_id` AND r2.`item_id` = r.`item_id`),
       COALESCE(r.`experienced_on`, substr(r.`created_at`, 1, 10)),
       r.`enjoyment`, r.`impact`, r.`value`, r.`aesthetic`, r.`revisit`, r.`recommend_to`, r.`notes`, r.`created_at`
FROM `reviews` r;--> statement-breakpoint
DELETE FROM `reviews` WHERE `id` NOT IN (SELECT MAX(`id`) FROM `reviews` GROUP BY `user_id`, `item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_user_item_unique` ON `reviews` (`user_id`,`item_id`);