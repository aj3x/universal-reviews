CREATE TABLE `movie_details` (
	`item_id` text PRIMARY KEY NOT NULL,
	`year` integer,
	`runtime` integer,
	`director` text,
	`cached_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
