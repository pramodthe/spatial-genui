// Draws the paper's figures as inline SVG from window.DATA (data.js, written by analysis.py). Each figure is a
// <figure id="..."> with an empty <div class="plot">; draw() fills it. Colours are roles from paper.css.
(() => {
  const D = window.DATA;
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    ink: '#1d1d1b', soft: '#55534e', muted: '#8a8880', rule: '#cfccc4', grid: '#ebe9e3', paper: '#ffffff',
    code: '#2a78d6', a2ui: '#eb6834', tmpl: '#1baf7a', fill: '#f4f3ef', tint: '#e9f1fb',
  };
  const FONT = '"STIX Two Text", "Times New Roman", serif';

  function el(tag, attrs = {}, parent, text) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function svg(id, w, h, label) {
    const holder = document.querySelector(`#${id} .plot`);
    const root = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', role: 'img', 'aria-label': label, 'font-family': FONT, 'font-size': 10.5, fill: C.ink });
    holder.appendChild(root);
    return root;
  }
  const text = (g, x, y, s, o = {}) => el('text', { x, y, 'text-anchor': o.anchor ?? 'start', 'font-size': o.size, 'font-weight': o.weight, 'font-style': o.style, fill: o.fill ?? C.ink, 'dominant-baseline': o.base ?? 'alphabetic', ...(o.halo ? { stroke: C.paper, 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' } : {}) }, g, s);
  const line = (g, x1, y1, x2, y2, stroke = C.ink, width = 1, dash) => el('line', { x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-dasharray': dash, 'stroke-linecap': 'round' }, g);
  const tip = (node, s) => el('title', {}, node, s);
  const linear = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  const log = (d0, d1, r0, r1) => (v) => r0 + ((Math.log10(v) - Math.log10(d0)) / (Math.log10(d1) - Math.log10(d0))) * (r1 - r0);
  // Rounds half away from zero (toFixed alone turns 0.365 into 0.36), matching the text.
  const fmt = (v, n = 2) => (Math.sign(v) * (Math.round(Math.abs(v) * 10 ** n + 1e-9) / 10 ** n)).toFixed(n);
  const sec = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} s`;
  const MODEL = { 'claude-sonnet-5-5': 'Sonnet 5.5', 'muse-spark-1.3': 'Muse Spark 1.3', 'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash', 'kimi-k3.1-pro-fw': 'Kimi K3.1 Pro', 'muse-ember-1.0-max': 'Muse Ember 1.0' };

  // A box with up to four lines, the first one bold.
  function box(g, x, y, w, h, lines, o = {}) {
    el('rect', { x, y, width: w, height: h, rx: 5, fill: o.fill ?? C.paper, stroke: o.stroke ?? C.ink, 'stroke-width': o.strokeWidth ?? 1 }, g);
    const lh = 11.5;
    const top = y + h / 2 - ((lines.length - 1) * lh) / 2 + 3.5;
    lines.forEach((s, i) => text(g, x + w / 2, top + i * lh, s, { anchor: 'middle', weight: i === 0 ? 600 : undefined, size: i === 0 ? 10.5 : 9.5, fill: i === 0 ? C.ink : C.soft }));
  }
  function arrow(g, x1, y1, x2, y2, o = {}) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    line(g, x1, y1, x2 - 5 * Math.cos(a), y2 - 5 * Math.sin(a), o.stroke ?? C.ink, o.width ?? 1, o.dash);
    const p = (r, t) => `${x2 - r * Math.cos(a + t)},${y2 - r * Math.sin(a + t)}`;
    el('polygon', { points: `${x2},${y2} ${p(7, 0.42)} ${p(7, -0.42)}`, fill: o.stroke ?? C.ink }, g);
  }

  // Figure 1: the two tiers and the host's two modes.
  function overview() {
    const W = 640, H = 262;
    const s = svg('fig-overview', W, H, 'System overview');
    const bw = 92, bh = 74, gap = 18;
    const xs = [0, 1, 2, 3, 4].map((i) => 8 + i * (bw + gap));
    const y1 = 30, y2 = 164;
    text(s, 8, 16, 'Game tier: a coding agent builds a full game (median 13.1 min)', { weight: 600, size: 10.5 });
    text(s, 8, 150, 'Lesson tier: one model call writes a hands-on scene (median 27.6 s)', { weight: 600, size: 10.5 });
    box(s, xs[0], y1, bw, bh, ['Request', 'spoken to Muse', 'or typed'], { fill: C.fill });
    box(s, xs[1], y1, bw, bh, ['Design', 'one call: idea, rules,', 'desk or world,', '2 plan pictures']);
    box(s, xs[2], y1, bw, bh, ['Coder agent', 'sandbox, skills,', 'edits game.js,', 'checks, play-tests']);
    box(s, xs[3], y1, bw, bh, ['Grader', 'rubric against', 'the plan; one', 'send-back']);
    box(s, xs[0], y2, bw, bh, ['Request', 'spoken to Muse', 'or typed'], { fill: C.fill });
    box(s, xs[1], y2, bw * 2 + gap, bh, ['One-call writer', 'system prompt + request', 'returns one module', '(build function)']);
    // The game tier's gate runs inside the agent (its check script) and again on the server: drawn as one gate box.
    box(s, xs[3], y2, bw, bh, ['Gate', 'static rules, glyphs,', 'strict dry run,', 'layout checker']);
    for (let i = 0; i < 3; i++) arrow(s, xs[i] + bw, y1 + bh / 2, xs[i + 1], y1 + bh / 2);
    arrow(s, xs[0] + bw, y2 + bh / 2, xs[1], y2 + bh / 2);
    arrow(s, xs[1] + bw * 2 + gap, y2 + bh / 2, xs[3], y2 + bh / 2);
    arrow(s, xs[3] + bw / 2, y1 + bh, xs[3] + bw / 2, y2);
    // Repair loop of the lesson tier.
    el('path', { d: `M ${xs[3] + 20} ${y2 + bh} C ${xs[3] + 20} ${y2 + bh + 20}, ${xs[1] + bw + 40} ${y2 + bh + 20}, ${xs[1] + bw + 40} ${y2 + bh + 4}`, fill: 'none', stroke: C.soft, 'stroke-dasharray': '3 2' }, s);
    el('polygon', { points: `${xs[1] + bw + 40},${y2 + bh} ${xs[1] + bw + 36.5},${y2 + bh + 7} ${xs[1] + bw + 43.5},${y2 + bh + 7}`, fill: C.soft }, s);
    text(s, xs[3] + 28, y2 + bh + 14, 'gate error sent back (up to 2 repairs)', { size: 9, fill: C.soft, style: 'italic' });
    // Host with its two modes.
    const hx = xs[4], hw = W - 8 - hx;
    el('rect', { x: hx, y: y1, width: hw, height: y2 + bh - y1, rx: 6, fill: C.tint, stroke: C.ink }, s);
    text(s, hx + hw / 2, y1 + 18, 'Headset host (WebXR)', { anchor: 'middle', weight: 600 });
    text(s, hx + hw / 2, y1 + 31, 'mounts the module', { anchor: 'middle', size: 9.5, fill: C.soft });
    box(s, hx + 10, y1 + 44, hw - 20, 74, ['Desk mode', 'mixed reality,', 'passthrough; placed', 'on a detected table']);
    box(s, hx + 10, y1 + 128, hw - 20, 74, ['World mode', 'full VR; built in desk', 'units, shown 12x,', 'walk, teleport, turn']);
    arrow(s, xs[3] + bw, y2 + bh / 2, hx, y2 + bh / 2);
  }

  // Figure 2: where a game appears in each mode (side views, to scale within each panel).
  function geometry() {
    const W = 640, H = 274;
    const s = svg('fig-geometry', W, H, 'Desk and world placement');
    // (a) Desk: 1 m = 150 px.
    const a = el('g', {}, s);
    const m = 150, floor = 238, eyeX = 46, eyeY = floor - 1.2 * m;
    text(a, 4, 14, '(a) Desk mode: seated, mixed reality', { weight: 600 });
    line(a, 4, floor, 300, floor, C.rule, 1);
    // Seated person and chair.
    el('circle', { cx: eyeX - 6, cy: eyeY - 2, r: 11, fill: C.paper, stroke: C.ink }, a);
    line(a, eyeX - 8, eyeY + 9, eyeX - 14, floor - 0.47 * m, C.ink, 1.2);
    line(a, eyeX - 14, floor - 0.47 * m, eyeX + 34, floor - 0.47 * m, C.ink, 1.2);
    line(a, eyeX + 34, floor - 0.47 * m, eyeX + 34, floor, C.ink, 1.2);
    line(a, eyeX - 9, eyeY + 26, eyeX + 40, eyeY + 52, C.ink, 1.2);
    el('rect', { x: eyeX - 30, y: floor - 0.47 * m, width: 26, height: 4, fill: C.muted }, a);
    line(a, eyeX - 26, floor - 0.47 * m, eyeX - 26, floor, C.muted, 1.5);
    line(a, eyeX - 30, floor - 0.47 * m, eyeX - 34, floor - 0.95 * m, C.muted, 1.5);
    // Table (the detected plane), 0.45 m below the eyes.
    const tableY = eyeY + 0.45 * m;
    el('rect', { x: eyeX + 0.25 * m, y: tableY, width: 0.75 * m, height: 5, fill: C.soft }, a);
    line(a, eyeX + 0.95 * m, tableY + 5, eyeX + 0.95 * m, floor, C.soft, 1.5);
    // Accepted reach on the plane: 0.3 to 0.9 m ahead.
    el('rect', { x: eyeX + 0.3 * m, y: tableY - 3, width: 0.6 * m, height: 3, fill: C.code, opacity: 0.35 }, a);
    // The game, at the comfortable reach.
    el('rect', { x: eyeX + 0.55 * m - 14, y: tableY - 24, width: 28, height: 21, rx: 3, fill: C.code, stroke: C.ink }, a);
    text(a, eyeX + 0.55 * m, tableY - 29, 'game', { anchor: 'middle', size: 9.5 });
    line(a, eyeX, eyeY, eyeX + 0.55 * m - 14, tableY - 14, C.soft, 1, '3 2');
    // Dimensions.
    const dimY = eyeY - 16;
    line(a, eyeX, dimY, eyeX + 0.55 * m, dimY, C.ink, 0.8);
    line(a, eyeX, dimY - 4, eyeX, dimY + 4, C.ink, 0.8);
    line(a, eyeX + 0.55 * m, dimY - 4, eyeX + 0.55 * m, dimY + 4, C.ink, 0.8);
    text(a, eyeX + 0.275 * m + 8, dimY - 5, 'd* = 0.55 m', { anchor: 'middle', size: 9.5 });
    line(a, eyeX + 1.08 * m, eyeY, eyeX + 1.08 * m, tableY, C.ink, 0.8);
    line(a, eyeX + 1.04 * m, eyeY, eyeX + 1.12 * m, eyeY, C.ink, 0.8);
    line(a, eyeX + 1.04 * m, tableY, eyeX + 1.12 * m, tableY, C.ink, 0.8);
    line(a, eyeX, eyeY, eyeX + 1.04 * m, eyeY, C.rule, 0.8, '2 2');
    text(a, eyeX + 1.13 * m, (eyeY + tableY) / 2 - 4, 'surface 0.15 to', { size: 9 });
    text(a, eyeX + 1.13 * m, (eyeY + tableY) / 2 + 7, '0.9 m below eyes', { size: 9 });
    text(a, eyeX + 0.21 * m, tableY + 17, 'accepted: 0.3 to 0.9 m', { size: 9, fill: C.soft });
    text(a, eyeX + 0.21 * m, tableY + 28, 'ahead, within 50° of gaze;', { size: 9, fill: C.soft });
    text(a, eyeX + 0.21 * m, tableY + 39, 'beds and sofas skipped', { size: 9, fill: C.soft });
    text(a, 150, floor + 16, 'No table found: 0.55 m ahead, 0.35 m below the eyes', { anchor: 'middle', size: 9, fill: C.soft, style: 'italic' });

    // (b) World: 1 m = 62 px; the module is built in desk units and shown 12 times bigger.
    const b = el('g', { transform: 'translate(330,0)' }, s);
    const n = 62, fl = 238, px = 36, eye = fl - 1.6 * n;
    text(b, 0, 14, '(b) World mode: standing, full VR', { weight: 600 });
    text(b, 0, 30, 'Orange fan: the first view checked for blocking (pitch −45° to +10°,', { size: 9, fill: C.soft });
    text(b, 0, 41, 'yaw ±35°, within 1.5 m). Blue band: comfortable hand reach.', { size: 9, fill: C.soft });
    el('rect', { x: 0, y: fl, width: 306, height: 6, fill: '#dfe9d6' }, b);
    // Far hills.
    el('path', { d: `M 150 ${fl} Q 205 ${fl - 70} 250 ${fl - 30} Q 280 ${fl - 55} 306 ${fl - 20} L 306 ${fl} Z`, fill: '#eef2e8', stroke: C.rule }, b);
    // Reach band for hand targets: 0.48 to 1.56 m above the ground.
    el('rect', { x: px + 14, y: fl - 1.56 * n, width: 150, height: (1.56 - 0.48) * n, fill: C.code, opacity: 0.12 }, b);
    text(b, px + 160, fl - 0.48 * n - 5, '0.48 to 1.56 m', { anchor: 'end', size: 9, fill: C.soft });
    // Start clearance: 0.42 m around the feet.
    el('rect', { x: px - 0.42 * n, y: fl - 3, width: 0.84 * n, height: 3, fill: C.a2ui }, b);
    text(b, px, fl + 16, 'start clear: 0.42 m', { anchor: 'middle', size: 9, fill: C.soft });
    // Player.
    el('circle', { cx: px, cy: eye - 4, r: 10, fill: C.paper, stroke: C.ink }, b);
    line(b, px, eye + 6, px, fl - 0.85 * n, C.ink, 1.2);
    line(b, px, fl - 0.85 * n, px - 9, fl, C.ink, 1.2);
    line(b, px, fl - 0.85 * n, px + 9, fl, C.ink, 1.2);
    line(b, px, eye + 18, px + 20, eye + 40, C.ink, 1.2);
    // First-view fan: pitch -45 to +10 degrees, near zone 1.5 m.
    const r = 1.5 * n;
    const ray = (deg) => [px + r * Math.cos((deg * Math.PI) / 180), eye - r * Math.sin((deg * Math.PI) / 180)];
    const [ax, ay] = ray(10), [bx, by] = ray(-45);
    el('path', { d: `M ${px} ${eye} L ${ax} ${ay} A ${r} ${r} 0 0 1 ${bx} ${by} Z`, fill: C.a2ui, opacity: 0.12, stroke: C.a2ui, 'stroke-width': 0.8 }, b);
    // A sign, with its angular size.
    const sx = 250, sh = 0.9 * n, sy = fl - 1.2 * n;
    el('rect', { x: sx, y: sy - sh / 2, width: 5, height: sh, fill: C.ink }, b);
    line(b, sx + 2.5, sy + sh / 2, sx + 2.5, fl, C.ink, 1);
    line(b, px, eye, sx, sy - sh / 2, C.soft, 0.8, '2 2');
    line(b, px, eye, sx, sy + sh / 2, C.soft, 0.8, '2 2');
    text(b, sx + 2, sy - sh / 2 - 7, 'sign: θ < 16°', { anchor: 'middle', size: 9, fill: C.soft });
    // A grabbable at hand height.
    el('circle', { cx: px + 1.0 * n, cy: fl - 1.0 * n, r: 6, fill: C.code, stroke: C.ink }, b);
    text(b, px + 1.0 * n + 9, fl - 1.0 * n + 3, 'hand target', { size: 9 });
    text(b, 150, fl + 29, 'Built in desk units, shown 12x around the player', { anchor: 'middle', size: 9, fill: C.soft, style: 'italic' });
  }

  // Figure 3: quality and time per output format (RQ1).
  function formats() {
    const W = 640, H = 236;
    const s = svg('fig-formats', W, H, 'Quality and time per output format');
    const arms = D.rq1.arms;
    const groups = [['A-code', 'Open code (A)', C.code], ['C-a2ui', 'Declarative A2UI (C)', C.a2ui], ['D-template', 'Controlled templates (D)', C.tmpl]];
    const rows = [];
    let y = 34;
    for (const [key, name, colour] of groups) {
      rows.push({ header: name, y });
      y += 15;
      for (const model of ['Sonnet', 'Ember']) {
        rows.push({ arm: arms[`${model}·${key}`], label: model === 'Sonnet' ? 'Sonnet 5.5' : 'Muse Ember 1.0', colour, y });
        y += 19;
      }
      y += 6;
    }
    const qx = linear(2.6, 4.6, 168, 388);
    const tx = log(4, 200, 430, 628);
    text(s, 168, 14, 'Quality (1 to 5), mean and 95% CI', { weight: 600 });
    text(s, 430, 14, 'Seconds per scene (log scale)', { weight: 600 });
    const axisY = y + 2;
    for (const v of [2.6, 3.0, 3.4, 3.8, 4.2, 4.6]) {
      line(s, qx(v), 24, qx(v), axisY, C.grid);
      text(s, qx(v), axisY + 13, fmt(v, 1), { anchor: 'middle', size: 9.5, fill: C.soft });
    }
    for (const v of [5, 10, 20, 50, 100, 200]) {
      line(s, tx(v), 24, tx(v), axisY, C.grid);
      text(s, tx(v), axisY + 13, String(v), { anchor: 'middle', size: 9.5, fill: C.soft });
    }
    for (const r of rows) {
      if (r.header) {
        text(s, 4, r.y + 8, r.header, { weight: 600, size: 10 });
        continue;
      }
      const a = r.arm, cy = r.y + 4;
      text(s, 14, cy + 3.5, r.label, { size: 10 });
      line(s, qx(a.qualityCI[0]), cy, qx(a.qualityCI[1]), cy, r.colour, 2);
      const dot = el('circle', { cx: qx(a.quality), cy, r: 4.5, fill: r.colour, stroke: C.paper, 'stroke-width': 1.5 }, s);
      tip(dot, `${r.label}: ${fmt(a.quality)} [${fmt(a.qualityCI[0])}, ${fmt(a.qualityCI[1])}]`);
      text(s, qx(a.qualityCI[1]) + 6, cy + 3.5, fmt(a.quality), { size: 9.5, fill: C.soft });
      a.latencyS.forEach((v, i) => el('circle', { cx: tx(Math.max(4, v)), cy: cy + ((i % 3) - 1) * 2.4, r: 2, fill: r.colour, opacity: 0.45 }, s));
      line(s, tx(a.medianS), cy - 7, tx(a.medianS), cy + 7, C.ink, 1.6);
      text(s, tx(a.medianS) + 4, cy - 5, sec(a.medianS), { size: 9, fill: C.ink, halo: true });
    }
  }

  // Figure 4: the same five models before and after the system changes (RQ2).
  function system() {
    const W = 640, H = 206;
    const s = svg('fig-system', W, H, 'Quality before and after the system changes');
    const fair = D.rq2.fair, before = D.rq2.before;
    const models = Object.keys(fair).sort((m1, m2) => before[m1] - before[m2]);
    const x = linear(3.7, 4.4, 150, 560);
    const top = 26, step = 22;
    const bottom = top + models.length * step;
    for (const v of [3.7, 3.8, 3.9, 4.0, 4.1, 4.2, 4.3, 4.4]) {
      line(s, x(v), top - 6, x(v), bottom, C.grid);
      text(s, x(v), bottom + 13, fmt(v, 1), { anchor: 'middle', size: 9.5, fill: C.soft });
    }
    text(s, x(4.05), bottom + 27, 'Quality (1 to 5, failures scored 1), same 12 requests x 2', { anchor: 'middle', size: 9.5, fill: C.soft });
    models.forEach((m, i) => {
      const y = top + i * step + 6;
      text(s, 140, y + 3.5, MODEL[m], { anchor: 'end', size: 10 });
      line(s, x(before[m]), y, x(fair[m].quality), y, C.muted, 1.5);
      el('circle', { cx: x(before[m]), cy: y, r: 4, fill: C.paper, stroke: C.soft, 'stroke-width': 1.5 }, s);
      const after = el('circle', { cx: x(fair[m].quality), cy: y, r: 4.5, fill: C.code, stroke: C.paper, 'stroke-width': 1.5 }, s);
      tip(after, `${MODEL[m]}: ${fmt(before[m])} to ${fmt(fair[m].quality)}`);
      text(s, x(fair[m].quality) + 8, y + 3.5, `+${fmt(fair[m].quality - before[m])}`, { size: 9.5, fill: C.soft });
    });
    // Legend.
    el('circle', { cx: 160, cy: 10, r: 4, fill: C.paper, stroke: C.soft, 'stroke-width': 1.5 }, s);
    text(s, 168, 13.5, 'original system (runs 1 and 2)', { size: 9.5 });
    el('circle', { cx: 340, cy: 10, r: 4.5, fill: C.code }, s);
    text(s, 348, 13.5, 'improved system (run 4)', { size: 9.5 });
    // Spread brackets.
    const spread = (lo, hi, y, label) => {
      line(s, x(lo), y, x(hi), y, C.ink, 1);
      line(s, x(lo), y - 3, x(lo), y + 3, C.ink, 1);
      line(s, x(hi), y - 3, x(hi), y + 3, C.ink, 1);
      text(s, x(hi) + 6, y + 3.5, label, { size: 9.5 });
    };
    const b = Object.values(before), f = Object.values(fair).map((a) => a.quality);
    text(s, 140, bottom + 43.5, 'Spread, original', { anchor: 'end', size: 9.5, fill: C.soft });
    spread(Math.min(...b), Math.max(...b), bottom + 40, fmt(D.rq2.spread.before));
    text(s, 140, bottom + 59.5, 'Spread, improved', { anchor: 'end', size: 9.5, fill: C.soft });
    spread(Math.min(...f), Math.max(...f), bottom + 56, fmt(D.rq2.spread.after));
  }

  // Figure 5: quality against time per model, simple requests (run 4) and complex apps (run 5).
  function speed() {
    const W = 640, H = 236;
    const s = svg('fig-speed', W, H, 'Quality against time per model');
    const x = log(20, 400, 70, 600), y = linear(3.5, 4.4, 200, 22);
    for (const v of [20, 50, 100, 200, 400]) {
      line(s, x(v), 18, x(v), 200, C.grid);
      text(s, x(v), 214, String(v), { anchor: 'middle', size: 9.5, fill: C.soft });
    }
    for (const v of [3.5, 3.7, 3.9, 4.1, 4.3]) {
      line(s, 70, y(v), 600, y(v), C.grid);
      text(s, 64, y(v) + 3.5, fmt(v, 1), { anchor: 'end', size: 9.5, fill: C.soft });
    }
    text(s, 335, 230, 'Median seconds per scene (log scale)', { anchor: 'middle', size: 9.5, fill: C.soft });
    el('text', { x: 14, y: 111, transform: 'rotate(-90 14 111)', 'text-anchor': 'middle', 'font-size': 9.5, fill: C.soft }, s, 'Quality (1 to 5)');
    const fair = D.rq2.fair, hard = D.rq2.hard;
    const short = { 'claude-sonnet-5-5': 'Sonnet', 'muse-spark-1.3': 'Spark', 'deepseek-v4.1-flash': 'DeepSeek', 'kimi-k3.1-pro-fw': 'Kimi', 'muse-ember-1.0-max': 'Ember' };
    // Label offsets [dx, dy] chosen so no two labels overlap.
    const at4 = { 'muse-ember-1.0-max': [-6, -9, 'end'], 'claude-sonnet-5-5': [0, -10, 'middle'], 'deepseek-v4.1-flash': [8, 13, 'start'], 'muse-spark-1.3': [0, -10, 'middle'], 'kimi-k3.1-pro-fw': [8, -6, 'start'] };
    const at5 = { 'muse-ember-1.0-max': [8, 4, 'start'], 'claude-sonnet-5-5': [-8, -6, 'end'], 'deepseek-v4.1-flash': [8, 4, 'start'], 'muse-spark-1.3': [-8, 4, 'end'], 'kimi-k3.1-pro-fw': [8, 4, 'start'] };
    for (const m of Object.keys(fair)) line(s, x(fair[m].medianS), y(fair[m].quality), x(hard[m].medianS), y(hard[m].quality), C.rule, 1, '3 2');
    for (const [set, colour, at] of [[fair, C.code, at4], [hard, C.a2ui, at5]]) {
      for (const m of Object.keys(set)) {
        const p = el('circle', { cx: x(set[m].medianS), cy: y(set[m].quality), r: 4.5, fill: colour, stroke: C.paper, 'stroke-width': 1.5 }, s);
        tip(p, `${MODEL[m]}: ${fmt(set[m].quality)} at ${sec(set[m].medianS)}`);
        const [dx, dy, anchor] = at[m];
        text(s, x(set[m].medianS) + dx, y(set[m].quality) + dy, short[m], { anchor, size: 9.5 });
      }
    }
    el('rect', { x: 78, y: 160, width: 196, height: 34, fill: C.paper }, s);
    el('circle', { cx: 86, cy: 170, r: 4.5, fill: C.code }, s);
    text(s, 94, 173.5, 'held-out requests (run 4, n = 24 each)', { size: 9.5 });
    el('circle', { cx: 86, cy: 186, r: 4.5, fill: C.a2ui }, s);
    text(s, 94, 189.5, 'complex apps (run 5, n = 12 each)', { size: 9.5 });
  }

  // Figure 6: when content appears, one-shot against parallel builders (RQ4).
  function streaming() {
    const W = 640, H = 176;
    const s = svg('fig-stream', W, H, 'Time to content, one-shot and parallel');
    const x = linear(0, 55, 150, 560);
    const rows = [];
    for (const model of ['Sonnet', 'Ember']) {
      const r = D.rq4[model];
      rows.push({ label: `${model === 'Sonnet' ? 'Sonnet 5.5' : 'Muse Ember 1.0'}, one-shot`, full: r.oneShot.fullS, q: r.oneShot.quality });
      rows.push({ label: 'parallel builders', full: r.parallel.fullS, plan: r.placeholdersS, first: r.firstContentS, q: r.parallel.quality });
    }
    const top = 30, step = 26, bottom = top + rows.length * step + 6;
    for (const v of [0, 10, 20, 30, 40, 50]) {
      line(s, x(v), top - 8, x(v), bottom, C.grid);
      text(s, x(v), bottom + 13, String(v), { anchor: 'middle', size: 9.5, fill: C.soft });
    }
    text(s, x(27.5), bottom + 27, 'Seconds from request (medians over working scenes)', { anchor: 'middle', size: 9.5, fill: C.soft });
    text(s, 600, top - 12, 'Quality', { anchor: 'middle', size: 9.5, weight: 600 });
    rows.forEach((r, i) => {
      const y = top + i * step;
      text(s, 140, y + 12, r.label, { anchor: 'end', size: 10 });
      if (r.plan === undefined) {
        el('rect', { x: x(0), y: y + 3, width: x(r.full) - x(0), height: 12, rx: 2, fill: C.code }, s);
        text(s, x(r.full) + 5, y + 13, sec(r.full), { size: 9.5 });
      } else {
        el('rect', { x: x(0), y: y + 3, width: x(r.plan) - x(0), height: 12, rx: 2, fill: C.rule }, s);
        el('rect', { x: x(r.plan) + 1, y: y + 3, width: x(r.first) - x(r.plan) - 1, height: 12, fill: '#f7c2ac' }, s);
        el('rect', { x: x(r.first) + 1, y: y + 3, width: x(r.full) - x(r.first) - 1, height: 12, rx: 2, fill: C.a2ui }, s);
        el('polygon', { points: `${x(r.plan)},${y - 1} ${x(r.plan) + 4},${y + 3} ${x(r.plan)},${y + 7} ${x(r.plan) - 4},${y + 3}`, fill: C.ink }, s);
        el('circle', { cx: x(r.first), cy: y + 3, r: 3.5, fill: C.ink }, s);
        text(s, x(r.full) + 5, y + 13, sec(r.full), { size: 9.5 });
      }
      text(s, 600, y + 13, fmt(r.q), { anchor: 'middle', size: 9.5 });
    });
    // Legend.
    el('polygon', { points: '152,5 156,9 152,13 148,9', fill: C.ink }, s);
    text(s, 161, 12.5, 'placeholders shown', { size: 9.5 });
    el('circle', { cx: 270, cy: 9, r: 3.5, fill: C.ink }, s);
    text(s, 277, 12.5, 'first real part', { size: 9.5 });
    el('rect', { x: 360, y: 4, width: 14, height: 10, fill: C.rule }, s);
    text(s, 378, 12.5, 'planning', { size: 9.5 });
    el('rect', { x: 430, y: 4, width: 14, height: 10, fill: C.a2ui }, s);
    text(s, 448, 12.5, 'parts streaming in', { size: 9.5 });
  }

  // Figure 7: which hand interactions landed, by where the content came from (emulator).
  function matrix() {
    const W = 640, H = 316;
    const s = svg('fig-matrix', W, H, 'Hand interaction matrix');
    const M = D.matrix;
    const left = 190, cw = (W - left - 6) / M.sources.length, ch = 19, top = 40;
    const heads = [['Hand-', 'written'], ['Open code', '(course)'], ['Course', 'model GLB'], ['Library', 'GLB'], ['A2UI', '(C)'], ['Templates', '(D)']];
    heads.forEach((h, j) => {
      text(s, left + j * cw + cw / 2, 14, h[0], { anchor: 'middle', size: 9.5, weight: 600 });
      text(s, left + j * cw + cw / 2, 26, h[1], { anchor: 'middle', size: 9.5, weight: 600 });
    });
    const shade = (r) => {
      const lo = [233, 241, 251], hi = [28, 90, 166];
      const k = Math.pow(r, 1.6);
      return `rgb(${lo.map((c, i) => Math.round(c + (hi[i] - c) * k)).join(',')})`;
    };
    M.rows.forEach((row, i) => {
      const y = top + i * ch;
      text(s, left - 8, y + 13, row.name, { anchor: 'end', size: 10 });
      row.cells.forEach((c, j) => {
        const x = left + j * cw;
        if (!c) {
          el('rect', { x: x + 1, y: y + 1, width: cw - 2, height: ch - 2, fill: C.paper, stroke: C.grid }, s);
          text(s, x + cw / 2, y + 13, '-', { anchor: 'middle', size: 9.5, fill: C.muted });
          return;
        }
        const rate = c[0] / c[1];
        const cell = el('rect', { x: x + 1, y: y + 1, width: cw - 2, height: ch - 2, fill: shade(rate) }, s);
        tip(cell, `${row.name}, ${M.sources[j]}: ${c[0]} of ${c[1]}`);
        text(s, x + cw / 2, y + 13, `${c[0]} / ${c[1]}`, { anchor: 'middle', size: 9.5, fill: rate > 0.62 ? C.paper : C.ink });
      });
    });
    // Legend: the sequential ramp.
    const ly = top + M.rows.length * ch + 18;
    text(s, left - 8, ly + 9, 'Share that worked', { anchor: 'end', size: 9.5, fill: C.soft });
    text(s, left, ly + 9, '0', { anchor: 'middle', size: 9, fill: C.soft });
    for (let k = 0; k <= 10; k++) el('rect', { x: left + 8 + k * 18, y: ly, width: 18, height: 11, fill: shade(k / 10) }, s);
    text(s, left + 8 + 11 * 18 + 8, ly + 9, '1', { anchor: 'middle', size: 9, fill: C.soft });
  }

  // Figure 8: paired changes in the 35-game factor study.
  function factors() {
    const pairs = Object.entries(D.factors.pairs);
    const W = 640, H = 22 + pairs.length * 26 + 34;
    const s = svg('fig-factors', W, H, 'Factor study');
    const x = linear(-8, 5, 250, 600);
    const top = 22, step = 26, bottom = top + pairs.length * step;
    for (let v = -8; v <= 5; v += 2) {
      line(s, x(v), top - 6, x(v), bottom, v === 0 ? C.soft : C.grid, v === 0 ? 1 : 1);
      text(s, x(v), bottom + 13, v > 0 ? `+${v}` : String(v), { anchor: 'middle', size: 9.5, fill: C.soft });
    }
    text(s, x(-1.5), bottom + 27, 'Change in opening-view score (out of 20), same requests', { anchor: 'middle', size: 9.5, fill: C.soft });
    const mark = { 'river-dam': 'R', 'kite-world': 'K', 'canyon-water': 'C', 'paper-plane': 'P' };
    pairs.forEach(([name, p], i) => {
      const y = top + i * step + 6;
      const [factor, change] = name.split(': ');
      text(s, 6, y + 3.5, factor, { size: 10, weight: 600 });
      text(s, 128, y + 3.5, `${change} (n = ${p.n})`, { size: 10, fill: C.soft });
      const vals = Object.entries(p.diffs);
      const seen = {};
      for (const [req, d] of vals) {
        const k = (seen[d] = (seen[d] ?? -1) + 1);
        const cx = x(d), cy = y + (k ? (k % 2 ? -7 : 7) : 0);
        el('circle', { cx, cy, r: 5.5, fill: C.paper, stroke: C.muted }, s);
        text(s, cx, cy + 3, mark[req], { anchor: 'middle', size: 7.5, fill: C.soft });
      }
      el('polygon', { points: `${x(p.mean)},${y - 6} ${x(p.mean) + 5},${y} ${x(p.mean)},${y + 6} ${x(p.mean) - 5},${y}`, fill: C.ink }, s);
    });
    text(s, 600, 8, 'R river dam, K kite hill, C canyon, P paper plane; diamond = mean', { anchor: 'end', size: 9, fill: C.soft });
  }

  overview();
  geometry();
  formats();
  system();
  speed();
  streaming();
  matrix();
  factors();
  window.__figuresDone = true;
})();
