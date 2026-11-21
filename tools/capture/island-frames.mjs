// Measures the island's frame pacing on the real desktop, over CDP (WebView2 remote debugging).
// Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>, then:
//   node tools/capture/island-frames.mjs <port> <seconds>
// While it records, drive the island (a replay makes it expand, change state and collapse). Every animation frame
// the island's page gets is timed with requestAnimationFrame; a frame counts as dropped when it arrives later than
// one and a half refresh intervals after the one before. Prints frames, refresh rate, worst gap and drops as JSON.

const [port, seconds = '10'] = process.argv.slice(2);
if (!port) {
  console.error('usage: node island-frames.mjs <port> [seconds]');
  process.exit(1);
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('island'));
if (!page) {
  console.error('no island page among the debug targets');
  process.exit(1);
}

const recorder = `new Promise((done) => {
  const gaps = [];
  let last = 0;
  const until = performance.now() + ${Number(seconds) * 1000};
  const step = (now) => {
    if (last) gaps.push(now - last);
    last = now;
    if (now < until) requestAnimationFrame(step);
    else {
      const sorted = [...gaps].sort((a, b) => a - b);
      const interval = sorted[Math.floor(sorted.length / 2)] || 0;
      const dropped = gaps.filter((g) => g > interval * 1.5).length;
      done({ frames: gaps.length + 1, refreshHz: Math.round(1000 / interval), medianMs: +interval.toFixed(2),
             p99Ms: +(sorted[Math.floor(sorted.length * 0.99)] || 0).toFixed(2), worstMs: +(sorted.at(-1) || 0).toFixed(2), dropped });
    }
  };
  requestAnimationFrame(step);
})`;

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: recorder, awaitPromise: true, returnByValue: true } }));
});
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== 1) return;
  console.log(JSON.stringify(msg.result?.result?.value ?? msg.result ?? msg.error));
  ws.close();
});
