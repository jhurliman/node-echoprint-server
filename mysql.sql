-- --------------------------------------------------------
--
-- Table structure for table `artists`
--

CREATE TABLE IF NOT EXISTS `artists` (
  `id` MEDIUMINT NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) DEFAULT CHARSET=utf8;

-- --------------------------------------------------------
--
-- Table structure for table `tracks`
--

CREATE TABLE IF NOT EXISTS `tracks` (
  `id` MEDIUMINT NOT NULL AUTO_INCREMENT,
  `codever` char(4) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `artist_id` MEDIUMINT NOT NULL,
  `length` int(5) NOT NULL,
  `import_date` datetime NOT NULL,
  PRIMARY KEY (`id`,`codever`),
  FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON DELETE CASCADE
) DEFAULT CHARSET=utf8;

-- --------------------------------------------------------
--
-- Table structure for table `codes`
--

CREATE TABLE IF NOT EXISTS `codes` (
  `code` int(7) NOT NULL,
  `time` int(7) NOT NULL,
  `track_id` MEDIUMINT NOT NULL,
  PRIMARY KEY (`code`,`time`,`track_id`),
  FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE
) DEFAULT CHARSET=utf8;
