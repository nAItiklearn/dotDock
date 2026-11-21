// Evaluates JavaScript in one page of the running app over CDP (WebView2 remote debugging), picked by URL.
// Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>.
// Usage: node cdp.mjs <port> <url-part> <expression | @file.js>
// The expression may return a promise; its value is printed as JSON.
import { readFileSync } from "node:fs";

const [port, urlPart, source] = process.argv.slice(2);
const expression = source.startsWith("@") ? readFileSync(source.slice(1), "utf8") : source;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes(urlPart));
if (!page) {
  console.error(`no page matching ${urlPart}: ${targets.map((t) => t.url).join(", ")}`);
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mine = ++id;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === mine) {
        ws.removeEventListener("message", onMessage);
        resolve(message);
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
ws.addEventListener("open", async () => {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  const result = reply.result;
  if (result?.exceptionDetails) {
    console.error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result?.result?.value ?? null, null, 1));
  }
  ws.close();
});
