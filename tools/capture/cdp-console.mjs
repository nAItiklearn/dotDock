// Reloads the overlay WebView and prints console messages and exceptions for a few seconds.
// Usage: node cdp-console.mjs <port> [seconds]
const [port, secs = "5"] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled") console.log(`[${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") console.log("[exception]", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Log.entryAdded") console.log(`[log:${m.params.entry.level}]`, m.params.entry.text, m.params.entry.url ?? "");
});
ws.addEventListener("open", () => {
  send("Runtime.enable"); send("Log.enable"); send("Page.reload", { ignoreCache: true });
  setTimeout(() => { ws.close(); process.exit(0); }, Number(secs) * 1000);
});
