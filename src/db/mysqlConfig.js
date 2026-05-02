import "dotenv/config";

function trimmed(v) {
  return String(v || "").trim();
}

export function isMysqlConfigured() {
  if (trimmed(process.env.DB_BACKEND).toLowerCase() === "file") return false;
  return Boolean(trimmed(process.env.DB_HOST) || trimmed(process.env.DATABASE_URL));
}

export function getMysqlPoolConfig() {
  const url = trimmed(process.env.DATABASE_URL);
  if (url) {
    return { uri: url };
  }
  const host = trimmed(process.env.DB_HOST);
  const user = trimmed(process.env.DB_USER);
  const password = trimmed(process.env.DB_PASSWORD);
  const database = trimmed(process.env.DB_NAME);
  const port = Math.max(1, Math.floor(Number(process.env.DB_PORT || 3306)));
  if (!host || !user || !database) {
    throw new Error("mysql_config_incomplete_need_DB_HOST_DB_USER_DB_NAME_or_DATABASE_URL");
  }
  return { host, port, user, password, database };
}
