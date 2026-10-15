CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`follower_id`, `followee_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`followee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "follows_no_self" CHECK("follows"."follower_id" <> "follows"."followee_id"),
	CONSTRAINT "follows_status" CHECK("follows"."status" IN ('pending', 'accepted'))
);
--> statement-breakpoint
CREATE INDEX `follows_followee_idx` ON `follows` (`followee_id`,`status`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`external_source` text,
	`external_id` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "items_kind" CHECK("items"."kind" IN ('restaurant', 'movie', 'book'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_external_idx` ON `items` (`external_source`,`external_id`);--> statement-breakpoint
CREATE INDEX `items_kind_title_idx` ON `items` (`kind`,`title`);--> statement-breakpoint
CREATE TABLE `list_items` (
	`list_id` text NOT NULL,
	`item_id` text NOT NULL,
	`note` text,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`list_id`, `item_id`),
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lists_owner_idx` ON `lists` (`owner_id`);--> statement-breakpoint
CREATE TABLE `restaurant_details` (
	`item_id` text PRIMARY KEY NOT NULL,
	`address` text,
	`lat` real,
	`lng` real,
	`cuisine` text,
	`price_level` integer,
	`cached_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
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
	CONSTRAINT "reviews_enjoyment" CHECK("reviews"."enjoyment" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_impact" CHECK("reviews"."impact" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_value" CHECK("reviews"."value" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_aesthetic" CHECK("reviews"."aesthetic" BETWEEN 1 AND 10),
	CONSTRAINT "reviews_revisit" CHECK("reviews"."revisit" IN ('once', 'a_few_times', 'regularly', 'forever')),
	CONSTRAINT "reviews_recommend_to" CHECK("reviews"."recommend_to" IN ('everyone', 'most', 'specific_people', 'nobody'))
);
--> statement-breakpoint
CREATE INDEX `reviews_item_idx` ON `reviews` (`item_id`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_user_idx` ON `reviews` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`is_private` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);