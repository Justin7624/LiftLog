/* app.workouts.js — workouts, history, badges, dashboard
   Depends on app.core.js (LL namespace)
*/
(function () {
  const { $, $$, fmt, todayISO, parseNum, read, write, emit, on, state, KEYS } =
    window.LL;

  // ------------------------------
  // Local helpers
  // ------------------------------
  const uid = () => Math.random().toString(36).slice(2, 10);

  function epley1RM(weight, reps) {
    if (!weight || !reps) return 0;
    return weight * (1 + reps / 30);
  }

  function computePRs(withDates = false) {
    const map = {};
    state.workouts.forEach((w) => {
      (w.sets || []).forEach((s) => {
        if (!s.name || !s.weight) return;
        if (!map[s.name] || s.weight > map[s.name].weight) {
          map[s.name] = { weight: s.weight, date: w.date };
        }
      });
    });
    if (withDates) return map;
    const out = {};
    Object.keys(map).forEach((k) => (out[k] = map[k].weight));
    return out;
  }

  // Expose for other modules
  window.LL.epley1RM = epley1RM;
  window.LL.computePRs = computePRs;

  // ------------------------------
  // Workout editor
  // ------------------------------
  const setsBox = $('#sets');

  function addSetRow(superset = false, preset = {}) {
    if (!setsBox) return;
    const root = document.createElement('div');
    root.className = 'set' + (superset ? ' superset' : '');
    root.innerHTML = `
      <input placeholder="Exercise (e.g., Bench Press)" class="exName" value="${preset.name ?? ''}"/>
      <input type="number" step="1" placeholder="Reps" class="exReps" value="${preset.reps ?? ''}"/>
      <input type="number" step="0.5" placeholder="Weight (lb)" class="exWeight" value="${preset.weight ?? ''}"/>
      <input type="number" step="0.5" placeholder="RPE (opt)" class="exRPE" value="${preset.rpe ?? ''}"/>
      <button type="button" class="btn" data-del>Delete</button>
    `;
    root.querySelector('[data-del]').addEventListener('click', () =>
      root.remove()
    );
    setsBox.appendChild(root);
  }

  function initEditor() {
    if (!$('#workout')) return;

    $('#wDate') && ($('#wDate').value = todayISO());
    $('#addSet')?.addEventListener('click', () => addSetRow(false));
    $('#addSuperset')?.addEventListener('click', () => addSetRow(true));
    if (setsBox && !setsBox.children.length) addSetRow(false);

    $('#workoutForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const date = $('#wDate')?.value || todayISO();
      const title = $('#wTitle')?.value?.trim() || 'Workout';
      const notes = $('#wNotes')?.value?.trim() || '';

      const sets = $$('.set')
        .map((s) => ({
          name: s.querySelector('.exName')?.value?.trim(),
          reps: parseNum(s.querySelector('.exReps')?.value),
          weight: parseNum(s.querySelector('.exWeight')?.value),
          rpe: parseNum(s.querySelector('.exRPE')?.value)
        }))
        .filter((s) => s.name);

      if (!sets.length) return alert('Add at least one set');

      state.workouts.push({ id: uid(), date, title, notes, sets });
      write(KEYS.workouts, state.workouts);

      maybeAwardBadgesAfterSave();

      setsBox.innerHTML = '';
      $('#wTitle') && ($('#wTitle').value = '');
      $('#wNotes') && ($('#wNotes').value = '');
      addSetRow(false);

      renderHistory();
      window.LL.renderDashboard();
      window.LL.renderCharts();
      alert('Workout saved.');
    });

    $('#exportData')?.addEventListener('click', () => {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              workouts: state.workouts,
              metrics: state.metrics,
              settings: state.settings,
              badges: state.badges,
              goals: state.goals,
              community: state.community,
              plan: state.plan
            },
            null,
            2
          )
        ],
        { type: 'application/json' }
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'liftlog-export.json';
      a.click();
    });

    $('#clearAll')?.addEventListener('click', () => {
      if (!confirm('Clear ALL workouts & metrics? This cannot be undone.'))
        return;
      state.workouts = [];
      state.metrics = [];
      state.badges = {};
      state.goals = {};
      state.plan = null;
      state.community = { name: '', optIn: 'off', feed: [] };

      write(KEYS.workouts, state.workouts);
      write(KEYS.metrics, state.metrics);
      write(KEYS.badges, state.badges);
      write(KEYS.goals, state.goals);
      write(KEYS.plan, state.plan);
      write(KEYS.community, state.community);

      renderHistory();
      window.LL.renderMetrics();
      window.LL.renderDashboard();
      window.LL.renderCharts();
    });

    // quick nav
    $('#goLog')?.addEventListener('click', () =>
      document.querySelector('[data-tab="workout"]')?.click()
    );
  }

  // ------------------------------
  // History list
  // ------------------------------
  function renderHistory() {
    const listEl = $('#historyList');
    if (!listEl) return;

    const q = $('#historySearch')?.value?.toLowerCase()?.trim() || '';
    const list = state.workouts.slice().sort((a, b) => b.date.localeCompare(a.date));
    const out = list
      .filter((w) => {
        const hay = (
          w.title +
          ' ' +
          (w.notes || '') +
          ' ' +
          (w.sets || []).map((s) => s.name).join(' ')
        ).toLowerCase();
        return !q || hay.includes(q);
      })
      .map((w) => {
        const vol = (w.sets || []).reduce(
          (t, s) => t + (s.weight ?? 0) * (s.reps ?? 0),
          0
        );
        const items = (w.sets || [])
          .map((s) => `${s.name} — ${s.reps ?? '?'} x ${s.weight ?? '?'} lb`)
          .join('<br>');
        return `<div class="item">
          <div class="row"><strong>${w.date}</strong><span>${w.title}</span><div class="spacer"></div><small>Volume: ${fmt(
            vol
          )}</small></div>
          <div class="muted">${w.notes || ''}</div>
          <div>${items}</div>
        </div>`;
      })
      .join('');

    listEl.innerHTML = out || '<p class="muted">No workouts yet.</p>';
  }

  $('#historySearch')?.addEventListener('input', renderHistory);

  // ------------------------------
  // Streak & badges
  // ------------------------------
  function renderStreak() {
    const days = new Set(state.workouts.map((w) => w.date));
    let streak = 0;
    const d = new Date();
    for (;;) {
      const iso = d.toISOString().slice(0, 10);
      if (days.has(iso)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    const box = $('#streakBox');
    if (box) box.textContent = `🔥 ${streak}-day streak`;

    const badgesBox = $('#badges');
    if (badgesBox) {
      badgesBox.innerHTML = '';
      Object.values(state.badges || {}).forEach((label) => {
        if (!label) return;
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = label;
        badgesBox.appendChild(b);
      });
    }
  }

  function maybeAwardBadgesAfterSave() {
    if (!state.badges.first) state.badges.first = '🏅 First Workout Logged';

    const days = new Set(state.workouts.map((w) => w.date));
    let run = 0;
    const d = new Date();
    while (days.has(d.toISOString().slice(0, 10))) {
      run++;
      d.setDate(d.getDate() - 1);
    }
    if (run >= 5) state.badges.streak5 = '🔥 5-Day Streak';

    const prs = computePRs();
    if (Object.keys(prs).length && !state.badges.pr) {
      state.badges.pr = '💪 New PR';
    }

    write(KEYS.badges, state.badges);
  }

  // ------------------------------
  // Dashboard: Today panel
  // ------------------------------
  function renderDashboard() {
    const meta = $('#todayMeta');
    const summary = $('#todaySummary');
    if (!meta || !summary) return;

    const today = todayISO();
    const todayWs = state.workouts.filter((w) => w.date === today);
    const vol = todayWs
      .flatMap((w) => w.sets || [])
      .reduce((t, s) => t + (s.weight ?? 0) * (s.reps ?? 0), 0);

    meta.textContent = today;

    if (todayWs.length) {
      summary.innerHTML = `<p>${todayWs.length} workout(s) logged. Volume: <strong>${fmt(
        vol
      )}</strong> (lb×reps).</p>`;
    } else {
      summary.innerHTML = `<p>No workout logged yet.</p><button class="btn primary" id="goLog2">Log a workout</button>`;
      $('#goLog2')?.addEventListener('click', () =>
        document.querySelector('[data-tab="workout"]')?.click()
      );
    }

    renderStreak();
  }

  // Expose dashboard renderer
  window.LL.renderDashboard = renderDashboard;

  // ------------------------------
  // Templates (copy into workout form)
  // ------------------------------
  const TEMPLATES = {
    fullbody: [
      { name: 'Squat', reps: 5, weight: '', rpe: 7 },
      { name: 'Bench Press', reps: 5, weight: '', rpe: 7 },
      { name: 'Bent Row', reps: 8, weight: '', rpe: 7 },
      { name: 'Plank (sec)', reps: 60, weight: '', rpe: '' }
    ],
    ppl: [
      { name: 'Bench Press', reps: 5, weight: '', rpe: 8 },
      { name: 'Incline DB Press', reps: 10, weight: '', rpe: 8 },
      { name: 'Lat Pulldown', reps: 10, weight: '', rpe: 8 },
      { name: 'Seated Row', reps: 10, weight: '', rpe: 8 },
      { name: 'Back Squat', reps: 5, weight: '', rpe: 8 },
      { name: 'Leg Press', reps: 12, weight: '', rpe: 8 }
    ],
    fives: [
      { name: 'Back Squat', reps: 5, weight: '', rpe: 8 },
      { name: 'Bench Press', reps: 5, weight: '', rpe: 8 },
      { name: 'Deadlift', reps: 5, weight: '', rpe: 8 }
    ],
    phul: [
      { name: 'Deadlift', reps: 5, weight: '', rpe: 8 },
      { name: 'OHP', reps: 5, weight: '', rpe: 8 },
      { name: 'Pull-up', reps: 8, weight: '', rpe: 8 },
      { name: 'Lunge', reps: 10, weight: '', rpe: 8 }
    ]
  };

  function wireTemplates() {
    $$('#templates .card .btn[data-template]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!setsBox) return;
        setsBox.innerHTML = '';
        (TEMPLATES[b.dataset.template] || []).forEach((t) =>
          addSetRow(false, t)
        );
        document.querySelector('[data-tab="workout"]')?.click();
      });
    });
  }

  // ------------------------------
  // Bootstrapping
  // ------------------------------
  function boot() {
    initEditor();
    wireTemplates();
    renderHistory();
    renderDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-render dashboard when switching back
  on('panel:dashboard', renderDashboard);
  on('panel:workout', () => {
    // ensure date defaults to today when opening the form
    $('#wDate') && ($('#wDate').value = todayISO());
  });
})();
