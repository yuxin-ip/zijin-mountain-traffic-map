// Repeatable drag workload at building-detail zoom; reports browser frame times.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.env.TEST_URL || 'http://localhost:3001/', { waitUntil: 'networkidle' });
  await page.locator('[data-testid="traffic-map"][data-ready="true"]').waitFor();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大地图', exact: true }).click();
  if (await page.locator('.map-drag-cache').count()) await page.locator('.map-drag-cache[data-ready="true"]').waitFor({ state: 'attached' });
  const samples = [];
  for (let run = 0; run < 3; run++) samples.push(await page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="traffic-map"] > svg');
    const rect = svg.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    // Real pointer capture is tested by map-smoke; synthetic input isolates the render workload.
    const capture = svg.setPointerCapture;
    svg.setPointerCapture = () => {};
    const send = (type, dx) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'mouse', button: 0, clientX: x + dx, clientY: y }));
    send('pointerdown', 0);
    const frames = [];
    let previous = performance.now();
    for (let i = 0; i < 90; i++) {
      const now = await new Promise(requestAnimationFrame);
      frames.push(now - previous); previous = now;
      for (let j = 0; j < 3; j++) send('pointermove', Math.sin((i * 3 + j) / 270 * Math.PI * 2) * 160);
    }
    send('pointerup', 0);
    svg.setPointerCapture = capture;
    await new Promise(resolve => setTimeout(resolve, 180));
    const values = frames.slice(3).sort((a, b) => a - b);
    return { medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.floor(values.length * .95)], over34ms: values.filter(n => n > 34).length, frames: values.length };
  }));
  console.log(JSON.stringify({ url: process.env.TEST_URL, samples }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
