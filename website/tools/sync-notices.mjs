// Copies the repository's THIRD_PARTY_NOTICES.md into the site so /license shows the real file.
// Runs before every build. If the file is not there (the site built on its own), the committed
// copy in src/content is used as it is.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "THIRD_PARTY_NOTICES.md");
const target = join(here, "..", "src", "content", "THIRD_PARTY_NOTICES.md");

if (!existsSync(source)) {
  console.log("Notices: repository file not found, keeping the committed copy.");
  process.exit(0);
}

// The page supplies its own <h1>, so the file's top heading is dropped. Line endings are
// normalised so the committed copy does not change with the checkout's CRLF setting.
const text = readFileSync(source, "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/^\s*# .*\n+/, "");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, text);
console.log("Notices: synced THIRD_PARTY_NOTICES.md.");
