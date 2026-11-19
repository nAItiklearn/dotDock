// Evaluates an expression in the overlay WebView over CDP (WebView2 remote debugging).
// Usage: node cdp-eval.mjs <port> "<expression>"
const [port, expr] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === myId) { ws.removeEventListener("message", onMsg); resolve(msg); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
ws.addEventListener("open", async () => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
  ws.close();
});
