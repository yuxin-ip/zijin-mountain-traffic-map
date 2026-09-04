const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || undefined, headless: true });
  const url = process.env.TEST_URL || 'http://localhost:3001/';
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => requests.push(`${request.url()}: ${request.failure()?.errorText}`));
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="traffic-map"][data-ready="true"]').waitFor({ timeout: 20000 });
    const state = () => page.locator('[data-testid="traffic-map"]').evaluate(node => ({
      level: node.dataset.detailLevel,
      paths: node.querySelectorAll('.traffic-road').length,
      labels: node.querySelectorAll('[data-label-kind]').length,
      junctions: node.querySelectorAll('[data-testid="junction-dot"]').length,
      baseKinds: [...new Set([...node.querySelectorAll('[data-base-kind]')].map(n => n.dataset.baseKind))],
      baseFeatures: [...node.querySelectorAll('[data-base-kind]')].reduce((sum, n) => sum + Number(n.dataset.featureCount), 0),
      box: { width: node.clientWidth, height: node.clientHeight },
      view: node.querySelector('svg').getAttribute('viewBox'),
    }));
    const overview = await state();
    assert(overview.paths >= 50 && overview.box.height > 300, 'Road geometry must render in a nonzero map');
    assert.equal(overview.level, '0');
    for (const kind of ['forest', 'water', 'major', 'street']) assert(overview.baseKinds.includes(kind), `First render is missing basemap ${kind}`);
    assert(!overview.baseKinds.includes('building'), 'Building detail should wait until close-up');
    await page.getByRole('button', { name: '放大地图', exact: true }).click();
    await page.getByRole('button', { name: '放大地图', exact: true }).click();
    const streets = await state();
    assert.equal(streets.level, '1');
    assert(streets.baseKinds.includes('trail') && streets.baseKinds.includes('service'), 'Street zoom must reveal real paths and service roads');
    assert(streets.baseFeatures > overview.baseFeatures, 'Zoom must add geographic features, not only enlarge traffic lines');
    await page.getByRole('button', { name: '放大地图', exact: true }).click();
    const detail = await state();
    assert.equal(detail.level, '2');
    assert(detail.junctions > 0, 'Close-up should reveal intersections');
    assert(detail.baseKinds.includes('building') && detail.baseKinds.includes('steps'), 'Close-up must include building outlines and steps');
    assert(detail.baseFeatures > streets.baseFeatures, 'Detail zoom must add geographic features');
    await page.screenshot({ path: 'artifacts/map-detail.png', fullPage: true });
    await page.getByRole('button', { name: '缩小地图', exact: true }).click();
    assert.equal((await state()).level, '1');
    await page.getByRole('button', { name: '恢复地图全景', exact: true }).click();
    assert.equal((await state()).level, '0');
    const beforeColor = await page.locator('[data-road-key="143346138"] .traffic-road').getAttribute('stroke');
    await page.getByRole('button', { name: '机动车 · 无预约', exact: true }).click();
    const afterColor = await page.locator('[data-road-key="143346138"] .traffic-road').getAttribute('stroke');
    assert.notEqual(afterColor, beforeColor, 'Vehicle selection must update road colors');
    await page.getByRole('button', { name: '电动自行车', exact: true }).click();
    await page.getByRole('button', { name: '双休 / 节假日 08:30–17:30', exact: true }).click();
    assert.equal(await page.locator('[data-road-key="143346138"] .traffic-road').getAttribute('stroke'), beforeColor);
    await page.getByRole('button', { name: '管控时段外 看现场标志', exact: true }).click();
    assert.equal(await page.locator('[data-road-key="143346138"] .traffic-road').getAttribute('stroke'), '#aeb8c8');
    await page.getByRole('button', { name: '工作日 09:00–17:00', exact: true }).click();
    await page.getByRole('button', { name: '梅花谷路 电动车可进', exact: true }).click();
    await page.getByRole('button', { name: '关闭', exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '恢复地图全景', exact: true }).click();
    const svg = page.locator('[data-testid="traffic-map"] > svg');
    const box = await svg.boundingBox();
    const beforeDrag = (await state()).view;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    assert.notEqual((await state()).view, beforeDrag, 'Dragging must pan');
    const beforeWheel = (await state()).view;
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(150);
    assert.notEqual((await state()).view, beforeWheel, 'Wheel must zoom');
    await page.getByRole('button', { name: '恢复地图全景', exact: true }).click();
    await page.screenshot({ path: 'artifacts/map-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: '恢复地图全景', exact: true }).click();
    const mobile = await state();
    assert(mobile.box.width <= 390 && mobile.box.height >= 400, 'Mobile map dimensions');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'No mobile horizontal overflow');
    const touch = await context.newCDPSession(page);
    const mobileBox = await svg.boundingBox();
    const centerX = mobileBox.x + mobileBox.width / 2;
    const centerY = mobileBox.y + mobileBox.height / 2;
    const beforePinch = (await state()).view;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centerX - 35, y: centerY, id: 0 }, { x: centerX + 35, y: centerY, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centerX - 75, y: centerY, id: 0 }, { x: centerX + 75, y: centerY, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.notEqual((await state()).view, beforePinch, 'Two-finger pinch must zoom');
    await touch.detach();
    await page.getByRole('button', { name: '恢复地图全景', exact: true }).click();
    await page.screenshot({ path: 'artifacts/map-mobile.png', fullPage: true });
    const staticContext = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(url, { waitUntil: 'domcontentloaded' });
    assert(await staticPage.locator('.traffic-road').count() >= 50, 'The map must be visible even before JS initializes');
    assert(await staticPage.locator('[data-base-kind="forest"] path').count() > 0, 'Forest geometry must exist without JavaScript');
    assert(await staticPage.locator('[data-base-kind="water"] path').count() > 0, 'Water geometry must exist without JavaScript');
    await staticContext.close();
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(JSON.stringify({ result: 'PASS', overview, streets, detail, mobile, errors, requests }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ errors, requests, body: (await page.locator('body').innerText()).slice(0, 1500) }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
