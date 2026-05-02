import { runMysqlMigrations } from "./migrate.js";

runMysqlMigrations()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
