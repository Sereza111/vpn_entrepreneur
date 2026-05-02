-- Single-row-per-namespace JSON documents (legacy file layout).

CREATE TABLE IF NOT EXISTS app_kv (
  namespace VARCHAR(64) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (namespace)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
