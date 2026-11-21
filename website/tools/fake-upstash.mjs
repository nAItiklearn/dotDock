// A stand-in for the Upstash Redis REST API, for trying the counter locally without an account.
// It understands the two commands the counter sends (INCR and GET), checks the bearer token and keeps
// its numbers in memory. Usage: node tools/fake-upstash.mjs [port]   (default 8799, token "local")
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8799);
const TOKEN = "local";
const store = new Map();

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const reply = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: "unauthorized" });
    let command;
    try {
      command = JSON.parse(body);
    } catch {
      return reply(400, { error: "bad request" });
    }
    // One command is sent as ["incr", "key"]; a batch (the client's pipeline) as [["incr", "key"], ...].
    const run = ([name, key]) => {
      if (String(name).toUpperCase() === "INCR") {
        const next = Number(store.get(key) ?? 0) + 1;
        store.set(key, String(next));
        return { result: next };
      }
      if (String(name).toUpperCase() === "GET") return { result: store.get(key) ?? null };
      return { error: `unsupported command ${name}` };
    };
    if (Array.isArray(command[0])) return reply(200, command.map(run));
    const out = run(command);
    return reply("error" in out ? 400 : 200, out);
  });
}).listen(port, "127.0.0.1", () => console.log(`fake Upstash on http://127.0.0.1:${port} (token "${TOKEN}")`));
