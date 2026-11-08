// Level checker: plays every level of index.html with a bot and reports which ones it could finish.
//
//   node tools/levels-check.js            all 100 levels
//   node tools/levels-check.js 21 35      only levels 21..35
//
// Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
// The game loop is stopped and the bot calls step() directly with a fixed time step, so a level
// takes a fraction of a second. Before letting go of a star the bot simulates the flight with the
// game's own flyMove() and checks lasers, mines, holes, meteors and the void on the way.
// Two runs per level: "fast" (let go at the first safe throw that reaches a higher star; its time
// is the basis for the par time) and "gems" (waits for throws that also pick up crystals).
// "reachable" = how many of the 3 crystals some throw can pick up (and then land on a star).
// The last line prints LV_PAR values for index.html.
const path = require('path');
const { chromium } = require('playwright');

const BOT = `
(function () {
  const DT = 1 / 120, SIM_DT = DT, SIM_STEPS = 300;      // same step as the game run below: the prediction is exact
  const B = { x: 0, y: 0, vx: 0, vy: 0, pcd: 0 };
  const starX = (s, t) => s.type === 'moving' ? s.bx + Math.sin(t * s.ms + s.ph) * s.amp : s.x;
  // the first moments after grabbing star s at time t (as attach() + step() do it): does the swing hit something?
  function swingSafe(s, t, dt0) {
    const sx = starX(s, t), dx = B.x - sx, dy = B.y - s.y, d = Math.hypot(dx, dy) || 1;
    let L = Math.max(d, 50), ang = Math.atan2(dy, dx), spd = clamp(Math.hypot(B.vx, B.vy) * 0.95, 380, MAXSPD);
    const cross = dx * B.vy - dy * B.vx, dir = cross > 0 ? 1 : -1;
    for (let j = 1; j <= 84; j++) {
      const tt = t + j * SIM_DT, dtt = dt0 + j * SIM_DT;
      spd = Math.min(spd + ORBIT_ACC * K.acc * SIM_DT, MAXSPD);
      L += (clamp(L, 70, 150) - L) * Math.min(1, SIM_DT * (L > 150 ? 9 : 4));
      ang += dir * spd / L * SIM_DT;
      const x = starX(s, tt) + Math.cos(ang) * L, y = s.y + Math.sin(ang) * L;
      for (const l of lasers) if (Math.abs(y - l.y) < 16 && laserOn(l, tt)) { const cx = laserX(l, tt); if (x > cx - l.len / 2 - 10 && x < cx + l.len / 2 + 10) return false; }
      for (const m of mines) {
        if (m.dead) continue;
        let mx, my;
        if (m.kind === 'orbit') { const a = m.a + m.w * dtt; mx = starX(m.s, tt) + Math.cos(a) * m.R; my = m.s.y + Math.sin(a) * m.R; }
        else { mx = m.bx + Math.sin(tt * m.ms + m.ph) * m.amp; my = m.by; }
        if (Math.hypot(x - mx, y - my) < m.r + 14) return false;
      }
    }
    return true;
  }
  // returns { ok, star, win, gems } for letting go right now
  function tryRelease() {
    const s0 = P.att, k = s0.type === 'boost' && !s0.dead ? 1.45 : 1;
    B.x = P.x; B.y = P.y; B.vx = -Math.sin(P.ang) * P.dir * P.spd * k; B.vy = Math.cos(P.ang) * P.dir * P.spd * k; B.pcd = 0;
    let gems = 0;
    const gemHit = new Set();
    for (let i = 1; i <= SIM_STEPS; i++) {
      const t = time + i * SIM_DT, dtt = i * SIM_DT;
      flyMove(B, SIM_DT, t);
      if (B.y < finishY) return { ok: true, win: true, gems, star: null };
      for (const l of lasers) {
        if (Math.abs(B.y - l.y) < 16 && laserOn(l, t)) { const cx = laserX(l, t); if (B.x > cx - l.len / 2 - 10 && B.x < cx + l.len / 2 + 10) return { ok: false }; }
      }
      for (const h of wells) if (Math.hypot(B.x - h.x, B.y - h.y) < h.core + 14) return { ok: false };
      for (const m of mines) {
        if (m.dead) continue;
        let mx, my;
        if (m.kind === 'orbit') { const a = m.a + m.w * dtt; mx = starX(m.s, t) + Math.cos(a) * m.R; my = m.s.y + Math.sin(a) * m.R; }
        else { mx = m.bx + Math.sin(t * m.ms + m.ph) * m.amp; my = m.by; }
        if (Math.hypot(B.x - mx, B.y - my) < m.r + 16) return { ok: false };
      }
      for (const m of meteors) if (!m.dead && Math.hypot(B.x - (m.x + m.vx * dtt), B.y - (m.y + m.vy * dtt)) < 40) return { ok: false };
      for (const w of warns) if (!w.done && dtt > w.t && Math.hypot(B.x - (w.x + w.vx * (dtt - w.t)), B.y - (camY - 120 + 500 * (dtt - w.t))) < 50) return { ok: false };
      if (voidOn() && B.y > voidY - (mode === 'levels' ? voidSpd : 120) * dtt - 40) return { ok: false };
      if (!voidOn() && B.y > s0.y + 700) return { ok: false };
      for (const o of orbs) {
        if (o.dead || o.kind !== 'gem' || gemHit.has(o)) continue;
        let gx = o.x, gy = o.y;
        if (o.s) { const a = o.a + (o.spin !== undefined ? o.spin : 0.5) * dtt; gx = starX(o.s, t) + Math.cos(a) * o.R; gy = o.s.y + Math.sin(a) * o.R; }
        if (Math.hypot(B.x - gx, B.y - gy) < 28) { gemHit.add(o); gems++; }
      }
      // the star the ball would grab (nearest in reach), as in findTarget()
      let best = null, bd = K.grab * 0.92;
      for (const s of stars) {
        if (s.dead || !starOn(s, t) || (s === s0 && dtt < 0.35)) continue;
        const d = Math.hypot(B.x - starX(s, t), B.y - s.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best && best.y < s0.y - 40) {
        // don't grab a star that switches off right away
        if (best.type === 'blink' && ((t + best.ph) % best.per) > best.per * best.duty - 0.6) continue;
        if (!swingSafe(best, t, dtt)) return { ok: false };
        return { ok: true, star: best, gems, win: false };
      }
    }
    return { ok: false };
  }
  // crystals: for each one, is there any throw (from any star, any angle, speed and direction) that picks it up
  // and then safely reaches a star? Blinking or moving lasers and mines are skipped: those only need timing.
  window.__gemProbe = function (n) {
    save.mode = 'levels'; lvN = n; reset(); state = 'play';
    const gems = orbs.filter(o => o.kind === 'gem'), got = gems.map(() => false), b = { x: 0, y: 0, vx: 0, vy: 0, pcd: 0 };
    const wall = lasers.filter(l => !l.per && !l.amp);
    const samples = gems.map(o => o.s ? Array.from({ length: 12 }, (_, i) => ({ x: o.s.x + Math.cos(i * Math.PI / 6) * o.R, y: o.s.y + Math.sin(i * Math.PI / 6) * o.R })) : [{ x: o.x, y: o.y }]);
    for (const s of stars) for (const spd of s.type === 'boost' ? [650, 950, 1300, 1500] : [450, 650, 850, 1050]) for (const dir of [1, -1]) for (let a = 0; a < 72; a++) {
      if (got.every(Boolean)) return got.filter(Boolean).length;
      const ang = a * Math.PI / 36;
      b.x = s.x + Math.cos(ang) * 150; b.y = s.y + Math.sin(ang) * 150; b.vx = -Math.sin(ang) * dir * spd; b.vy = Math.cos(ang) * dir * spd; b.pcd = 0;
      let hit = -1;
      for (let i = 1; i < 200; i++) {
        flyMove(b, 1 / 60, i / 60);
        if (wall.some(l => Math.abs(b.y - l.y) < 14 && b.x > l.cx - l.len / 2 - 8 && b.x < l.cx + l.len / 2 + 8)) break;
        if (wells.some(h => Math.hypot(b.x - h.x, b.y - h.y) < h.core + 10)) break;
        if (b.y > s.y + 700) break;
        if (hit < 0) { for (let g = 0; g < gems.length; g++) if (!got[g] && samples[g].some(q => Math.hypot(b.x - q.x, b.y - q.y) < 26)) { hit = g; break; } }
        else if (i > 6 && stars.some(t => Math.hypot(b.x - t.x, b.y - t.y) < K.grab * 0.9)) { got[hit] = true; break; }
      }
    }
    return got.filter(Boolean).length;
  };
  window.__playLevel = function (n, wantGems, maxSec) {
    save.mode = 'levels'; lvN = n; mapOpen = false; paused = false;
    reset(); state = 'play'; holding = false;
    let onStar = null, waited = 0, startAng = 0, flightTarget = null;
    const t0 = time;
    for (let tick = 0; tick < maxSec / DT; tick++) {
      if (!gravityOn) holding = true;
      else if (P.att) {
        if (P.att !== onStar) { onStar = P.att; waited = 0; startAng = P.ang; }
        waited += DT;
        if (tick % 2 === 0) {
          const r = tryRelease();
          const turns = Math.abs(P.ang - startAng) / (2 * Math.PI);
          const crumbling = P.att.type === 'crumble' && P.att.attT > CRUMBLE_T - 0.15;
          const gemLeft = orbs.some(o => o.kind === 'gem' && !o.dead);
          if (r.ok && (!wantGems || r.gems > 0 || !gemLeft || turns > 1.6 || crumbling || voidSpd)) { holding = false; flightTarget = r.star; }
          else holding = true;
        }
      } else {
        const t = findTarget();
        const fading = t && t.type === 'blink' && ((time + t.ph) % t.per) > t.per * t.duty - 0.3;   // would drop us at once
        holding = !!t && !fading && (t === flightTarget || (onStar && t.y < onStar.y - 40));
      }
      time += DT;
      step(DT);
      if (state === 'play') cleanup();
      updateFx(DT, DT);
      if (state === 'winning') return { win: true, t: +lvT.toFixed(2), gems: R.gems, stars: stars.length };
      if (state !== 'play') return { win: false, cause: deathCause, y: Math.round(P.y), pct: Math.round(clamp(minPY / finishY, 0, 1) * 100), gems: R.gems };
      if (P.att && waited > 25) return { win: false, cause: 'stuck', y: Math.round(P.y), pct: Math.round(clamp(minPY / finishY, 0, 1) * 100), gems: R.gems };
    }
    return { win: false, cause: 'timeout', pct: Math.round(clamp(minPY / finishY, 0, 1) * 100), gems: R.gems };
  };
})();
`;

