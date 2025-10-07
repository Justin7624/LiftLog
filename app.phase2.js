/* app.phase2.js — Phase 2: Coach, Goals, Community (smarter generator)
   Depends on app.core.js, app.workouts.js, app.analytics.js
   Note: uses Chart.js adapter elsewhere; not required here.
*/
(function () {
  const { $, $$, fmt, todayISO, parseNum, state, write, read, KEYS, emit, on } =
    window.LL;

  // ---------------------------------------
  // UTIL: seeded RNG (stable per week)
  // ---------------------------------------
  function seedFrom(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      // xorshift32-ish
      h ^= h << 13; h >>>= 0;
      h ^= h >>> 17; h >>>= 0;
      h ^= h << 5;  h >>>= 0;
      return (h % 1_000_000) / 1_000_000;
    };
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  // ---------------------------------------
  // EXERCISE POOLS (by equipment & group)
  // ---------------------------------------
  // Simple taxonomy: Squat, Hinge, Horizontal Push/Pull, Vertical Push/Pull, Accessory/Core, Conditioning
  const POOLS = {
    barbell: {
      squat: ['Back Squat', 'Front Squat', 'Paused Squat'],
      hinge: ['Conventional Deadlift', 'Romanian Deadlift', 'Barbell Hip Thrust'],
      hpush: ['Bench Press', 'Close-Grip Bench', 'Incline Bench'],
      hpull: ['Barbell Row', 'Chest-Supported Row', 'Seal Row'],
      vpush: ['Overhead Press', 'Push Press'],
      vpull: ['Pull-up (weighted if needed)', 'Lat Pulldown'],
      acc: ['Barbell Curl', 'Lying Triceps Extension', 'Calf Raise'],
      core: ['Plank (sec)', 'Hanging Knee Raise', 'Ab Wheel'],
      cond: ['Bike Intervals (min)', 'Row Erg (m)', 'Jump Rope (sec)']
    },
    dumbbells: {
      squat: ['Goblet Squat', 'DB Split Squat', 'DB Front Squat'],
      hinge: ['DB Romanian Deadlift', 'DB Hip Hinge'],
      hpush: ['DB Bench Press', 'DB Incline Press', 'DB Floor Press'],
      hpull: ['DB Row', 'Chest-Supported DB Row'],
      vpush: ['DB Shoulder Press', 'Arnold Press'],
      vpull: ['Pull-up', 'Assisted Pull-up', 'Lat Pulldown'],
      acc: ['DB Curl', 'DB Lateral Raise', 'Triceps Rope Pressdown'],
      core: ['Plank (sec)', 'Cable Crunch', 'Dead Bug'],
      cond: ['Bike Intervals (min)', 'Treadmill Intervals (min)', 'Jump Rope (sec)']
    },
    minimal: {
      squat: ['Bodyweight Squat', 'Reverse Lunge', 'Step-up'],
      hinge: ['Hip Hinge (BW)', 'Glute Bridge', 'Single-leg RDL (BW)'],
      hpush: ['Push-up', 'Decline Push-up', 'Close-Grip Push-up'],
      hpull: ['Pull-up', 'Inverted Row (table/TRX)', 'Band Row'],
      vpush: ['Pike Push-up', 'Band Overhead Press'],
      vpull: ['Band Pulldown', 'Doorframe Pull'],
      acc: ['Band Curl', 'Band Triceps Pressdown', 'BW Calf Raise'],
      core: ['Plank (sec)', 'Hollow Hold (sec)', 'Mountain Climbers (sec)'],
      cond: ['Jumping Jacks (sec)', 'High Knees (sec)', 'Burpee Intervals (sec)']
    }
  };

  // Rep schemes by goal (we rotate across days)
  const SCHEMES = {
    strength: [
      { sets: 5, reps: 5, rpe: 8 },
      { sets: 4, reps: 6, rpe: 8 },
      { sets: 3, reps: 5, rpe: 8.5 }
    ],
    general: [
      { sets: 3, reps: 8, rpe: 8 },
      { sets: 4, reps: 10, rpe: 8 },
      { sets: 3, reps: 12, rpe: 7.5 }
    ],
    loss: [
      { sets: 3, reps: 15, rpe: 7 },
      { sets: 4, reps: 12, rpe: 7.5 },
      { sets: 3, reps: 20, rpe: 7 }
    ]
  };

  // ---------------------------------------
  // READINESS (reuse for generation too)
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
        if (n.includes('bench') || n.includes('press') || n.includes('push'))
          rec.Chest = Math.min(rec.Chest, fatigue);
        if (n.includes('row') || n.includes('pull')) rec.Back = Math.min(rec.Back, fatigue);
        if (n.includes('squat') || n.includes('deadlift') || n.includes('lunge'))
          rec.Legs = Math.min(rec.Legs, fatigue);
        if (n.includes('curl') || n.includes('tricep') || n.includes('arm'))
          rec.Arms = Math.min(rec.Arms, fatigue);
        if (n.includes('plank') || n.includes('crunch') || n.includes('core') || n.includes('ab'))
          rec.Core = Math.min(rec.Core, fatigue);
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
  // SPLITS by days/week
  // ---------------------------------------
  function pickSplit(days) {
    if (days <= 3) return ['Full', 'Full', 'Full'].slice(0, days);
    if (days === 4) return ['Upper', 'Lower', 'Upper', 'Lower'];
    if (days >= 5) return ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full'].slice(0, days);
    return ['Full'];
  }

  // Map split to target groups (used with readiness weighting)
  const SPLIT_TARGETS = {
    Full: ['Legs', 'Chest', 'Back', 'Core', 'Arms'],
    Upper: ['Chest', 'Back', 'Arms', 'Core'],
    Lower: ['Legs', 'Core'],
    Push: ['Chest', 'Arms', 'Core'],
    Pull: ['Back', 'Arms', 'Core'],
    Legs: ['Legs', 'Core']
  };

  // ---------------------------------------
  // PLAN GENERATION
  // ---------------------------------------
  function genPlan() {
    const goal = $('#coachGoal')?.value || 'general';
    const equip = $('#coachEquip')?.value || 'barbell';
    const days = parseNum($('#coachDays')?.value) || 4;

    const pools = POOLS[equip] || POOLS.barbell;
    const schemes = SCHEMES[goal] || SCHEMES.general;

    // seed: year-week => stable weekly plan
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil((now - yearStart) / 86400000 / 7);
    const rng = seedFrom(`${goal}-${equip}-${now.getFullYear()}-${week}`);

    const readiness = calcReadiness();
    const splits = pickSplit(days);

    const arr = splits.map((slot, i) => {
      const dayIdx = i % schemes.length;
      const scheme = schemes[dayIdx];

      // choose groups to emphasize, de-prioritize fatigued (<0.6)
      const targets = (SPLIT_TARGETS[slot] || ['Legs', 'Chest', 'Back']).slice();
      targets.sort((a, b) => (readiness[b] ?? 1) - (readiness[a] ?? 1)); // fresh first

      // choose main patterns from targets
      const picks = [];
      const use = (groupName) => {
        if (groupName === 'Legs') {
          // squat or hinge
          picks.push(pick(rng, pools.squat));
          picks.push(pick(rng, pools.hinge));
        } else if (groupName === 'Chest') {
          picks.push(pick(rng, pools.hpush));
        } else if (groupName === 'Back') {
          picks.push(pick(rng, pools.hpull));
          picks.push(pick(rng, pools.vpull));
        } else if (groupName === 'Arms') {
          picks.push(pick(rng, pools.acc));
        } else if (groupName === 'Core') {
          picks.push(pick(rng, pools.core));
        }
      };
      // Take top 2–3 most ready groups for the day
      targets.slice(0, Math.min(3, targets.length)).forEach(use);

      // conditioning bonus for weight loss/general
      if (goal !== 'strength' && rng() < 0.8) picks.push(pick(rng, pools.cond));

      // De-duplicate, cap 5–6 items
      const unique = Array.from(new Set(picks)).slice(0, 6);

      // Format items into display + structured sets
      const list = unique.map((name) => {
        if (name.includes('(sec)') || name.includes('(m)') || name.includes('Intervals')) {
          // timed / conditioning
          const t = goal === 'loss' ? 3 : 2;
          const dur = name.includes('(m)') ? `${goal === 'loss' ? 5 : 4}x2m` : `${t}x60s`;
          return `${name.replace(/\s*\(.*\)/, '')} ${dur}`;
        }
        return `${name} ${scheme.sets}x${scheme.reps}`;
      });

      return { day: i + 1, split: slot, scheme, list };
    });

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
    el.innerHTML =
      `<p><strong>Goal:</strong> ${p.goal}, <strong>Equipment:</strong> ${p.equip}, <strong>Days:</strong> ${p.days}/wk</p>` +
      p.arr
        .map(
          (d) =>
            `<div><strong>Day ${d.day} (${d.split}):</strong> ${d.list.join(', ')}</div>`
        )
        .join('');
  }

  $('#genPlan')?.addEventListener('click', genPlan);

  // ---------------------------------------
  // LOAD TODAY -> populate workout form
  // ---------------------------------------
  function parseDisplayLine(line) {
    // "Bench Press 5x5" -> {name, sets, reps}; "Plank (sec) 3x60s" -> reps "60"
    const m = line.match(/^(.*?)(?:\s+(\d+)x(\d+)(?:s|m)?)?$/i);
    if (!m) return { name: line };
    const name = m[1].trim();
    const sets = m[2] ? Number(m[2]) : 3;
    const reps = m[3] ? Number(m[3]) : 10;
    return { name, sets, reps };
  }

  function addRowToEditor(name, reps) {
    const setsBox = $('#sets');
    if (!setsBox) return;
    const root = document.createElement('div');
    root.className = 'set';
    root.innerHTML = `
      <input placeholder="Exercise (e.g., Bench Press)" class="exName" value="${name}"/>
      <input type="number" step="1" placeholder="Reps" class="exReps" value="${reps}"/>
      <input type="number" step="0.5" placeholder="Weight (lb)" class="exWeight" />
      <input type="number" step="0.5" placeholder="RPE (opt)" class="exRPE" />
      <button type="button" class="btn" data-del>Delete</button>
    `;
    root.querySelector('[data-del]').addEventListener('click', () => root.remove());
    setsBox.appendChild(root);
  }

  $('#loadToday')?.addEventListener('click', () => {
    const p = state.plan;
    if (!p) return alert('No plan available. Generate one first.');
    const i = Math.max(0, (new Date().getDay() % p.days) - 1); // Sun=0 -> Day 1
    const day = p.arr[i] || p.arr[0];

    // navigate to workout tab
    document.querySelector('[data-tab="workout"]')?.click();
    $('#wTitle') && ($('#wTitle').value = `Day ${day.day} — ${day.split}`);
    const setsBox = $('#sets');
    if (setsBox) setsBox.innerHTML = '';

    day.list.forEach((ln) => {
      const { name, reps } = parseDisplayLine(ln);
      addRowToEditor(name, reps || 10);
    });

    alert(`Loaded Day ${day.day} into the workout editor.`);
  });

  // Auto-refresh weekly (new seed → new variety)
  (function autoRefreshPlan() {
    if (!state.plan?.created) return;
    const created = new Date(state.plan.created);
    const now = new Date();
    const diff = (now - created) / 86400000;
    if (diff > 7) genPlan();
  })();

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
    const last = state.metrics
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const weightNow = last?.weight ?? state.settings.weightLb;

    if (g.weight && g.targetDate) {
      const start = state.metrics[0]?.weight ?? weightNow;
      const total = g.weight - start;
      const delta = weightNow - start;
      const pct = total === 0 ? 100 : (delta / total) * 100;
      const days = Math.ceil((new Date(g.targetDate) - new Date()) / 86400000);
      rows.push(
        `<div><strong>Weight Goal:</strong> ${fmt(weightNow)} → ${fmt(
          g.weight
        )} lb (${isFinite(pct) ? pct.toFixed(0) : 0}%)</div>
      <div class="muted">${days} days left</div>`
      );
      if (days <= 3) notifyGoal('Body Weight Goal almost due!');
    }

    if (g.liftName && g.lift1RM) {
      let best = 0;
      state.workouts.forEach((w) =>
        (w.sets || []).forEach((s) => {
          if (
            (s.name || '').toLowerCase() === g.liftName.toLowerCase() &&
            s.weight &&
            s.reps
          ) {
            const est = s.weight * (1 + s.reps / 30);
            best = Math.max(best, est);
          }
        })
      );
      const pct = (best / g.lift1RM) * 100;
      rows.push(
        `<div><strong>${g.liftName}:</strong> ${fmt(best)} → ${fmt(
          g.lift1RM
        )} lb (${isFinite(pct) ? pct.toFixed(0) : 0}%)</div>`
      );
      if (pct >= 95) notifyGoal(`${g.liftName} goal nearly achieved!`);
    }

    box.innerHTML = rows.join('<br>') || '<p>No goals.</p>';
  }
  window.LL.updateGoalProgress = updateGoalProgress;
  $('#saveGoals')?.addEventListener('click', saveGoals);

  async function notifyGoal(msg) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted')
      new Notification('LiftLog', { body: msg });
  }

  // ---------------------------------------
  // COMMUNITY FEED (offline + share/import)
  // ---------------------------------------
  function renderFeed() {
    const feedEl = $('#feed');
    if (!feedEl) return;
    const comm = state.community;
    if (comm.optIn !== 'on') {
      feedEl.innerHTML =
        '<p class="muted">Feed is off. Enable opt-in above.</p>';
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
