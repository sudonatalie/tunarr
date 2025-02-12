ALTER TABLE `program_grouping` ADD `canonical_id` text;--> statement-breakpoint
ALTER TABLE `program_grouping` ADD `library_id` text REFERENCES media_source_library(uuid);