(async () => {
  const from = +process.argv[2] || 1, to = +process.argv[3] || +process.argv[2] || 100;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForFunction(() => typeof booting !== 'undefined' && !booting);
  await page.evaluate(() => { window.frame = function () {}; });      // stop the real game loop
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(BOT);
  const par = [], bad = [], badGems = [];
  console.log('lvl world  fast(time/attempts)       gems(bot) reachable  par');
  for (let n = from; n <= to; n++) {
    let fast = null, tries = 0, fails = [];
    for (; tries < 4 && !fast; tries++) {
      const r = await page.evaluate(([n]) => __playLevel(n, false, 150), [n]);
      if (r.win) fast = r; else fails.push(`${r.cause}@${r.pct}%`);
    }
    let gems = 0;
    for (let i = 0; i < 3 && gems < 3; i++) {
      const r = await page.evaluate(([n]) => __playLevel(n, true, 150), [n]);
      if (r.win) gems = Math.max(gems, r.gems);
    }
    const reach = await page.evaluate(([n]) => __gemProbe(n), [n]);
    if (reach < 3) badGems.push(n);
    const p = fast ? Math.round(fast.t * 1.5 + 3) : 0;            // par: the bot is a sharp player, kids get slack
    par.push(p || '');
    if (!fast) bad.push(n);
    console.log(`${String(n).padStart(3)}  ${String(((n - 1) / 10 | 0) + 1).padStart(2)}   ${fast ? `ok ${fast.t}s / ${tries}` : 'FAIL ' + fails.join(' ')}`.padEnd(36) + `  ${gems}/3       ${reach}/3       ${p || '-'}`);
  }
  console.log('\nunfinished:', bad.length ? bad.join(', ') : 'none');
  console.log('levels with an unreachable crystal:', badGems.length ? badGems.join(', ') : 'none');
  if (errors.length) console.log('page errors:', errors);
  if (from === 1 && to === 100) console.log(`\nconst LV_PAR = '${par.join(',')}';`);
  await browser.close();
})();
