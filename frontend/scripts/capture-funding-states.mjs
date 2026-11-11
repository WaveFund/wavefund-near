// Captures key funding-dashboard states for review. Run inside the isolated environment against an already
// running local dashboard (it starts nothing itself). Uses only the labelled fixture explorer: no API,
// wallet, provider or network beyond loopback. Output goes to the git-ignored .run/screenshots directory.
//
//   npm run dev --workspace @wavefund/frontend            # in one shell
//   node frontend/scripts/capture-funding-states.mjs       # in another (requires Playwright's Chromium)
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = new URL(process.env.WAVEFUND_UI_URL ?? 'http://127.0.0.1:3000');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Screenshots are captured from a loopback dashboard only');
const out = process.env.WAVEFUND_SCREENSHOT_DIR ?? '.run/screenshots';
const STATES = [
  ['01-overview', null], ['02-dry-quote', 'preview'], ['03-submitted', 'fx-pending'], ['04-provider-success-unverified', 'fx-provider-success'],
  ['05-delivered-fixture', 'fx-delivered'], ['06-partial-refund', 'fx-partial-refund'], ['07-refund-pending', 'fx-refund-pending'],
  ['08-failed-not-refunded', 'fx-failed'], ['09-broadcast-unknown', 'fx-broadcast-unknown'], ['10-stale', 'fx-stale'],
  ['11-bad-delivery-evidence', 'fx-inconsistent'], ['12-hostile-response', 'fx-hostile'],
];
const VIEWPORTS = [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [device, viewport] of VIEWPORTS) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(new URL('/fund?fixtures=1', base).toString(), { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Every funding state/ }).waitFor();
    for (const [name, action] of STATES) {
      if (action === 'preview') {
        await page.getByRole('button', { name: /Preview dry quote|Refresh dry quote/ }).click();
        await page.locator('.quote-card').waitFor();
      } else if (action) {
        await page.locator(`[data-scenario="${action}"]`).click();
        // The chip turns pressed only once its record has loaded; then the tracker must be idle.
        await page.locator(`[data-scenario="${action}"][aria-pressed="true"]`).waitFor();
        await page.locator('.tracker[aria-busy="false"] .status-hero').waitFor();
      }
      await page.screenshot({ path: `${out}/${device}-${name}.png`, fullPage: true });
      // A viewport-sized shot of the tracker is easier to review than a very tall full page on phones.
      if (device === 'mobile' && action && action !== 'preview') {
        await page.locator('.tracker').scrollIntoViewIfNeeded();
        await page.locator('.tracker').screenshot({ path: `${out}/${device}-${name}-tracker.png` });
      }
      if (device === 'mobile' && !action) await page.screenshot({ path: `${out}/${device}-${name}-viewport.png` });
      console.log(`captured ${device}-${name}.png`);
    }
    await page.close();
  }
} finally { await browser.close(); }
