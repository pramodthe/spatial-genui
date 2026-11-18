// Fills the paper's tables from window.DATA (data.js), so every number in a table comes from analysis.py.
// Each table is a <table id="..."> with a <thead> written in paper.html; this fills its <tbody>.
(() => {
  const D = window.DATA;
  // Rounds half away from zero (toFixed alone turns 0.365 into 0.36) and writes a true minus sign.
  const round = (v, n) => (Math.round(Math.abs(v) * 10 ** n + 1e-9) / 10 ** n).toFixed(n);
  const num = (v, n = 2) => `${v < 0 && Number(round(v, n)) !== 0 ? '−' : ''}${round(v, n)}`;
  const f2 = (v) => (v === null || v === undefined ? '–' : num(v));
  const ci = (c) => `[${num(c[0])}, ${num(c[1])}]`;
  const s = (v) => `${round(v, 1)} s`;
  const frac = (p) => (p[1] ? `${p[0]}/${p[1]}` : '–');
  const pct = (p) => (p[1] ? `${Math.round((100 * p[0]) / p[1])}%` : '–');
  const usd = (v) => (v === null || v === undefined ? '–' : `$${round(v, 3)}`);
  const signed = (v) => `${v >= 0 ? '+' : '−'}${round(v, 2)}`;
  const MODEL = { 'claude-sonnet-5-5': ['Sonnet 5.5', 'Anthropic'], 'muse-spark-1.3': ['Muse Spark 1.3', 'Meta'], 'deepseek-v4.1-flash': ['DeepSeek V4.1 Flash', 'DeepSeek'], 'kimi-k3.1-pro-fw': ['Kimi K3.1 Pro', 'Moonshot'], 'muse-ember-1.0-max': ['Muse Ember 1.0', 'Meta'] };

  function fill(id, rows) {
    const body = document.querySelector(`#${id} tbody`);
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (row.className) tr.className = row.className;
      for (const cell of row.cells ?? row) {
        const td = document.createElement('td');
        td.innerHTML = cell;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  // Table 1: output formats (RQ1).
  const formats = { 'A-code': 'Open code (A)', 'C-a2ui': 'A2UI (C)', 'D-template': 'Templates (D)' };
  const rq1 = [];
  for (const model of ['Sonnet', 'Ember']) {
    for (const key of Object.keys(formats)) {
      const a = D.rq1.arms[`${model}·${key}`];
      rq1.push({ className: key === 'A-code' ? 'group' : '', cells: [
        key === 'A-code' ? (model === 'Sonnet' ? 'Sonnet 5.5' : 'Muse Ember 1.0') : '', formats[key],
        `${a.firstTry}/${a.n}`, `${a.success}/${a.n}`, pct(a.grab), pct(a.panelButtons),
        `<b>${f2(a.quality)}</b> <span class="ci">${ci(a.qualityCI)}</span>`, f2(a.rubric.fidelity), s(a.medianS),
        a.outputTokens.toLocaleString('en-US'), usd(a.costPerSuccess),
      ] });
    }
  }
  fill('tab-formats', rq1);

  // Table 2: five models on the improved system (run 4).
  const order = Object.keys(D.rq2.fair).sort((a, b) => D.rq2.fair[b].quality - D.rq2.fair[a].quality || D.rq2.fair[a].medianS - D.rq2.fair[b].medianS);
  fill('tab-models', order.map((m) => {
    const a = D.rq2.fair[m];
    return [MODEL[m][0], MODEL[m][1], f2(D.rq2.before[m]), `<b>${f2(a.quality)}</b> <span class="ci">${ci(a.qualityCI)}</span>`,
      f2(a.rubric.clarity), f2(a.rubric.handsOn), `${frac(a.panelButtons)} (${pct(a.panelButtons)})`,
      `${s(a.medianS)} <span class="ci">${a.iqrS[0].toFixed(0)}–${a.iqrS[1].toFixed(0)}</span>`, usd(a.costPerSuccess)];
  }));

  // Table 3: complex apps (run 5).
  const hard = Object.keys(D.rq2.hard).sort((a, b) => D.rq2.hard[b].quality - D.rq2.hard[a].quality);
  fill('tab-hard', hard.map((m) => {
    const a = D.rq2.hard[m];
    return [MODEL[m][0], `${a.success}/${a.n}`, `<b>${f2(a.quality)}</b> <span class="ci">${ci(a.qualityCI)}</span>`, f2(a.rubric.clarity),
      `${frac(a.panelButtons)} (${pct(a.panelButtons)})`, s(a.medianS), usd(a.costPerSuccess)];
  }));

  // Table 4: one-shot against parallel builders (RQ4).
  const stream = [];
  for (const model of ['Sonnet', 'Ember']) {
    const r = D.rq4[model];
    stream.push({ className: 'group', cells: [model === 'Sonnet' ? 'Sonnet 5.5' : 'Muse Ember 1.0', 'one-shot', `${r.oneShot.success}/${r.oneShot.n}`, `${r.oneShot.firstTry}`, '–',
      s(r.oneShot.fullS), s(r.oneShot.fullS), r.oneShot.outputTokens.toLocaleString('en-US'), f2(r.oneShot.quality), ''] });
    stream.push(['', 'parallel', `${r.parallel.success}/${r.parallel.n}`, `${r.parallel.firstTry}`, s(r.placeholdersS), `<b>${s(r.firstContentS)}</b>`, s(r.parallel.fullS),
      r.parallel.outputTokens.toLocaleString('en-US'), f2(r.parallel.quality), `${signed(r.qualityDelta.mean)}<br><span class="ci">${ci(r.qualityDelta.ci)}</span>`]);
  }
  fill('tab-stream', stream);

  // Table 5: 3D objects with named parts.
  const names = { 'p1-threejs': 'P1 three.js code (in the module)', 'p2-cadquery': 'P2 CadQuery (CAD kernel)', 'p3-blender': 'P3 Blender agent (MCP)' };
  fill('tab-3d', ['p1-threejs', 'p2-cadquery', 'p3-blender'].map((k) => {
    const p = D.threeD.pipelines[k];
    const d = k === 'p2-cadquery' ? D.threeD['P1-P2'] : k === 'p3-blender' ? D.threeD['P1-P3'] : null;
    return [names[k], `<b>${f2(p.overall)}</b>`, d ? `${signed(d.mean)} <span class="ci">${ci(d.ci)}</span>` : '–', s(p.medianS), p.triangles.toLocaleString('en-US'), String(p.meshes), '12/12'];
  }));

  // Table 6: the factor study's setups.
  const setups = Object.entries(D.factors.setups).sort((a, b) => b[1].score - a[1].score);
  const model = { 'gpt-6.1-sol': 'GPT-6.1 Sol', 'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash', 'claude-sonnet-5-5': 'Sonnet 5.5' };
  fill('tab-setups', setups.map(([k, v]) => [`<b>${k}</b>`, v.detail, model[v.model] ?? v.model, String(v.games), `<b>${v.score.toFixed(2)}</b>`, String(v.layoutFixes), v.buildMin.toFixed(1)]));
  window.__tablesDone = true;
})();
