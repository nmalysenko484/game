// Rough difficulty gauge: a "kid" player that aims at the next star only roughly (±20–45°, no allowance for
// gravity, random pauses) plays each level 40 times; prints the win rate and what killed it.
//
//   node tools/kid-check.js 1 2 3 11 21      levels to test
//
// It never waits for a laser / mill / mine to move away, so on those levels real children (who learn the
// timing) do better than this number. Use it to compare levels with each other, not as the truth.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  await page.goto('file://' + require('path').resolve(__dirname, '../index.html')); await page.waitForFunction(() => typeof booting !== 'undefined' && !booting);
  await page.evaluate(() => { window.frame = function () {}; });
  for (const n of process.argv.slice(2).map(Number)) {
    const r = await page.evaluate(n => {
      let wins = 0, tries = 40, causes = {}, tsum = 0;
      for (let a = 0; a < tries; a++) {
        save.mode = 'levels'; lvN = n; reset(); state = 'play'; holding = true;
        let on = null, minHold = 0.5, relT = -9, pause = 0.5, tol = 0.6;
        for (let i = 0; i < 120 * 120 && state === 'play'; i++) {
          if (P.att) {
            if (P.att !== on) { on = P.att; minHold = 0.3 + Math.random() * 0.8; tol = 0.35 + Math.random() * 0.4; }
            let tg = null, bd = 1e9;
            for (const s of stars) if (!s.dead && !s.visited && s.y < P.att.y - 40) { const d = Math.hypot(s.x - P.x, s.y - P.y); if (d < bd) { bd = d; tg = s; } }
            let go = false;
            if (P.att.attT > minHold) {
              const want = tg ? Math.atan2(tg.y - P.y, tg.x - P.x) : -Math.PI / 2, have = Math.atan2(P.vy, P.vx);
              let d = Math.abs(want - have); if (d > Math.PI) d = 2 * Math.PI - d;
              go = d < tol;
            }
            holding = !go;
            if (go) { relT = time; pause = 0.2 + Math.random() * 0.5; }
          } else holding = !gravityOn || time - relT > pause;
          time += 1 / 120; step(1 / 120); if (state === 'play') cleanup(); updateFx(1 / 120, 1 / 120);
        }
        if (state === 'winning') { wins++; tsum += lvT; } else { const c = state === 'play' ? 'timeout' : deathCause; causes[c] = (causes[c] || 0) + 1; }
      }
      return { n, win: Math.round(wins / tries * 100) + '%', t: wins ? +(tsum / wins).toFixed(1) : '-', par: LV.par, causes: JSON.stringify(causes) };
    }, n);
    console.log(JSON.stringify(r));
  }
  await b.close();
})();
