/* app.phase2.js — Phase 2: Coach, Goals, Community
   Depends on app.core.js, app.workouts.js, app.analytics.js
*/
(function () {
  const { $, $$, fmt, todayISO, parseNum, state, write, read, KEYS, emit, on } =
    window.LL;

  // ---------------------------------------
  // AI WORKOUT GENERATOR (rule-based)
  // ---------------------------------------
  const TEMPLATES = {
    strength: {
      barbell: [
        'Squat 5x5',
        'Bench Press 5x5',
        'Deadlift 3x5',
        'Overhead Press 5x5'
      ],
      dumbbells: [
        'Goblet Squat 4x10',
        'DB Bench 4x8',
        'DB Row 4x10',
        'DB Shoulder Press 4x8'
      ],
      minimal: ['Push-up 4x15', 'Pull-up 3x10', 'Lunge 3x12', 'Plank 3x60s']
    },
    loss: {
      barbell: [
        'Front Squat 4x8',
        'Bench Press 4x10',
        'Deadlift 3x8',
        'Row 4x10',
        'Bike 15min HIIT'
      ],
      dumbbells: [
        'DB Lunge 3x12',
        'DB Incline Press 3x10',
        'DB Deadlift 3x12',
        'Jump Rope 5min ×3'
      ],
      minimal: [
        'Bodyweight Squat 4x20',
        'Push-up 4x15',
        'Jumping Jacks 3x60s',
        'Mountain Climbers 3x30s'
      ]
    },
    general: {
      barbell: [
        'Squat 3x8',
        'Bench Press 3x8',
        'Deadlift 3x5',
        'Row 3x10',
        'Pull-up 3x8'
      ],
      dumbbells: [
        'DB Squat 3x10',
        'DB Bench 3x10',
        'DB Row 3x12',
        'DB Curl 3x12'
      ],
      minimal: [
        'Push-up 3x15',
        'Air Squat 3x20',
        'Plank 3x60s',
        'Crunch 3x20'
      ]
    }
  };

  function genPlan() {
    const goal = $('#coachGoal')?.value || 'general';
    const equip = $('#coachEquip')?.value || 'barbell';
    const days = parseNum($('#coachDays')?.value) || 4;

    const arr = [];
    for (let i = 0; i < days; i++) {
      const t = (TEMPLATES[goal] || TEMPLATES.general)[equip] || [];
      arr.push({ day: i + 1, list: t });
    }
    state.plan = { goal, equip, days, created: todayISO(), arr };
    write(KEYS.plan, state.plan);
    renderPlanPreview();
    alert('New week plan generated.');
  }

  function renderPlanPreview() {
    const el = $('#planOut');
    if (!el) return;
    const p = state.plan;
    if (!p) {
      el.innerHTML = 'No plan yet.';
      return;
    }
    el.innerHTML = `<p><strong>Goal:</strong> ${p.goal}, <strong>Equipment:</strong> ${p.equip}, <strong>Days:</strong> ${p.days}/wk</p>` +
      p.arr.map(
        (d) =>
          `<div><strong>Day ${d.day}:</strong> ${d.list.join(', ')}</div>`
      ).join('');
  }

  $('#genPlan')?.addEventListener('click', genPlan);
  $('#loadToday')?.addEventListener('click', () => {
    const p = state.plan;
    if (!p) return alert('No plan available.');
    const dayNum = new Date().getDay() % p.days || 1;
    alert(`Today’s Plan (Day ${dayNum}):\n\n${p.arr[dayNum - 1].list.join('\n')}`);
  });

  // Auto-refresh weekly
  (function autoRefreshPlan() {
    if (!state.plan?.created) return;
    const created = new Date(state.plan.created);
    const now = new Date();
    const diff = (now - created) / 86400000;
    if (diff > 7) genPlan();
  })();

  // ---------------------------------------
  // MUSCLE READINESS VISUAL
  // ---------------------------------------
  const GROUPS = ['Chest', 'Back', 'Legs', 'Arms', 'Core'];

  function calcReadiness() {
    const decay = 0.3; // 30% recovery/day
    const rec = {};
    GROUPS.forEach((g) => (rec[g] = 1.0)); // 1 = fresh

    state.workouts.forEach((w) => {
      const age = (new Date() - new Date(w.date)) / 86400000;
      const fatigue = Math.max(0, 1 - decay * age);
      (w.sets || []).forEach((s) => {
        const n = (s.name || '').toLowerCase();
        if (n.includes('bench') || n.includes('press')) rec.Chest = Math.min(rec.Chest, fatigue);
        if (n.includes('row') || n.includes('pull')) rec.Back = Math.min(rec.Back, fatigue);
        if (n.includes('squat') || n.includes('deadlift') || n.includes('lunge')) rec.Legs = Math.min(rec.Legs, fatigue);
        if (n.includes('curl') || n.includes('tricep') || n.includes('arm')) rec.Arms = Math.min(rec.Arms, fatigue);
        if (n.includes('plank') || n.includes('crunch') || n.includes('core')) rec.Core = Math.min(rec.Core, fatigue);
      });
    });
    return rec;
  }

  function renderReadiness() {
    const svg = $('#readiness');
    if (!svg) return;
    const rec = calcReadiness();
    svg.innerHTML = '';
    const colors = (p) => (p > 0.8 ? '#3fc29a' : p > 0.5 ? '#ffd43b' : '#ff6b6b');
    let x = 50;
    GROUPS.forEach((g) => {
      const pct = rec[g];
      svg.innerHTML += `<circle cx="${x}" cy="70" r="25" fill="${colors(pct)}" />
        <text x="${x}" y="120" fill="#b8b9c2" font-size="12" text-anchor="middle">${g}</text>`;
      x += 60;
    });
    const legend = $('#readinessLegend');
    if (legend) {
      legend.innerHTML = `
        <span><span class="legend-dot fresh"></span> Fresh</span>
        <span><span class="legend-dot moderate"></span> Moderate</span>
        <span><span class="legend-dot fatigued"></span> Fatigued</span>`;
    }
  }
  window.LL.renderReadiness = renderReadiness;

  // ---------------------------------------
  // GOALS (with progress + dashboard link)
  // ---------------------------------------
  function saveGoals() {
    const g = {
      weight: parseNum($('#gWeight')?.value),
      targetDate: $('#gDate')?.value,
      liftName: $('#gLiftName')?.value,
      lift1RM: parseNum($('#gLift1RM')?.value)
    };
    state.goals = g;
    write(KEYS.goals, g);
    updateGoalProgress();
    emit('goals:updated', g);
    alert('Goals saved.');
  }

  function updateGoalProgress() {
    const box = $('#goalsProgress');
    if (!box) return;

    const g = state.goals || {};
    if (!g.weight && !g.lift1RM) {
      box.innerHTML = '<p class="muted">No goals yet.</p>';
      return;
    }

    const rows = [];
    const last = state.metrics.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const weightNow = last?.weight ?? state.settings.weightLb;

    if (g.weight && g.targetDate) {
      const start = state.metrics[0]?.weight ?? weightNow;
      const total = g.weight - start;
      const delta = weightNow - start;
      const pct = total === 0 ? 100 : (delta / total) * 100;
      const days = Math.ceil((new Date(g.targetDate) - new Date()) / 86400000);
      rows.push(`<div><strong>Weight Goal:</strong> ${fmt(weightNow)} → ${fmt(g.weight)} lb (${pct.toFixed(0)}%)</div>
      <div class="muted">${days} days left</div>`);
      if (days <= 3) notifyGoal('Body Weight Goal almost due!');
    }

    if (g.liftName && g.lift1RM) {
      let best = 0;
      state.workouts.forEach((w) =>
        (w.sets || []).forEach((s) => {
          if ((s.name || '').toLowerCase() === g.liftName.toLowerCase() && s.weight && s.reps) {
            const est = s.weight * (1 + s.reps / 30);
            best = Math.max(best, est);
          }
        })
      );
      const pct = (best / g.lift1RM) * 100;
      rows.push(`<div><strong>${g.liftName}:</strong> ${fmt(best)} → ${fmt(g.lift1RM)} lb (${pct.toFixed(0)}%)</div>`);
      if (pct >= 95) notifyGoal(`${g.liftName} goal nearly achieved!`);
    }

    box.innerHTML = rows.join('<br>') || '<p>No goals.</p>';
  }

  window.LL.updateGoalProgress = updateGoalProgress;

  $('#saveGoals')?.addEventListener('click', saveGoals);

  async function notifyGoal(msg) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification('LiftLog', { body: msg });
  }

  // ---------------------------------------
  // COMMUNITY FEED (offline + share/import)
  // ---------------------------------------
  function renderFeed() {
    const feedEl = $('#feed');
    if (!feedEl) return;
    const comm = state.community;
    if (comm.optIn !== 'on') {
      feedEl.innerHTML = '<p class="muted">Feed is off. Enable opt-in above.</p>';
      return;
    }
    const list = comm.feed || [];
    feedEl.innerHTML =
      list
        .map(
          (p) =>
            `<div class="item"><span class="author">${p.name}</span>: ${p.msg}<br><small>${p.date}</small></div>`
        )
        .join('') || '<p>No posts yet.</p>';
  }
  window.LL.renderFeed = renderFeed;

  $('#cShare')?.addEventListener('click', () => {
    const comm = state.community;
    const code = btoa(JSON.stringify({ name: comm.name, feed: comm.feed }));
    navigator.clipboard.writeText(code);
    alert('Share code copied.');
  });

  $('#cImport')?.addEventListener('click', () => {
    try {
      const txt = $('#cImportText')?.value.trim();
      const data = JSON.parse(atob(txt));
      state.community.feed.push(...(data.feed || []));
      write(KEYS.community, state.community);
      renderFeed();
      alert('Imported successfully.');
    } catch {
      alert('Invalid code.');
    }
  });

  $('#cOptIn')?.addEventListener('change', (e) => {
    state.community.optIn = e.target.value;
    write(KEYS.community, state.community);
    renderFeed();
  });

  $('#cName')?.addEventListener('input', (e) => {
    state.community.name = e.target.value;
    write(KEYS.community, state.community);
  });

  // ---------------------------------------
  // INIT
  // ---------------------------------------
  function boot() {
    renderPlanPreview();
    renderReadiness();
    updateGoalProgress();
    renderFeed();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  on('panel:coach', () => {
    renderPlanPreview();
    renderReadiness();
  });
  on('panel:goals', updateGoalProgress);
  on('panel:community', renderFeed);
})();
