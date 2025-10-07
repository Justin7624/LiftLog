/* app.core.js — LiftLog core (<= ~350 lines)
   - Global namespace (window.LL)
   - Storage helpers, keys, event bus
   - Settings load/save (imperial units only)
   - Navigation (tabs)
   - In-browser reminders (Notifications API)
   - Shared utilities
*/

(function () {
  // ------------------------------
  // Global namespace & keys
  // ------------------------------
  const KEYS = {
    workouts: 'll.workouts',
    metrics: 'll.metrics',
    settings: 'll.settings',
    badges: 'll.badges',
    goals: 'll.goals',
    plan: 'll.plan',
    community: 'll.community',
    migrated: 'll.migratedImperialV1',
    reminderNextAt: 'll.reminder.nextAt' // timestamp for next local reminder
  };

  const LL = (window.LL = window.LL || {});
  LL.KEYS = KEYS;

  // ------------------------------
  // Storage & event bus
  // ------------------------------
  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  function write(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  const bus = {};
  function on(event, fn) {
    (bus[event] = bus[event] || []).push(fn);
  }
  function emit(event, payload) {
    (bus[event] || []).forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error('Listener error for', event, e);
      }
    });
  }

  LL.read = read;
  LL.write = write;
  LL.on = on;
  LL.emit = emit;

  // ------------------------------
  // Utilities
  // ------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const parseNum = (v) =>
    v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString();
  const clampPct = (p) => Math.max(3, Math.min(60, p));

  LL.$ = $;
  LL.$$ = $$;
  LL.todayISO = todayISO;
  LL.parseNum = parseNum;
  LL.fmt = fmt;
  LL.clampPct = clampPct;

  // ------------------------------
  // Load state (settings first)
  // ------------------------------
  const defaultSettings = {
    sex: 'male',
    age: 25,
    heightFt: 5,
    heightIn: 10,
    weightLb: 175,
    gamify: 'on',
    preferScaleBF: 'on',
    bfCalOffset: 0.0,
    ffmHydrationPct: 73,
    // reminders
    reminders: 'off', // 'on' | 'off'
    reminderTime: '18:00' // 24h HH:MM local
  };

  LL.state = {
    settings: read(KEYS.settings, defaultSettings),
    workouts: read(KEYS.workouts, []),
    metrics: read(KEYS.metrics, []),
    badges: read(KEYS.badges, {}),
    goals: read(KEYS.goals, {}),
    plan: read(KEYS.plan, null),
    community: read(KEYS.community, { name: '', optIn: 'off', feed: [] })
  };

  // One-time migration to imperial if needed (kept minimal; full migration logic lives in previous app)
  (function maybeMigrate() {
    const migrated = read(KEYS.migrated, false);
    if (migrated) return;
    // If an older build stored metric-only height/weight, leave as-is—current UI is imperial.
    write(KEYS.migrated, true);
  })();

  // ------------------------------
  // Navigation (tabs)
  // ------------------------------
  function setupTabs() {
    const tabs = $$('.tab');
    const panels = $$('.panel');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        panels.forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const id = tab.dataset.tab;
        document.getElementById(id)?.classList.add('active');

        // Lazy emit for panels so feature modules can render
        emit('panel:' + id);
      });
    });

    // default active triggers dashboard render
    emit('panel:dashboard');
  }
  LL.setupTabs = setupTabs;

  // ------------------------------
  // Settings form wiring (+ reminders fields)
  // ------------------------------
  function loadSettingsForm() {
    const s = LL.state.settings;
    $('#sSex') && ($('#sSex').value = s.sex);
    $('#sAge') && ($('#sAge').value = s.age);
    $('#sHeightFt') && ($('#sHeightFt').value = s.heightFt ?? 5);
    $('#sHeightIn') && ($('#sHeightIn').value = s.heightIn ?? 10);
    $('#sWeightLb') && ($('#sWeightLb').value = s.weightLb ?? 175);
    $('#sGamify') && ($('#sGamify').value = s.gamify);
    $('#sPreferScaleBF') && ($('#sPreferScaleBF').value = s.preferScaleBF);
    $('#sBfOffset') && ($('#sBfOffset').value = s.bfCalOffset ?? 0);
    $('#sFFMHydration') &&
      ($('#sFFMHydration').value = s.ffmHydrationPct ?? 73);
    // reminders
    $('#sReminders') && ($('#sReminders').value = s.reminders ?? 'off');
    $('#sReminderTime') &&
      ($('#sReminderTime').value = s.reminderTime ?? '18:00');
  }

  function saveSettingsFromForm() {
    const s = LL.state.settings;
    s.sex = $('#sSex')?.value || s.sex;
    s.age = parseInt($('#sAge')?.value || s.age);
    s.heightFt = parseNum($('#sHeightFt')?.value) ?? s.heightFt;
    s.heightIn = parseNum($('#sHeightIn')?.value) ?? s.heightIn;
    s.weightLb = parseNum($('#sWeightLb')?.value) ?? s.weightLb;
    s.gamify = $('#sGamify')?.value || s.gamify;
    s.preferScaleBF = $('#sPreferScaleBF')?.value || s.preferScaleBF;
    s.bfCalOffset = parseNum($('#sBfOffset')?.value) ?? s.bfCalOffset ?? 0;
    s.ffmHydrationPct =
      parseNum($('#sFFMHydration')?.value) ?? s.ffmHydrationPct ?? 73;
    // reminders
    s.reminders = $('#sReminders')?.value || s.reminders || 'off';
    s.reminderTime =
      $('#sReminderTime')?.value || s.reminderTime || '18:00';

    write(KEYS.settings, s);
    // reschedule reminders if needed
    scheduleNextReminder();
    alert('Settings saved.');
    emit('settings:changed', s);
  }

  function setupSettingsHandlers() {
    $('#saveSettings')?.addEventListener('click', saveSettingsFromForm);
    $('#resetAll')?.addEventListener('click', () => {
      if (
        confirm(
          'Reset everything to factory settings? All local data will be erased.'
        )
      ) {
        localStorage.clear();
        location.reload();
      }
    });
    loadSettingsForm();
  }

  LL.loadSettingsForm = loadSettingsForm;
  LL.saveSettingsFromForm = saveSettingsFromForm;

  // ------------------------------
  // Dashboard helpers (exposed; other modules fill in)
  // ------------------------------
  LL.renderDashboard = () => {}; // app.workouts.js / app.analytics.js will override
  LL.renderCharts = () => {};
  LL.renderMetrics = () => {};
  LL.updateGoalProgress = () => {};
  LL.renderReadiness = () => {};
  LL.renderPlanPreview = () => {};
  LL.renderFeed = () => {};
  LL.renderMiniGoals = () => {}; // small dashboard widget

  // Emit when dashboard panel shown
  on('panel:dashboard', () => {
    LL.renderDashboard();
    LL.renderCharts();
    LL.renderMiniGoals();
  });
  on('panel:metrics', () => LL.renderMetrics());
  on('panel:goals', () => LL.updateGoalProgress());
  on('panel:coach', () => {
    LL.renderReadiness();
    LL.renderPlanPreview();
  });
  on('panel:community', () => LL.renderFeed());

  // ------------------------------
  // Reminders (local notifications)
  // ------------------------------
  async function ensureNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const res = await Notification.requestPermission();
      return res === 'granted';
    } catch {
      return false;
    }
  }

  function timeTodayAt(hhmm) {
    const [h, m] = (hhmm || '18:00').split(':').map((x) => parseInt(x, 10));
    const d = new Date();
    d.setHours(h || 18, m || 0, 0, 0);
    return d;
  }

  function scheduleNextReminder() {
    const s = LL.state.settings;
    if (s.reminders !== 'on') {
      localStorage.removeItem(KEYS.reminderNextAt);
      return;
    }
    const now = new Date();
    let next = timeTodayAt(s.reminderTime || '18:00');
    if (next <= now) next.setDate(next.getDate() + 1); // tomorrow
    write(KEYS.reminderNextAt, next.getTime());
  }

  async function tickReminder() {
    const s = LL.state.settings;
    if (s.reminders !== 'on') return;
    const ts = read(KEYS.reminderNextAt, null);
    if (!ts) return;

    const now = Date.now();
    if (now >= ts) {
      const permitted = await ensureNotificationPermission();
      if (permitted) {
        const title = 'LiftLog reminder';
        const body =
          'Time to move! Log your workout or plan tomorrow’s session.';
        try {
          new Notification(title, { body, silent: false });
        } catch {
          // Some browsers block constructor; try Service Worker if present
          if (navigator.serviceWorker?.registration?.showNotification) {
            navigator.serviceWorker.registration.showNotification(title, {
              body,
              silent: false
            });
          }
        }
      }
      // schedule next day
      scheduleNextReminder();
    }
  }

  // Poll every minute (lightweight)
  setInterval(tickReminder, 60 * 1000);

  // Reschedule on settings change
  on('settings:changed', scheduleNextReminder);

  // On first load, ensure next reminder exists if enabled
  scheduleNextReminder();

  // ------------------------------
  // Init
  // ------------------------------
  function boot() {
    // Year
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Tabs & settings
    setupTabs();
    setupSettingsHandlers();

    // Initial renders for default active panel
    emit('panel:dashboard');
  }

  // Kick off once DOM is ready (index.html uses defer, but be safe)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
