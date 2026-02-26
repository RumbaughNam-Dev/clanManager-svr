CREATE TABLE IF NOT EXISTS `dashboard_boss_visibility_exclusions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `clan_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `boss_meta_id` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dashboard_boss_visibility_exclusions` (`clan_id`, `user_id`, `boss_meta_id`),
  KEY `idx_dashboard_boss_visibility_exclusions_clan_user` (`clan_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
