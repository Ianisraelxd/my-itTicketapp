// Wipes the HelpDesk database and rebuilds it from server/schema.sql, then creates the starting accounts
// (new random passwords, shown once). Needs --yes because it deletes everything.
import "../server/env.js";
import { resetDatabase } from "../server/setup.js";

if (!process.argv.includes("--yes")) {
  console.log("This deletes EVERY ticket and account in the database and starts again.\nRun it again with --yes if that is what you want:  npm run db:init -- --yes");
  process.exit(1);
}
await resetDatabase({ log: console.log });
process.exit(0);
