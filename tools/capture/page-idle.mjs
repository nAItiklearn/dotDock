// Measures how much work each WebView2 page of the app does while it sits idle, over CDP (WebView2 remote
// debugging): main-thread task time, script time, style recalcs, layouts and frames, from Performance.getMetrics
// at the start and the end of the window. Tells the island's own cost apart from the other pages in the process.
//   node tools/capture/page-idle.mjs <port> [seconds]
// Prints one JSON line per page: busy is the share of the window the page's main thread was busy, in percent.

const [port, seconds = '30'] = process.argv.slice(2);
if (!port) {
  console.error('usage: node page-idle.mjs <port> [seconds]');
  process.exit(1);
}

function connect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const send = (method, params = {}) =>
      new Promise((done) => {
        const mine = ++id;
        const on = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id !== mine) return;
          ws.removeEventListener('message', on);
          done(msg.result);
        };
        ws.addEventListener('message', on);
        ws.send(JSON.stringify({ id: mine, method, params }));
      });
    ws.addEventListener('open', () => resolve({ send, close: () => ws.close() }));
  });
}

const metrics = async (page) => Object.fromEntries((await page.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');
const open = await Promise.all(pages.map(async (t) => ({ t, page: await connect(t.webSocketDebuggerUrl) })));
for (const { page } of open) await page.send('Performance.enable', { timeDomain: 'timeTicks' });
const before = await Promise.all(open.map(({ page }) => metrics(page)));
await new Promise((r) => setTimeout(r, Number(seconds) * 1000));
const after = await Promise.all(open.map(({ page }) => metrics(page)));
open.forEach(({ t, page }, i) => {
  const d = (name) => (after[i][name] ?? 0) - (before[i][name] ?? 0);
  const window = d('Timestamp');
  console.log(JSON.stringify({
    page: t.title,
    url: new URL(t.url).pathname,
    seconds: +window.toFixed(1),
    busyPercent: +((100 * d('TaskDuration')) / window).toFixed(3),
    scriptMs: +(1000 * d('ScriptDuration')).toFixed(1),
    recalcStyles: d('RecalcStyleCount'),
    layouts: d('LayoutCount'),
    frames: d('Frames'),
  }));
  page.close();
});
