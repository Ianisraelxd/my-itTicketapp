// Loads settings from server/.env (and a .env in the project folder), whichever the folder you start from.
// Real environment variables always win. Every setting has a default, so no file is required.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("./.env", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
