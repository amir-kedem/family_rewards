import { readFileSync, writeFileSync } from "node:fs";
const id = process.env.D1_DATABASE_ID;
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    id || "",
  )
)
  throw new Error("Set D1_DATABASE_ID to the database ID from Cloudflare.");
const config = JSON.parse(
  readFileSync(new URL("../wrangler.example.jsonc", import.meta.url), "utf8"),
);
config.d1_databases[0].database_id = id;
writeFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  JSON.stringify(config, null, 2) + "\n",
);
