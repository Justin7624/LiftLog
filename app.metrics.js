/* app.metrics.js — body metrics, BF% estimators, BMR/TDEE
   Depends on app.core.js (LL namespace)
*/
(function () {
  const {
    $, $$, parseNum, fmt, clampPct, todayISO, state, KEYS, read, write, emit, on
  } = window.LL;

  // ------------------------------
  // Public helpers (exported)
  // ------------------------------
  function calcBmrTdee(sex, age, heightCm, weightKg) {
    // Mifflin–St Jeor
    let bmr;
    if (sex === 'male') bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
    else bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
    return { bmr, tdeeModerate: bmr * 1.55 };
  }

  // Anthropometric (Navy -> YMCA -> BMI fallback), with calibration offset
  function estimateBF_Anthro(opts = {}) {
    const s = state.settings;
    const sx = opts.sex || s.sex;
    const age = opts.age != null ? opts.age : s.age;
    const hIn =
      opts.heightInches ??
      ( (s.heightFt || 0) * 12 + (s.heightIn || 0) );
    const wLb = opts.weightLb ?? s.weightLb;
    const waist = opts.waistIn ?? null;
    const neck = opts.neckIn ?? null;
    const hip = opts.hipIn ?? null;

    const log10 = (x) => Math.log(x) / Math.LN10;
    let bf = null;

    // U.S. Navy — needs neck, waist (+ hip for women)
    if (sx === 'male' && waist && neck && hIn && waist > neck) {
      bf = 86.010 * log10(waist - neck) - 70.041 * log10(hIn) + 36.76;
    } else if (
      sx === 'female' &&
      waist &&
      hip &&
      neck &&
      hIn &&
      waist + hip > neck
    ) {
      bf =
        163.205 * log10(waist + hip - neck) -
        97.684 * log10(hIn) -
        78.387;
    }

    // YMCA — needs waist and weight
    if (bf == null && waist && wLb) {
      bf =
        sx === 'male'
          ? (((waist * 4.15) - (wLb * 0.082) - 98.42) / wLb) * 100
          : (((waist * 4.15) - (wLb * 0.082) - 76.76) / wLb) * 100;
    }

    // BMI-based fallback
    if (bf == null && hIn && wLb) {
      const bmi = (703 * wLb) / (hIn * hIn);
      bf = 1.2 * bmi + 0.23 * age - 10.8 * (sx === 'male' ? 1 : 0) - 5.4;
    }

    if (bf == null || !isFinite(bf)) return null;
    return clampPct(bf + (s.bfCalOffset || 0));
  }

  // Scale-assisted (Wyze-like) using LBM or TBW + assumed hydration
  function estimateBF_ScaleLike(inputs = {}) {
    const s = state.settings;
    const w = inputs.weightLb ?? s.weightLb;
    if (w == null) return null;

    let hydration =
      Math.max(65, Math.min(80, Number(s.ffmHydrationPct) || 73)) / 100;

    // Direct LBM provided (best)
    if (inputs.lbmLb) {
      return clampPct(100 * (1 - inputs.lbmLb / w) + (s.bfCalOffset || 0));
    }

    // TBW path (requires body water %)
    if (inputs.waterPct) {
      if (inputs.musclePct != null) {
        // Slightly adjust assumed hydration with muscle %
        const mus = inputs.musclePct;
        const adj = (mus - 40) * 0.0015; // +/- ~3% over ~20% swing
        hydration = Math.max(0.68, Math.min(0.78, hydration + adj));
      }
      const tbw = (inputs.waterPct / 100) * w; // lb
      const ffm = tbw / hydration; // lb
      return clampPct(100 * (1 - ffm / w) + (s.bfCalOffset || 0));
    }

    return null;
  }

  // Export helpers
  window.LL.calcBmrTdee = calcBmrTdee;
  window.LL.estimateBF_Anthro = estimateBF_Anthro;
  window.LL.estimateBF_ScaleLike = estimateBF_ScaleLike;

  // ------------------------------
  // Metrics form handlers
  // ------------------------------
  function fillDefaultDate() {
    const el = $('#mDate');
    if (el && !el.value) el.value = todayISO();
  }

  function onCalcBMR() {
    const s = state.settings;
    const hFt = parseNum($('#mHeightFt')?.value) ?? s.heightFt;
    const hIn = parseNum($('#mHeightIn')?.value) ?? s.heightIn;
    const totalIn = (hFt || 0) * 12 + (hIn || 0);
    const heightCm = totalIn * 2.54;
    const weightLb = parseNum($('#mWeightLb')?.value) ?? s.weightLb;
    const weightKg = (weightLb || 0) * 0.453592;
    const res = calcBmrTdee(s.sex, s.age, heightCm, weightKg);
    $('#bmrBox').innerHTML = `
      <div>Estimated BMR: <strong>${Math.round(res.bmr)} kcal</strong></div>
      <div>TDEE (moderate): <strong>${Math.round(
        res.tdeeModerate
      )} kcal</strong></div>
      <div class="muted">Formula: Mifflin–St Jeor. (Imperial inputs converted internally.)</div>`;
  }

  function onEstimateBFScale() {
    const s = state.settings;
    const weightLb = parseNum($('#mWeightLb')?.value) ?? s.weightLb;
    const lbmLb = parseNum($('#mLBMlb')?.value);
    const waterPct = parseNum($('#mWaterPct')?.value);
    const musclePct = parseNum($('#mMusclePct')?.value);
    const bf = estimateBF_ScaleLike({ weightLb, lbmLb, waterPct, musclePct });
    if (bf == null) {
      $('#bfBox').innerHTML =
        'Need at least Lean Body Mass (lb) or Body Water % from your scale.';
      return;
    }
    $('#bfBox').innerHTML = `Scale-assisted BF%: <strong>${bf.toFixed(
      1
    )}%</strong> <span class="muted">(LBM/TBW approach; hydration ${
      s.ffmHydrationPct || 73
    }%)</span>`;
    const bfInput = $('#mBodyFat');
    if (bfInput) bfInput.value = bf.toFixed(1);
  }

  function onEstimateBFAnthro() {
    const s = state.settings;
    const hFt = parseNum($('#mHeightFt')?.value) ?? s.heightFt;
    const hIn = parseNum($('#mHeightIn')?.value) ?? s.heightIn;
    const weightLb = parseNum($('#mWeightLb')?.value) ?? s.weightLb;
    const waist = parseNum($('#mWaist')?.value);
    const hip = parseNum($('#mHip')?.value);
    const neck = parseNum($('#mNeck')?.value);
    const totalIn = (hFt || 0) * 12 + (hIn || 0);
    const bf = estimateBF_Anthro({
      sex: s.sex,
      age: s.age,
      heightInches: totalIn,
      weightLb,
      waistIn: waist,
      hipIn: hip,
      neckIn: neck
    });
    if (bf == null) {
      $('#bfBox').innerHTML = 'Not enough data to estimate body fat.';
      return;
    }
    $('#bfBox').innerHTML = `Anthropometric BF%: <strong>${bf.toFixed(
      1
    )}%</strong> <span class="muted">(Navy / YMCA / BMI with calibration)</span>`;
    const bfInput = $('#mBodyFat');
    if (bfInput) bfInput.value = bf.toFixed(1);
  }

  function onSaveMetrics() {
    const entry = {
      date: $('#mDate')?.value || todayISO(),
      heightFt: parseNum($('#mHeightFt')?.value),
      heightIn: parseNum($('#mHeightIn')?.value),
      weight: parseNum($('#mWeightLb')?.value),
      bodyFat: parseNum($('#mBodyFat')?.value),
      waist: parseNum($('#mWaist')?.value),
      hip: parseNum($('#mHip')?.value),
      chest: parseNum($('#mChest')?.value),
      neck: parseNum($('#mNeck')?.value),
      // scale-assisted
      lbmLb: parseNum($('#mLBMlb')?.value),
      waterPct: parseNum($('#mWaterPct')?.value),
      musclePct: parseNum($('#mMusclePct')?.value),
      boneLb: parseNum($('#mBoneLb')?.value),
      proteinPct: parseNum($('#mProteinPct')?.value),
      visceral: parseNum($('#mVisceral')?.value),
      rhr: parseNum($('#mRHR')?.value)
    };

    state.metrics.push(entry);
    write(KEYS.metrics, state.metrics);
    renderMetrics();
    window.LL.renderDashboard();
    window.LL.renderCharts();
    alert('Metrics saved.');
  }

  // ------------------------------
  // Metrics history renderer
  // ------------------------------
  function renderMetrics() {
    const list = state.metrics.slice().sort((a, b) => b.date.localeCompare(a.date));
    const html =
      list
        .map((m) => {
          const parts = [];
          if (m.heightFt != null || m.heightIn != null)
            parts.push(`Height: ${m.heightFt ?? '?'} ft ${m.heightIn ?? '?'} in`);
          if (m.weight != null) parts.push(`Weight: ${m.weight} lb`);
          if (m.bodyFat != null) parts.push(`BF: ${m.bodyFat}%`);
          if (m.waist != null) parts.push(`Waist: ${m.waist} in`);
          if (m.hip != null) parts.push(`Hip: ${m.hip} in`);
          if (m.chest != null) parts.push(`Chest: ${m.chest} in`);
          if (m.neck != null) parts.push(`Neck: ${m.neck} in`);
          if (m.lbmLb != null) parts.push(`LBM: ${m.lbmLb} lb`);
          if (m.waterPct != null) parts.push(`Water: ${m.waterPct}%`);
          if (m.musclePct != null) parts.push(`Muscle: ${m.musclePct}%`);
          if (m.boneLb != null) parts.push(`Bone: ${m.boneLb} lb`);
          if (m.proteinPct != null) parts.push(`Protein: ${m.proteinPct}%`);
          if (m.visceral != null) parts.push(`Visceral idx: ${m.visceral}`);
          if (m.rhr != null) parts.push(`RHR: ${m.rhr} bpm`);
          return `<div class="item"><strong>${m.date}</strong> — ${parts.join(
            ' • '
          )}</div>`;
        })
        .join('') || '<p class="muted">No metrics logged.</p>';

    $('#metricsList') && ($('#metricsList').innerHTML = html);
  }

  // Expose to core
  window.LL.renderMetrics = renderMetrics;

  // ------------------------------
  // Demos (unchanged, but initialized here for convenience)
  // ------------------------------
  const DEMOS = [
    { name: 'Barbell Back Squat', yt: 'https://www.youtube.com/embed/ultWZbUMPL8' },
    { name: 'Bench Press', yt: 'https://www.youtube.com/embed/gRVjAtPip0Y' },
    { name: 'Deadlift', yt: 'https://www.youtube.com/embed/op9kVnSso6Q' },
    { name: 'Overhead Press', yt: 'https://www.youtube.com/embed/F3QY5vMz_6I' },
    { name: 'Barbell Row', yt: 'https://www.youtube.com/embed/vT2GjY_Umpw' },
    { name: 'Lat Pulldown', yt: 'https://www.youtube.com/embed/CAwf7n6Luuc' }
  ];

  function renderDemos() {
    const lib = $('#demoLibrary');
    if (!lib) return;
    lib.innerHTML = DEMOS.map(
      (d) => `
      <div class="demo">
        <h4>${d.name}</h4>
        <div class="row">
          <span class="muted">Form demo</span>
          <button class="btn" data-demo="${d.name}">?</button>
        </div>
      </div>`
    ).join('');
    $$('#demoLibrary [data-demo]').forEach((btn) => {
      btn.addEventListener('click', () => openDemo(btn.dataset.demo));
    });
  }

  const demoModal = $('#demoModal');
  $('#closeDemo')?.addEventListener('click', () => demoModal?.close());
  function openDemo(name) {
    const d = DEMOS.find((x) => x.name === name);
    if (!d) return;
    $('#demoTitle') && ($('#demoTitle').textContent = name);
    $('#demoContent') &&
      ($('#demoContent').innerHTML = `<iframe src="${d.yt}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`);
    demoModal?.showModal();
  }

  // ------------------------------
  // Wire buttons & init
  // ------------------------------
  function boot() {
    // default date
    fillDefaultDate();

    // Buttons
    $('#calcBMR')?.addEventListener('click', onCalcBMR);
    $('#estimateBFScale')?.addEventListener('click', onEstimateBFScale);
    $('#estimateBF')?.addEventListener('click', onEstimateBFAnthro);
    $('#saveMetrics')?.addEventListener('click', onSaveMetrics);

    // Demos
    renderDemos();

    // First render
    renderMetrics();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-render when panel opened
  on('panel:metrics', () => {
    fillDefaultDate();
    renderMetrics();
  });
})();
