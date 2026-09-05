const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || undefined });
  try {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://localhost:3001/', { waitUntil: 'networkidle' });
    await page.locator('[data-testid="traffic-map"][data-ready="true"]').waitFor();
    const svg = page.locator('[data-testid="traffic-map"] > svg');
    const map = page.getByTestId('traffic-map');
    const width = () => svg.evaluate(n => n.viewBox.baseVal.width);
    const metrics = () => page.evaluate(() => ({ scale: visualViewport.scale, scroll: scrollY, width: innerWidth }));
    const initialPage = await metrics();
    const session = await context.newCDPSession(page);
    async function pinch(from, to, yFraction = .55) {
      const box = await map.boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height * yFraction;
      const points = gap => [{ x: x - gap / 2, y, id: 0 }, { x: x + gap / 2, y, id: 1 }];
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
      for (let i = 1; i <= 12; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + (to - from) * i / 12) });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(150);
      const current = await metrics();
      assert.equal(current.scale, initialPage.scale, 'Map pinch must not zoom the page');
      assert.equal(current.scroll, initialPage.scroll, 'Map pinch must not scroll the page');
      assert.equal(current.width, initialPage.width, 'Map pinch must not resize the page');
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole('button', { name: '恢复地图全景' }).click();
      const before = await width();
      await pinch(65, 210);
      assert(await width() < before * .6, 'Spread must zoom into the map');
      const zoomed = await width();
      await pinch(210, 65);
      assert(await width() > zoomed * 1.8, 'Pinch inward must zoom out of the map');
    }
    // Start over the top map legend, not just on a road in the SVG.
    await pinch(70, 150, .08);
    const guards = await page.evaluate(() => {
      const panel = document.querySelector('.map-panel');
      const events = ['gesturestart', 'gesturechange', 'touchmove'].map(type => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        panel.querySelector('button').dispatchEvent(event);
        return event.defaultPrevented;
      });
      const outside = new Event('gesturechange', { bubbles: true, cancelable: true });
      document.querySelector('header').dispatchEvent(outside);
      return { events, outside: outside.defaultPrevented, touchAction: getComputedStyle(panel).touchAction, viewport: document.querySelector('meta[name="viewport"]').content };
    });
    assert(guards.events.every(Boolean), 'Native gesture guards must cover map controls');
    assert.equal(guards.outside, false, 'Page accessibility zoom outside the map must be preserved');
    assert.equal(guards.touchAction, 'none');
    assert(!guards.viewport.includes('user-scalable=no'));
    await page.getByRole('button', { name: '恢复地图全景' }).click();
    const beforeButton = await width();
    await page.getByRole('button', { name: '放大地图', exact: true }).tap();
    assert(await width() < beforeButton, 'Map button taps must still work');
    await page.screenshot({ path: 'artifacts/map-mobile-gestures.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', initialPage, finalPage: await metrics(), guards }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
