-- Разовое заполнение строк app_kv пустыми JSON-объектами (как «пустые» legacy-файлы).
-- Безопасно: INSERT IGNORE не трогает уже существующие неймспейсы.
-- Выполни в phpMyAdmin, если таблица есть, а строк 0.

INSERT IGNORE INTO app_kv (namespace, payload_json) VALUES
  ('balance', '{}'),
  ('xui_links', '{}'),
  ('proxy_links', '{}'),
  ('referrals', '{}'),
  ('payment_webhook', '{}'),
  ('runtime_state', '{}'),
  ('admin_config', '{}'),
  ('notify_expiring', '{}');
