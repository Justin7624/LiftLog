/* app.analytics.js — charts, projections, mini goals
   Depends on app.core.js (LL namespace) and Chart.js
*/
(function () {
  const {
    $, $$, fmt, parseNum, todayISO, state, KEYS, read, write, on, emit,
    calcBmrTdee
  } = window.LL;

  // ------------------------------
  // Chart helpers
  // ------------------------------
  const CHARTS = {};
  function makeChart(ctx, cfg) {
    if (!ctx) return null;
    if (CHARTS[ctx.id]) {
      CHARTS[ctx.id].destroy();
      delete CHARTS[ctx.id];
    }
    const inst = new Chart(ctx, cfg);
    CHARTS[ctx.id] = inst;
    return inst;
  }

  function lastMetrics() {
    if (!state.metrics.length) return null;
    return state.metrics
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }

  function latestWeightLb() {
    const m = lastMetrics();
    return m?.weight ?? state.settings.weightLb ?? null;
  }

  function heightInches() {
    const s = state.settings;
    return (s.heightFt || 0) * 12 + (s.heightIn || 0);
  }

  // ------------------------------
  // Volume per week chart
  // ------------------------------
  function buildVolumeWeek() {
    const weeks = {};
    state.workouts.forEach((w) => {
      const vol = (w.sets || []).reduce(
        (t, s) => t + (s.weight || 0) * (s.reps || 0),
        0
      );
      const dt = new Date(w.date + 'T00:00:00');
      const yearStart = new Date(dt.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((dt - yearStart) / 86400000) + 1;
      const wk = Math.ceil(dayOfYear / 7);
      const key = `${dt.getFullYear()}-${String(wk).padStart(2, '0')}`;
      weeks[key] = (weeks[key] || 0) + vol;
    });
    const labels = Object.keys(weeks).sort();
    const data = labels.map((k) => Math.round(weeks[k]));
    return { labels, data };
  }

  function renderVolumeChart() {
    const ctx = $('#chartVolume');
    if (!ctx) return;
    const { labels, data } = buildVolumeWeek();
    makeChart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'lb × reps', data }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { autoSkip: true } }, y: { beginAtZero: true } }
      }
    });
  }

  // ------------------------------
  // 1RM estimates chart
  // ------------------------------
  function epley1RM(weight, reps) {
    if (!weight || !reps) return 0;
    return weight * (1 + reps / 30);
  }

  function build1RMSeries() {
    // Aggregate by date: take max 1RM per day for key lifts
    const agg = {};
    state.workouts.forEach((w) => {
      (w.sets || []).forEach((s) => {
        const lift = (s.name || '').trim();
        if (!lift || !s.weight || !s.reps) return;
        const est = epley1RM(s.weight, s.reps);
        const key = `${lift}::${w.date}`;
        agg[key] = Math.max(agg[key] || 0, est);
      });
    });
    // Organize by lift
    const byLift = {};
    Object.entries(agg).forEach(([k, v]) => {
      const [lift, date] = k.split('::');
      (byLift[lift] = byLift[lift] || []).push({ x: date, y: Math.round(v) });
    });
    Object.values(byLift).forEach((arr) =>
      arr.sort((a, b) => a.x.localeCompare(b.x))
    );
    return byLift;
  }

  // Handles missing date adapter by falling back to category scale
  function render1RMChart() {
    const ctx = $('#chart1RM');
    if (!ctx) return;
    const byLift = build1RMSeries();

    // Detect if Chart.js date adapter is available
    const hasDateAdapter =
      !!Chart._adapters &&
      !!Chart._adapters._date &&
      typeof Chart._adapters._date.parse === 'function';

    if (hasDateAdapter) {
      const datasets = Object.keys(byLift)
        .slice(0, 5)
        .map((lift) => ({
          label: lift,
          data: byLift[lift], // [{x: 'yyyy-mm-dd', y: num}]
          parsing: false
        }));
      makeChart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true,
          plugins: { legend: { display: true, position: 'bottom' } },
          scales: { x: { type: 'time', time: { unit: 'week' } }, y: { beginAtZero: false } }
        }
      });
      return;
    }

    // Fallback: use category axis with unified date labels
    const allDatesSet = new Set();
    Object.values(byLift).forEach((arr) => arr.forEach((p) => allDatesSet.add(p.x)));
    const labels = Array.from(allDatesSet).sort();
    const datasets = Object.keys(byLift)
      .slice(0, 5)
      .map((lift) => {
        const map = Object.fromEntries(byLift[lift].map((p) => [p.x, p.y]));
        return { label: lift, data: labels.map((d) => map[d] ?? null) };
      });

    makeChart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: { legend: { display: true, position: 'bottom' } },
        scales: { x: { type: 'category' }, y: { beginAtZero: false } }
      }
    });
  }

  // ------------------------------
  // Body weight & BF% chart
  // ------------------------------
  function buildBodySeries() {
    const labels = [];
    const weight = [];
    const bf = [];
    const list = state.metrics
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    list.forEach((m) => {
      labels.push(m.date);
      weight.push(m.weight ?? null);
      bf.push(m.bodyFat ?? null);
    });
    return { labels, weight, bf };
  }

  function renderBodyChart() {
    const ctx = $('#chartBody');
    if (!ctx) return;
    const { labels, weight, bf } = buildBodySeries();
    makeChart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Weight (lb)', data: weight, yAxisID: 'y' },
          { label: 'Body Fat %', data: bf, yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true, position: 'bottom' } },
        scales: {
          y: { type: 'linear', position: 'left', beginAtZero: false },
          y1: {
            type: 'linear',
            position: 'right',
            beginAtZero: false,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  // ------------------------------
  // PR history chart
  // ------------------------------
  function buildPRs() {
    const best = {};
    state.workouts.forEach((w) => {
      (w.sets || []).forEach((s) => {
        if (!s.name || !s.weight) return;
        best[s.name] = Math.max(best[s.name] || 0, s.weight);
      });
    });
    const labels = Object.keys(best).sort();
    const data = labels.map((k) => best[k]);
    return { labels, data };
  }

  function renderPRChart() {
    const ctx = $('#chartPR');
    if (!ctx) return;
    const { labels, data } = buildPRs();
    makeChart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Best Set Weight (lb)', data }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        indexAxis: 'y',
        scales: { x: { beginAtZero: true } }
      }
    });
  }

  // ------------------------------
  // Weight projection (Calories tab)
  // ------------------------------
  function calcProjection(days = 70) {
    const s = state.settings;
    const startWeight = latestWeightLb();
    if (!startWeight) return null;

    // Estimate BMR/TDEE from settings height/age/sex + latest weight
    const hIn = heightInches();
    const heightCm = hIn * 2.54;
    const weightKg = startWeight * 0.453592;
    const { bmr } = calcBmrTdee(s.sex, s.age, heightCm, weightKg);

    // Activity multiplier from UI selection
    const mult = (() => {
      const lvl = $('#activityLevel')?.value || 'moderate';
      return {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        very: 1.725,
        athlete: 1.9
      }[lvl] || 1.55;
    })();

    const tdee = Math.round(bmr * mult);
    const cals = parseNum($('#caloriesInput')?.value) || tdee;

    const dailyBalance = cals - tdee;        // +surplus / -deficit
    const lbPerDay = dailyBalance / 3500;    // ~3500 kcal per lb

    const labels = [];
    const series = [];
    let w = startWeight;
    const start = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      labels.push(d.toISOString().slice(0, 10));
      series.push(Number(w.toFixed(2)));
      w += lbPerDay;
    }
    const endWeight = Number(series[series.length - 1].toFixed(2));
    const deltaLb = Number((endWeight - startWeight).toFixed(2)); // negative = loss
    const ratePerWeek = Number((lbPerDay * 7).toFixed(2));

    return { labels, series, tdee, startWeight, endWeight, deltaLb, ratePerWeek, days };
  }

  function renderProjection() {
    const box = $('#projectionBox');
    const ctx = $('#chartProj');
    if (!box || !ctx) return;

    const proj = calcProjection(70);
    if (!proj) {
      box.textContent =
        'Add weight in Body Metrics (or Settings) to estimate projections.';
      return;
    }

    const humanDelta =
      (proj.deltaLb < 0
        ? 'Estimated loss'
        : proj.deltaLb > 0
        ? 'Estimated gain'
        : 'No change') +
      ` over ${proj.days} days: <strong>${Math.abs(proj.deltaLb).toFixed(
        1
      )} lb</strong> (≈ ${
        proj.ratePerWeek < 0 ? '-' : proj.ratePerWeek > 0 ? '+' : ''
      }${Math.abs(proj.ratePerWeek).toFixed(1)} lb/week)`;

    box.innerHTML = `
      Projected trend based on <strong>${
        $('#caloriesInput')?.value || Math.round(proj.tdee)
      } kcal/day</strong>. Estimated TDEE:
      <strong>${Math.round(proj.tdee)} kcal</strong>.<br>
      ${humanDelta}.
    `;

    makeChart(ctx, {
      type: 'line',
      data: {
        labels: proj.labels,
        datasets: [{ label: 'Projected Weight (lb)', data: proj.series }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } }
      }
    });
  }

  $('#estimateWeight')?.addEventListener('click', renderProjection);

  // ------------------------------
  // Mini Goals widget (Dashboard)
  // ------------------------------
  function renderMiniGoals() {
    const el = $('#miniGoalsBox');
    if (!el) return;

    const g = state.goals || {};
    const latest = lastMetrics();
    const weightNow = latest?.weight ?? latestWeightLb();

    const rows = [];

    // Body weight goal
    if (g.weight && g.targetDate && weightNow != null) {
      const startWeight = state.metrics[0]?.weight ?? weightNow;
      const deltaTotal = g.weight - startWeight;
      const deltaNow = weightNow - startWeight;
      const pct =
        deltaTotal === 0
          ? 100
          : Math.max(0, Math.min(100, (deltaNow / deltaTotal) * 100));
      const daysLeft = Math.ceil(
        (new Date(g.targetDate) - new Date()) / 86400000
      );
      rows.push(`
        <div><strong>Body Weight:</strong> ${fmt(weightNow)} lb → ${fmt(
        g.weight
      )} lb</div>
        <div class="muted">Progress: ${
          isFinite(pct) ? pct.toFixed(0) : 0
        }% • ${daysLeft >= 0 ? daysLeft : 0} days left</div>
        <div style="height:8px; background:#1f2026; border-radius:999px; overflow:hidden; margin:.35rem 0">
          <div style="width:${Math.max(0, Math.min(100, pct))}%; height:100%"></div>
        </div>
      `);
    }

    // Multiple lift goals (show up to 2 for snapshot)
    if (state.goals?.lifts?.length) {
      const lifts = state.goals.lifts.slice(0, 2);

      // Build current best (Epley) map from history
      const bestMap = {};
      state.workouts.forEach((w) =>
        (w.sets || []).forEach((s) => {
          const nm = (s.name || '').trim().toLowerCase();
          if (nm && s.weight && s.reps) {
            const est = s.weight * (1 + s.reps / 30);
            bestMap[nm] = Math.max(bestMap[nm] || 0, est);
          }
        })
      );

      lifts.forEach(({ name, target1RM }) => {
        const key = (name || '').trim().toLowerCase();
        const best = Math.round(bestMap[key] || 0);
        const pct = Math.max(
          0,
          Math.min(100, (best / (target1RM || 1)) * 100)
        );
        rows.push(`
          <div><strong>${name} 1RM:</strong> ${fmt(best)} lb → ${fmt(
          target1RM
        )} lb</div>
          <div style="height:8px; background:#1f2026; border-radius:999px; overflow:hidden; margin:.35rem 0">
            <div style="width:${pct.toFixed(0)}%; height:100%"></div>
          </div>
        `);
      });
    }

    el.innerHTML = rows.length
      ? rows.join('')
      : '<p class="muted">Set goals in the Goals tab to see progress here.</p>';
  }

  // Expose
  window.LL.renderCharts = function renderCharts() {
    renderVolumeChart();
    render1RMChart();
    renderBodyChart();
    renderPRChart();
  };
  window.LL.renderMiniGoals = renderMiniGoals;

  // ------------------------------
  // Init
  // ------------------------------
  function boot() {
    window.LL.renderCharts();
    renderMiniGoals();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-render on panel switch
  on('panel:dashboard', () => {
    window.LL.renderCharts();
    renderMiniGoals();
  });

  on('panel:calories', renderProjection);

  // Lightweight re-renders after new data
  on('settings:changed', () => {
    // TDEE changes affect projections; charts refresh on dashboard open.
  });
})();
