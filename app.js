// LiftLog (imperial-only UI) — v2 with Phase 2 features merged
// - Scale-assisted BF% (Wyze-style: LBM/TBW + hydration + calibration)
// - Anthropometric BF% fallback (Navy / YMCA / BMI)
// - Charts: Volume/week, 1RM, Weight & BF%, PRs
// - Calories & 8-week projections (weight + BF% path)
// - Phase 2: AI Coach (rule-based), Muscle Readiness SVG, Goals, Community feed
// NOTE: All units are pounds (lb) and inches (in). Height inputs are ft + in.

const KEYS = {
  workouts: 'll.workouts',
  metrics: 'll.metrics',
  settings: 'll.settings',
  badges: 'll.badges',
  migrated: 'll.migratedImperialV1',
  goals: 'll.goals',
  plan: 'll.plan',
  community: 'll.community'
};

// ---------- utilities
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const todayISO = () => new Date().toISOString().slice(0,10);
const parseNum = v => (v === '' || v === null || isNaN(Number(v))) ? null : Number(v);
const uid = () => Math.random().toString(36).slice(2, 10);
function read(key, fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch(e){ return fallback; } }
function write(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
function fmt(n){ return (Math.round(n*100)/100).toLocaleString(); }
function clampPct(p){ return Math.max(3, Math.min(60, p)); }

// ---------- state
let workouts = read(KEYS.workouts, []);
let metrics  = read(KEYS.metrics,  []);
let settings = read(KEYS.settings, {
  sex:'male', age:25, heightFt:5, heightIn:10, weightLb:175, gamify:'on',
  preferScaleBF:'on', bfCalOffset: 0.0, ffmHydrationPct: 73
});
let badges = read(KEYS.badges, {});
let goals = read(KEYS.goals, {});                // {weight, date, lift, lift1RM}
let planState = read(KEYS.plan, null);           // array of day plans
let community = read(KEYS.community, {           // simple local-only social prefs
  name: '', optIn: 'off', feed: []
});

// ---------- migrate from old metric settings if present
(function migrateToImperial(){
  if(read(KEYS.migrated, false)) return;
  const old = read(KEYS.settings, null);
  if(old && (old.units === 'metric' || (old.height && old.weight && !('heightFt' in old)))){
    const heightCm = Number(old.height) || 175;
    const totalIn = heightCm / 2.54;
    const ft = Math.floor(totalIn / 12);
    const inch = totalIn - ft*12;
    const weightLb = (Number(old.weight) || 75) * 2.20462;
    settings = { ...settings, sex: old.sex || 'male', age: old.age || 25, heightFt: ft, heightIn: +inch.toFixed(1), weightLb: +weightLb.toFixed(1), gamify: old.gamify || 'on' };
    write(KEYS.settings, settings);

    metrics = metrics.map(m => {
      const out = {...m};
      if('height' in out){ const ti = (Number(out.height)||0)/2.54; const f = Math.floor(ti/12); const i = ti - f*12; out.heightFt=f; out.heightIn=+i.toFixed(1); delete out.height; }
      if(typeof out.waist === 'number' && out.waist > 50) out.waist = +(out.waist/2.54).toFixed(1);
      if(typeof out.hip === 'number' && out.hip > 50) out.hip = +(out.hip/2.54).toFixed(1);
      if(typeof out.chest === 'number' && out.chest > 50) out.chest = +(out.chest/2.54).toFixed(1);
      if(typeof out.weight === 'number' && out.weight < 300) out.weight = +(out.weight*2.20462).toFixed(1);
      return out;
    });
    write(KEYS.metrics, metrics);

    workouts = workouts.map(w => ({
      ...w,
      sets: (w.sets||[]).map(s => (typeof s.weight === 'number' ? {...s, weight: +(s.weight*2.20462).toFixed(1)} : s))
    }));
    write(KEYS.workouts, workouts);
  }
  write(KEYS.migrated, true);
})();

// ---------- navigation
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $$('.panel').forEach(p=>p.classList.remove('active'));
    const id = btn.dataset.tab;
    $('#'+id).classList.add('active');
    if(id === 'dashboard') { renderDashboard(); renderCharts(); }
    if(id === 'metrics') renderMetrics();
    if(id === 'goals') updateGoalProgress();
    if(id === 'coach') { renderReadiness(); renderPlanPreview(); }
    if(id === 'community') renderFeed();
  });
});
$('#goLog').addEventListener('click', () => $('[data-tab="workout"]').click());
$('#year').textContent = new Date().getFullYear();

// ---------- Workout form
const setsBox = $('#sets');
$('#wDate').value = todayISO();
function addSetRow(superset=false, preset={}){
  const root = document.createElement('div');
  root.className = 'set' + (superset ? ' superset' : '');
  root.innerHTML = `
    <input placeholder="Exercise (e.g., Bench Press)" class="exName" value="${preset.name ?? ''}"/>
    <input type="number" step="1" placeholder="Reps" class="exReps" value="${preset.reps ?? ''}"/>
    <input type="number" step="0.5" placeholder="Weight (lb)" class="exWeight" value="${preset.weight ?? ''}"/>
    <input type="number" step="0.5" placeholder="RPE (opt)" class="exRPE" value="${preset.rpe ?? ''}"/>
    <button type="button" class="btn" data-del>Delete</button>
  `;
  root.querySelector('[data-del]').addEventListener('click', () => root.remove());
  setsBox.appendChild(root);
}
$('#addSet').addEventListener('click', ()=> addSetRow(false));
$('#addSuperset').addEventListener('click', ()=> addSetRow(true));
addSetRow(false);

$('#workoutForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const date = $('#wDate').value || todayISO();
  const title = $('#wTitle').value.trim() || 'Workout';
  const notes = $('#wNotes').value.trim();
  const sets = $$('.set').map(s => ({
    name: s.querySelector('.exName').value.trim(),
    reps: parseNum(s.querySelector('.exReps').value),
    weight: parseNum(s.querySelector('.exWeight').value),
    rpe: parseNum(s.querySelector('.exRPE').value)
  })).filter(s=>s.name);
  if(!sets.length){ alert('Add at least one set'); return; }
  workouts.push({id:uid(), date, title, notes, sets});
  write(KEYS.workouts, workouts);
  maybeAwardBadgesAfterSave();
  setsBox.innerHTML=''; $('#wTitle').value=''; $('#wNotes').value=''; addSetRow(false);
  renderHistory(); renderDashboard(); renderCharts(); alert('Workout saved.');
});

// history
$('#historySearch').addEventListener('input', renderHistory);
$('#exportData').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify({workouts, metrics, settings, badges, goals, community, plan: planState}, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liftlog-export.json';
  a.click();
});
$('#clearAll').addEventListener('click', ()=>{
  if(confirm('Clear ALL workouts & metrics? This cannot be undone.')){
    workouts = []; metrics = []; badges = {}; goals = {}; planState=null; community = {name:'',optIn:'off',feed:[]};
    write(KEYS.workouts, workouts); write(KEYS.metrics, metrics); write(KEYS.badges, badges);
    write(KEYS.goals, goals); write(KEYS.plan, planState); write(KEYS.community, community);
    renderHistory(); renderMetrics(); renderDashboard(); renderCharts();
  }
});

function renderHistory(){
  const q = $('#historySearch').value.toLowerCase().trim();
  const list = workouts.slice().sort((a,b)=>b.date.localeCompare(a.date));
  const out = list.filter(w => {
    const hay = (w.title+' '+w.notes+' '+w.sets.map(s=>s.name).join(' ')).toLowerCase();
    return !q || hay.includes(q);
  }).map(w => {
    const vol = w.sets.reduce((t,s)=> t + (s.weight??0)*(s.reps??0), 0);
    const items = w.sets.map(s=>`${s.name} — ${s.reps??'?'} x ${s.weight??'?'} lb`).join('<br>');
    return `<div class="item">
      <div class="row"><strong>${w.date}</strong><span>${w.title}</span><div class="spacer"></div><small>Volume: ${fmt(vol)}</small></div>
      <div class="muted">${w.notes||''}</div>
      <div>${items}</div>
    </div>`;
  }).join('');
  $('#historyList').innerHTML = out || '<p class="muted">No workouts yet.</p>';
}

// ---------- helpers
function latestMetrics(){
  const sorted = metrics.slice().sort((a,b)=>b.date.localeCompare(a.date));
  return sorted[0] || {};
}

// Anthropometric estimator (Navy/ YMCA/ BMI fallback) with calibration
function estimateBF_Anthro(opts){
  // opts: {sex, age, heightInches, weightLb, waistIn, neckIn, hipIn}
  const sx = opts.sex || settings.sex;
  const age = opts.age != null ? opts.age : settings.age;
  const hIn = opts.heightInches ?? ((settings.heightFt||0)*12 + (settings.heightIn||0));
  const wLb = opts.weightLb ?? settings.weightLb;
  const waist = opts.waistIn ?? null;
  const neck = opts.neckIn ?? null;
  const hip = opts.hipIn ?? null;
  const log10 = x => Math.log(x) / Math.LN10;
  let bf = null;
  if (sx === 'male' && waist && neck && hIn && waist>neck){
    bf = 86.010*log10(waist - neck) - 70.041*log10(hIn) + 36.76;
  } else if (sx === 'female' && waist && hip && neck && hIn && waist+hip>neck){
    bf = 163.205*log10(waist + hip - neck) - 97.684*log10(hIn) - 78.387;
  }
  if (bf == null && waist && wLb){
    bf = (sx==='male'
      ? (((waist * 4.15) - (wLb * 0.082) - 98.42) / wLb) * 100
      : (((waist * 4.15) - (wLb * 0.082) - 76.76) / wLb) * 100);
  }
  if (bf == null && hIn && wLb){
    const bmi = (703 * wLb) / (hIn*hIn);
    bf = 1.20*bmi + 0.23*age - 10.8*(sx==='male'?1:0) - 5.4;
  }
  if (bf == null || !isFinite(bf)) return null;
  return clampPct(bf + (settings.bfCalOffset||0));
}

// Scale-assisted estimator emulating BIA logic using TBW or LBM
function estimateBF_ScaleLike(inputs){
  // inputs: { weightLb, lbmLb, waterPct, musclePct }
  const w = inputs.weightLb;
  if (w == null) return null;
  let hydration = Math.max(65, Math.min(80, Number(settings.ffmHydrationPct)||73)) / 100; // % -> fraction

  if (inputs.lbmLb){
    return clampPct(100 * (1 - inputs.lbmLb / w) + (settings.bfCalOffset||0));
  }
  if (inputs.waterPct){
    if (inputs.musclePct != null){
      // Adjust hydration slightly with muscle % (muscle ~75% water)
      const mus = inputs.musclePct;
      const adj = (mus - 40) * 0.0015; // +/- ~3% span over ~20% range
      hydration = Math.max(0.68, Math.min(0.78, hydration + adj));
    }
    const tbw = (inputs.waterPct/100) * w; // lb
    const ffm = tbw / hydration; // lb
    return clampPct(100 * (1 - ffm / w) + (settings.bfCalOffset||0));
  }
  return null;
}

// ---------- Metrics
$('#mDate').value = todayISO();
$('#calcBMR').addEventListener('click', ()=>{
  const hFt = parseNum($('#mHeightFt').value) ?? settings.heightFt;
  const hIn = parseNum($('#mHeightIn').value) ?? settings.heightIn;
  const totalIn = (hFt||0)*12 + (hIn||0);
  const heightCm = totalIn * 2.54;
  const weightLb = parseNum($('#mWeightLb').value) ?? settings.weightLb;
  const weightKg = (weightLb||0) * 0.453592;
  const res = calcBmrTdee(settings.sex, settings.age, heightCm, weightKg);
  $('#bmrBox').innerHTML = `
    <div>Estimated BMR: <strong>${Math.round(res.bmr)} kcal</strong></div>
    <div>TDEE (moderate): <strong>${Math.round(res.tdeeModerate)} kcal</strong></div>
    <div class="muted">Formula: Mifflin–St Jeor. (Imperial inputs converted internally.)</div>`;
});

$('#estimateBFScale').addEventListener('click', ()=>{
  const weightLb = parseNum($('#mWeightLb').value) ?? settings.weightLb;
  const lbmLb = parseNum($('#mLBMlb').value);
  const waterPct = parseNum($('#mWaterPct').value);
  const musclePct = parseNum($('#mMusclePct').value);
  const bf = estimateBF_ScaleLike({weightLb, lbmLb, waterPct, musclePct});
  if(bf==null){
    $('#bfBox').innerHTML = 'Need at least Lean Body Mass (lb) or Body Water % from your scale.';
    return;
  }
  $('#bfBox').innerHTML = `Scale-assisted BF%: <strong>${bf.toFixed(1)}%</strong> <span class="muted">(LBM/TBW approach; hydration ${settings.ffmHydrationPct||73}%)</span>`;
  const bfInput = $('#mBodyFat'); if(bfInput) bfInput.value = bf.toFixed(1);
});

$('#estimateBF').addEventListener('click', ()=>{
  const hFt = parseNum($('#mHeightFt').value) ?? settings.heightFt;
  const hIn = parseNum($('#mHeightIn').value) ?? settings.heightIn;
  const weightLb = parseNum($('#mWeightLb').value) ?? settings.weightLb;
  const waist = parseNum($('#mWaist').value);
  const hip = parseNum($('#mHip').value);
  const neck = parseNum($('#mNeck').value);
  const totalIn = (hFt||0)*12 + (hIn||0);
  const bf = estimateBF_Anthro({sex: settings.sex, age: settings.age, heightInches: totalIn, weightLb, waistIn: waist, hipIn: hip, neckIn: neck});
  if(bf==null){ $('#bfBox').innerHTML = 'Not enough data to estimate body fat.'; return; }
  $('#bfBox').innerHTML = `Anthropometric BF%: <strong>${bf.toFixed(1)}%</strong> <span class="muted">(Navy / YMCA / BMI with calibration)</span>`;
  const bfInput = $('#mBodyFat'); if(bfInput) bfInput.value = bf.toFixed(1);
});

$('#saveMetrics').addEventListener('click', ()=>{
  const entry = {
    date: $('#mDate').value || todayISO(),
    heightFt: parseNum($('#mHeightFt').value),
    heightIn: parseNum($('#mHeightIn').value),
    weight: parseNum($('#mWeightLb').value),
    bodyFat: parseNum($('#mBodyFat').value),
    waist: parseNum($('#mWaist').value),
    hip: parseNum($('#mHip').value),
    chest: parseNum($('#mChest').value),
    neck: parseNum($('#mNeck').value),
    // scale-assisted fields
    lbmLb: parseNum($('#mLBMlb').value),
    waterPct: parseNum($('#mWaterPct').value),
    musclePct: parseNum($('#mMusclePct').value),
    boneLb: parseNum($('#mBoneLb').value),
    proteinPct: parseNum($('#mProteinPct').value),
    visceral: parseNum($('#mVisceral').value),
    rhr: parseNum($('#mRHR').value)
  };
  metrics.push(entry); write(KEYS.metrics, metrics);
  renderMetrics(); renderDashboard(); renderCharts(); alert('Metrics saved.');
});

function renderMetrics(){
  const list = metrics.slice().sort((a,b)=>b.date.localeCompare(a.date));
  $('#metricsList').innerHTML = list.map(m=>{
    const parts = [];
    if(m.heightFt!=null || m.heightIn!=null) parts.push(`Height: ${m.heightFt??'?'} ft ${m.heightIn??'?'} in`);
    if(m.weight!=null) parts.push(`Weight: ${m.weight} lb`);
    if(m.bodyFat!=null) parts.push(`BF: ${m.bodyFat}%`);
    if(m.waist!=null) parts.push(`Waist: ${m.waist} in`);
    if(m.hip!=null) parts.push(`Hip: ${m.hip} in`);
    if(m.chest!=null) parts.push(`Chest: ${m.chest} in`);
    if(m.neck!=null) parts.push(`Neck: ${m.neck} in`);
    if(m.lbmLb!=null) parts.push(`LBM: ${m.lbmLb} lb`);
    if(m.waterPct!=null) parts.push(`Water: ${m.waterPct}%`);
    if(m.musclePct!=null) parts.push(`Muscle: ${m.musclePct}%`);
    if(m.boneLb!=null) parts.push(`Bone: ${m.boneLb} lb`);
    if(m.proteinPct!=null) parts.push(`Protein: ${m.proteinPct}%`);
    if(m.visceral!=null) parts.push(`Visceral idx: ${m.visceral}`);
    if(m.rhr!=null) parts.push(`RHR: ${m.rhr} bpm`);
    return `<div class="item"><strong>${m.date}</strong> — ${parts.join(' • ')}</div>`;
  }).join('') || '<p class="muted">No metrics logged.</p>';
}

// ---------- Settings
function loadSettingsForm(){
  $('#sSex').value = settings.sex;
  $('#sAge').value = settings.age;
  $('#sHeightFt').value = settings.heightFt ?? 5;
  $('#sHeightIn').value = settings.heightIn ?? 10;
  $('#sWeightLb').value = settings.weightLb ?? 175;
  $('#sGamify').value = settings.gamify;
  $('#sPreferScaleBF').value = settings.preferScaleBF;
  $('#sBfOffset').value = settings.bfCalOffset;
  $('#sFFMHydration').value = settings.ffmHydrationPct;
}
loadSettingsForm();
$('#saveSettings').addEventListener('click', ()=>{
  settings.sex = $('#sSex').value;
  settings.age = parseInt($('#sAge').value||settings.age);
  settings.heightFt = parseNum($('#sHeightFt').value) ?? settings.heightFt;
  settings.heightIn = parseNum($('#sHeightIn').value) ?? settings.heightIn;
  settings.weightLb = parseNum($('#sWeightLb').value) ?? settings.weightLb;
  settings.gamify = $('#sGamify').value;
  settings.preferScaleBF = $('#sPreferScaleBF').value;
  settings.bfCalOffset = parseNum($('#sBfOffset').value) ?? 0;
  settings.ffmHydrationPct = parseNum($('#sFFMHydration').value) ?? 73;
  write(KEYS.settings, settings);
  alert('Settings saved.');
  renderDashboard(); renderCharts();
});
$('#resetAll').addEventListener('click', ()=>{
  if(confirm('Reset everything to factory settings? All data will be erased.')){
    localStorage.clear(); location.reload();
  }
});

// ---------- Projection chart helper
let chartsProj = null;
function renderProjectionChart(weeks, weights, bfs){
  if(chartsProj){ chartsProj.destroy(); chartsProj=null; }
  chartsProj = new Chart($('#chartProj'), {
    type:'line',
    data:{
      labels: weeks.map(w => `W${w}`),
      datasets:[
        {label:'Weight (lb)', data: weights, yAxisID:'y'},
        {label:'Body Fat %', data: bfs, yAxisID:'y1'}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{ y:{ type:'linear', position:'left'}, y1:{ type:'linear', position:'right'} }
    }
  });
}

// ---------- Calories & projection
$('#estimateWeight').addEventListener('click', ()=>{
  const cals = parseNum($('#caloriesInput').value);
  const activity = $('#activityLevel').value;
  if(!cals){ alert('Enter your daily calories.'); return; }
  const heightCm = ((settings.heightFt||0)*12 + (settings.heightIn||0)) * 2.54;
  const weightKg = (settings.weightLb||0) * 0.453592;
  const {bmr} = calcBmrTdee(settings.sex, settings.age, heightCm, weightKg);
  const mult = {sedentary:1.2, light:1.375, moderate:1.55, very:1.725, athlete:1.9}[activity];
  const tdee = bmr * mult;
  const delta = cals - tdee; // kcal/day
  const lbPerWeek = delta / 3500 * 7;
  const sign = lbPerWeek>0 ? 'gain' : (lbPerWeek<0 ? 'loss' : 'maintain');

  // estimate current BF% using preferred path
  const latest = latestMetrics();
  const curWeight = (latest.weight ?? settings.weightLb) || 175;
  let curBF = null;
  if(settings.preferScaleBF==='on'){
    curBF = estimateBF_ScaleLike({weightLb: curWeight, lbmLb: latest.lbmLb, waterPct: latest.waterPct, musclePct: latest.musclePct});
  }
  if(curBF==null){
    const hIn = (settings.heightFt||0)*12 + (settings.heightIn||0);
    curBF = estimateBF_Anthro({sex:settings.sex, age:settings.age, heightInches:hIn, weightLb:curWeight, waistIn:latest.waist, hipIn:latest.hip, neckIn:latest.neck});
  }
  if(curBF==null) curBF = 25; // fallback

  // project next 8 weeks
  const weeks = Array.from({length:9}, (_,i)=>i); // 0..8
  const weights = weeks.map(w => +(curWeight + lbPerWeek*w).toFixed(1));
  const fatFrac = 0.75; // assume 75% of weight change is fat mass
  let fatMass0 = curWeight * (curBF/100);
  const bfs = weeks.map(w => {
    const deltaW = lbPerWeek*w;
    const fatMass = fatMass0 + deltaW*fatFrac;
    const totW = curWeight + deltaW;
    return +(clampPct(100*fatMass/Math.max(totW,1))).toFixed(1);
  });
  renderProjectionChart(weeks, weights, bfs);

  $('#projectionBox').innerHTML = `TDEE est: <strong>${Math.round(tdee)}</strong> kcal/day. At ${cals} kcal, projected <strong>${sign}</strong> ≈ ${Math.abs(lbPerWeek).toFixed(2)} lb/week.<br><span class="muted">BF% path prefers scale-assisted estimate (LBM/TBW) with hydration ${settings.ffmHydrationPct||73}%, plus calibration offset ${settings.bfCalOffset||0}%.</span>`;
});

// ---------- Dashboard
function renderDashboard(){
  const today = todayISO();
  const todayWs = workouts.filter(w=>w.date===today);
  const vol = todayWs.flatMap(w=>w.sets).reduce((t,s)=> t+(s.weight??0)*(s.reps??0),0);
  $('#todayMeta').textContent = today;
  $('#todaySummary').innerHTML = todayWs.length
    ? `<p>${todayWs.length} workout(s) logged. Volume: <strong>${fmt(vol)}</strong> (lb×reps).</p>`
    : `<p>No workout logged yet.</p><button class="btn primary" id="goLog2">Log a workout</button>`;
  const go2 = $('#goLog2'); if(go2) go2.addEventListener('click', ()=> $('[data-tab="workout"]').click());
  renderStreak();
}
function renderStreak(){
  const days = new Set(workouts.map(w=>w.date));
  let streak=0; let d = new Date();
  for(;;){
    const iso = d.toISOString().slice(0,10);
    if(days.has(iso)){ streak++; d.setDate(d.getDate()-1); } else break;
  }
  $('#streakBox').textContent = `🔥 ${streak}-day streak`;
  const box = $('#badges'); box.innerHTML='';
  Object.entries(badges).forEach(([k,v])=>{ if(v) { const b = document.createElement('span'); b.className='badge'; b.textContent = v; box.appendChild(b); } });
}
function maybeAwardBadgesAfterSave(){
  if(!badges.first){ badges.first = '🏅 First Workout Logged'; }
  const days = new Set(workouts.map(w=>w.date));
  let run=0; let d = new Date();
  while(days.has(d.toISOString().slice(0,10))){ run++; d.setDate(d.getDate()-1); }
  if(run>=5) badges.streak5 = '🔥 5-Day Streak';
  const prs = computePRs();
  if(Object.keys(prs).length && !badges.pr){ badges.pr = '💪 New PR'; }
  write(KEYS.badges, badges);
}

// ---------- Analytics
let charts = {};
function renderCharts(){
  for(const k in charts){ charts[k].destroy(); }
  charts = {};

  // Volume per week (lb×reps)
  const byWeek = {};
  workouts.forEach(w=>{
    const wk = isoYearWeek(w.date);
    const vol = w.sets.reduce((t,s)=>t+(s.weight??0)*(s.reps??0),0);
    byWeek[wk] = (byWeek[wk]||0)+vol;
  });
  const weekLabels = Object.keys(byWeek).sort();
  const weekData = weekLabels.map(k=>byWeek[k]);
  if($('#chartVolume')){
    charts.volume = new Chart($('#chartVolume'), {
      type:'bar', data:{labels:weekLabels, datasets:[{label:'Volume (lb×reps)', data:weekData}]},
      options:{responsive:true, maintainAspectRatio:false}
    });
  }

  // 1RM estimates (Epley) best per day
  const oneRM = {};
  workouts.forEach(w=>{
    let best = 0;
    w.sets.forEach(s=>{
      const est = epley1RM(s.weight??0, s.reps??0);
      if(est>best) best = est;
    });
    oneRM[w.date] = Math.max(oneRM[w.date]||0, best);
  });
  const d1 = Object.keys(oneRM).sort();
  if($('#chart1RM')){
    charts.onerm = new Chart($('#chart1RM'), {
      type:'line', data:{labels:d1, datasets:[{label:'Best 1RM (lb, est)', data:d1.map(k=>Math.round(oneRM[k]))}]},
      options:{responsive:true, maintainAspectRatio:false}
    });
  }

  // Body weight & body fat % trends
  const sortedM = metrics.slice().sort((a,b)=>a.date.localeCompare(b.date));
  if($('#chartBody')){
    charts.body = new Chart($('#chartBody'), {
      type:'line',
      data:{
        labels: sortedM.map(m=>m.date),
        datasets:[
          {label:'Weight (lb)', data: sortedM.map(m=>m.weight ?? null), yAxisID:'y'},
          {label:'Body Fat %', data: sortedM.map(m=>m.bodyFat ?? null), yAxisID:'y1'}
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{ y:{ type:'linear', position:'left'}, y1:{ type:'linear', position:'right'} }
      }
    });
  }

  // PR history (heaviest weight per exercise)
  const prs = computePRs(true);
  const labels = Object.keys(prs);
  const data = labels.map(n=>prs[n].weight);
  if($('#chartPR')){
    charts.pr = new Chart($('#chartPR'), {
      type:'bar', data:{labels, datasets:[{label:'Heaviest Weight (lb)', data}]},
      options:{responsive:true, maintainAspectRatio:false}
    });
  }
}

function epley1RM(weight, reps){
  if(!weight || !reps) return 0;
  return weight * (1 + reps/30);
}
function isoYearWeek(isoDate){
  const d = new Date(isoDate);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay()+6)%7);
  const week1 = new Date(d.getFullYear(),0,4);
  return d.getFullYear() + '-W' + String(1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay()+6)%7) / 7)).padStart(2,'0');
}
function computePRs(withDates=false){
  const map = {};
  workouts.forEach(w=>{
    w.sets.forEach(s=>{
      if(!s.name || !s.weight) return;
      if(!map[s.name] || s.weight > map[s.name].weight){
        map[s.name] = {weight:s.weight, date:w.date};
      }
    });
  });
  if(withDates) return map;
  const out = {}; Object.keys(map).forEach(k=>out[k]=map[k].weight); return out;
}

// ---------- Templates
const TEMPLATES = {
  fullbody: [
    {name:'Squat', reps:5, weight:'', rpe:7},
    {name:'Bench Press', reps:5, weight:'', rpe:7},
    {name:'Bent Row', reps:8, weight:'', rpe:7},
    {name:'Plank (sec)', reps:60, weight:'', rpe:''}
  ],
  ppl: [
    {name:'Bench Press', reps:5, weight:'', rpe:8},
    {name:'Incline DB Press', reps:10, weight:'', rpe:8},
    {name:'Lat Pulldown', reps:10, weight:'', rpe:8},
    {name:'Seated Row', reps:10, weight:'', rpe:8},
    {name:'Back Squat', reps:5, weight:'', rpe:8},
    {name:'Leg Press', reps:12, weight:'', rpe:8}
  ],
  fives: [
    {name:'Back Squat', reps:5, weight:'', rpe:8},
    {name:'Bench Press', reps:5, weight:'', rpe:8},
    {name:'Deadlift', reps:5, weight:'', rpe:8}
  ],
  phul: [
    {name:'Deadlift', reps:5, weight:'', rpe:8},
    {name:'OHP', reps:5, weight:'', rpe:8},
    {name:'Pull-up', reps:8, weight:'', rpe:8},
    {name:'Lunge', reps:10, weight:'', rpe:8}
  ]
};
$$('#templates .card .btn[data-template]').forEach(b=>{
  b.addEventListener('click', ()=>{
    setsBox.innerHTML='';
    TEMPLATES[b.dataset.template].forEach(t=> addSetRow(false, t));
    $('[data-tab="workout"]').click();
  });
});

// ---------- Demos
const DEMOS = [
  { name:'Barbell Back Squat', yt:'https://www.youtube.com/embed/ultWZbUMPL8' },
  { name:'Bench Press', yt:'https://www.youtube.com/embed/gRVjAtPip0Y' },
  { name:'Deadlift', yt:'https://www.youtube.com/embed/op9kVnSso6Q' },
  { name:'Overhead Press', yt:'https://www.youtube.com/embed/F3QY5vMz_6I' },
  { name:'Barbell Row', yt:'https://www.youtube.com/embed/vT2GjY_Umpw' },
  { name:'Lat Pulldown', yt:'https://www.youtube.com/embed/CAwf7n6Luuc' }
];
function renderDemos(){
  const lib = $('#demoLibrary');
  if(!lib) return;
  lib.innerHTML = DEMOS.map(d=>`
    <div class="demo">
      <h4>${d.name}</h4>
      <div class="row">
        <span class="muted">Form demo</span>
        <button class="btn" data-demo="${d.name}">?</button>
      </div>
    </div>
  `).join('');
  $$('#demoLibrary [data-demo]').forEach(btn=>{
    btn.addEventListener('click', ()=> openDemo(btn.dataset.demo));
  });
}
renderDemos();
const demoModal = $('#demoModal');
if($('#closeDemo')) $('#closeDemo').addEventListener('click', ()=> demoModal.close());
function openDemo(name){
  const d = DEMOS.find(x=>x.name===name);
  $('#demoTitle').textContent = name;
  $('#demoContent').innerHTML = `<iframe src="${d.yt}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  demoModal.showModal();
}

// ---------- Phase 2: Coach (rule-based generator)
const EXERCISE_POOL = {
  barbell: {
    strength: [
      {name:'Back Squat', reps:5, rpe:8}, {name:'Bench Press', reps:5, rpe:8},
      {name:'Deadlift', reps:5, rpe:8}, {name:'Overhead Press', reps:5, rpe:8},
      {name:'Barbell Row', reps:8, rpe:7}
    ],
    loss: [
      {name:'Circuit (Row + KB + Pushups)', reps:12, rpe:7},
      {name:'EMOM: Squat + OHP (light)', reps:10, rpe:7},
      {name:'Barbell Complex (light)', reps:8, rpe:7}
    ],
    general: [
      {name:'Bench Press', reps:8, rpe:7}, {name:'Back Squat', reps:8, rpe:7},
      {name:'Barbell Row', reps:10, rpe:7}, {name:'RDL', reps:10, rpe:7},
      {name:'OHP', reps:8, rpe:7}
    ]
  },
  dumbbells: {
    strength: [
      {name:'DB Bench', reps:6, rpe:8}, {name:'Goblet Squat', reps:8, rpe:8},
      {name:'DB Row', reps:10, rpe:8}, {name:'DB RDL', reps:8, rpe:8},
      {name:'DB Shoulder Press', reps:8, rpe:8}
    ],
    loss: [
      {name:'DB Circuit (Thruster/Row/Pushup)', reps:12, rpe:7},
      {name:'HIIT DB + Jump Rope', reps:30, rpe:7},
      {name:'Core + DB Carries', reps:40, rpe:7}
    ],
    general: [
      {name:'DB Bench', reps:10, rpe:7}, {name:'Split Squat', reps:10, rpe:7},
      {name:'DB Row', reps:12, rpe:7}, {name:'DB RDL', reps:12, rpe:7},
      {name:'DB Press', reps:10, rpe:7}
    ]
  },
  minimal: {
    strength: [
      {name:'Pistol Progressions', reps:6, rpe:8}, {name:'Push-up Weighted', reps:8, rpe:8},
      {name:'Chin-up Weighted', reps:6, rpe:8}, {name:'Pike Press', reps:8, rpe:8},
    ],
    loss: [
      {name:'Bodyweight Circuit', reps:15, rpe:7}, {name:'HIIT (BW + Sprints)', reps:30, rpe:7},
      {name:'Core Circuit', reps:40, rpe:7}
    ],
    general: [
      {name:'Push-ups', reps:12, rpe:7}, {name:'Split Squat (BW/DB)', reps:12, rpe:7},
      {name:'Pull-ups/Rows', reps:8, rpe:7}, {name:'Hip Hinge (Good morning/band)', reps:15, rpe:7},
      {name:'Core Plank', reps:60, rpe:6}
    ]
  }
};
function generatePlan(goal, days, equip){
  const pool = EXERCISE_POOL[equip][goal];
  const out = [];
  for(let i=0;i<days;i++){
    const daySets = [];
    for(let j=0;j<Math.min(4, pool.length); j++){
      const ex = pool[(i+j)%pool.length];
      daySets.push({name: ex.name, reps: ex.reps, weight:'', rpe: ex.rpe});
    }
    out.push({title:`${goal.toUpperCase()} — Day ${i+1}`, sets: daySets});
  }
  return out;
}
function renderPlanPreview(){
  const p = planState;
  const pane = $('#planOut');
  if(!pane) return;
  if(!p || !p.length){ pane.innerHTML = '<span class="muted">No plan generated yet.</span>'; return; }
  pane.innerHTML = p.map((d, idx)=> `<div><strong>${d.title}</strong><br>${d.sets.map(s=>`${s.name} ${s.reps} reps`).join(' • ')}</div>`).join('<hr style="border:0;border-top:1px solid #23242b;margin:.5rem 0">');
}
if($('#genPlan')){
  $('#genPlan').addEventListener('click', ()=>{
    const goal = $('#coachGoal').value;          // loss | strength | general
    const days = parseInt($('#coachDays').value||4);
    const equip = $('#coachEquip').value;        // barbell | dumbbells | minimal
    planState = generatePlan(goal, days, equip);
    write(KEYS.plan, planState);
    renderPlanPreview();
  });
}
if($('#loadToday')){
  $('#loadToday').addEventListener('click', ()=>{
    if(!planState || !planState.length){ alert('Generate a plan first.'); return; }
    // choose day by weekday index (Mon=1..Sun=0) mapped to plan length
    const idx = (new Date().getDay() + 6) % 7 % planState.length;
    const day = planState[idx];
    // load into workout form
    $('[data-tab="workout"]').click();
    setsBox.innerHTML='';
    day.sets.forEach(s=> addSetRow(false, s));
    $('#wDate').value = todayISO();
    $('#wTitle').value = day.title;
  });
}

// ---------- Phase 2: Muscle Readiness visualization
// Map exercises to primary muscle groups (simple heuristic)
const MUSCLE_MAP = [
  {group:'Chest',  match:/bench|press|push-up|pushup|dip/i},
  {group:'Back',   match:/row|pull|pulldown|chin|deadlift|rdl/i},
  {group:'Legs',   match:/squat|lunge|leg|deadlift|rdl|pistol/i},
  {group:'Arms',   match:/curl|triceps|tricep|biceps|bicep|chin|dip/i},
  {group:'Core',   match:/core|plank|ab|crunch|carry|pallof|good morning/i}
];
const GROUPS = ['Chest','Back','Legs','Arms','Core'];
function exerciseGroup(name){
  const hit = MUSCLE_MAP.find(m => m.match.test(name));
  return hit ? hit.group : 'Core'; // fallback
}
// Compute fatigue over past 5 days with exponential decay (half-life ~48h)
function computeReadinessScores(){
  const now = new Date();
  const windowDays = 5;
  const halfLifeHrs = 48;
  const k = Math.log(2)/ (halfLifeHrs); // decay/hour
  const base = Object.fromEntries(GROUPS.map(g=>[g, 0]));

  workouts.forEach(w=>{
    const dt = new Date(w.date);
    const diffHours = (now - dt) / 36e5;
    if(diffHours < 24*windowDays && diffHours >= 0){
      const decay = Math.exp(-k * diffHours);
      w.sets.forEach(s=>{
        const g = exerciseGroup(s.name||'');
        // training stress ~ weight*reps normalized
        const stress = ((s.weight||0) * (s.reps||0)) / 1000; // heuristic scaling
        base[g] += stress * decay;
      });
    }
  });
  // Convert stress to readiness 0..1 (lower stress -> more fresh)
  const maxStress = Math.max(0.001, Math.max(...Object.values(base)));
  const readiness = {};
  GROUPS.forEach(g=>{
    const norm = base[g]/maxStress;           // 0..1
    const fresh = 1 - Math.min(1, norm);      // 1..0
    readiness[g] = fresh;                     // 1 fresh, 0 fatigued
  });
  return readiness;
}
function colorForReadiness(x){
  // x: 0..1 -> fatigued(red) to fresh(green)
  if(x >= 0.66) return '#3fc29a';
  if(x >= 0.33) return '#ffd43b';
  return '#ff6b6b';
}
function renderReadiness(){
  const svg = $('#readiness'); if(!svg) return;
  const legend = $('#readinessLegend');
  legend.innerHTML = `
    <span><span class="legend-dot fresh"></span>Fresh</span>
    <span><span class="legend-dot moderate"></span>Moderate</span>
    <span><span class="legend-dot fatigued"></span>Fatigued</span>`;
  svg.innerHTML = '';
  const scores = computeReadinessScores();
  // draw 5 circles evenly
  GROUPS.forEach((g, i)=>{
    const cx = 50 + i * 50; const cy = 70;
    const r = 22;
    const color = colorForReadiness(scores[g]||0.5);
    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy);
    circle.setAttribute('r', r); circle.setAttribute('fill', color);
    svg.appendChild(circle);
    const text = document.createElementNS('http://www.w3.org/2000/svg','text');
    text.textContent = g[0];
    text.setAttribute('x', cx); text.setAttribute('y', cy+5);
    text.setAttribute('fill', '#fff'); text.setAttribute('text-anchor','middle');
    text.setAttribute('font-size','12');
    svg.appendChild(text);
  });
}

// ---------- Phase 2: Goals
if($('#saveGoals')){
  $('#saveGoals').addEventListener('click', ()=>{
    goals = {
      weight: parseNum($('#gWeight').value),
      date: $('#gDate').value,
      lift: $('#gLiftName').value.trim(),
      lift1RM: parseNum($('#gLift1RM').value)
    };
    write(KEYS.goals, goals);
    updateGoalProgress();
    alert('Goals saved.');
  });
}
function updateGoalProgress(){
  const box = $('#goalsProgress'); if(!box) return;
  const s = settings;
  if(!goals || (!goals.weight && !goals.lift1RM)){ box.innerHTML = '<p class="muted">No goals set yet.</p>'; return; }

  let html = '';
  if(goals.weight){
    const cur = (latestMetrics().weight ?? s.weightLb) || s.weightLb;
    const diff = goals.weight - cur;
    const pct = Math.min(100, Math.max(0, (goals.weight===0?0: ( (goals.weight>cur ? cur/goals.weight : goals.weight/cur) * 100 )))).toFixed(1);
    const rem = Math.abs(diff).toFixed(1);
    html += `<p>Current weight: <strong>${cur} lb</strong> → Goal: <strong>${goals.weight} lb</strong> (${diff>0?'gain':'loss'} remaining: <strong>${rem} lb</strong>)</p>`;
    if(goals.date){
      const daysLeft = Math.ceil((new Date(goals.date) - new Date())/86400000);
      if(isFinite(daysLeft)) html += `<p>Target date: ${goals.date} (${daysLeft>=0?daysLeft+' days remaining':'past due'})</p>`;
    }
    html += progressBar(cur, goals.weight, 'lb');
  }
  if(goals.lift && goals.lift1RM){
    // estimate best 1RM to date
    const prs = computePRs(true);
    const best = prs[goals.lift]?.weight || 0;
    html += `<p>${goals.lift} 1RM: current <strong>${Math.round(best)} lb</strong> → goal <strong>${goals.lift1RM} lb</strong></p>`;
    html += progressBar(best, goals.lift1RM, 'lb');
  }
  box.innerHTML = html;
}
function progressBar(current, target, unit){
  const pct = Math.max(0, Math.min(100, (current/Math.max(1,target))*100));
  return `
  <div style="background:#11131a;border:1px solid #22232a;border-radius:10px;overflow:hidden;height:14px;margin:.4rem 0">
    <div style="height:14px;width:${pct}%;background:#63e6be"></div>
  </div>
  <small class="muted">${fmt(current)} ${unit} / ${fmt(target)} ${unit} (${pct.toFixed(1)}%)</small>`;
}

// ---------- Phase 2: Community (local-only, opt-in, share/import)
function renderFeed(){
  $('#cName').value = community.name || '';
  $('#cOptIn').value = community.optIn || 'off';
  const feedBox = $('#feed'); if(!feedBox) return;
  feedBox.innerHTML = (community.feed||[]).map(item => `
    <div class="item">
      <div class="author">${escapeHtml(item.author||'Friend')}</div>
      <div class="content">${escapeHtml(item.text||'')}</div>
    </div>`).join('') || '<p class="muted">No posts yet.</p>';
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
if($('#cOptIn')) $('#cOptIn').addEventListener('change', e=>{
  community.optIn = e.target.value; write(KEYS.community, community);
});
if($('#cName')) $('#cName').addEventListener('input', e=>{
  community.name = e.target.value; write(KEYS.community, community);
});
if($('#cShare')) $('#cShare').addEventListener('click', async ()=>{
  // Share latest summary (no PII besides chosen name)
  const latestW = workouts.slice().sort((a,b)=>b.date.localeCompare(a.date))[0];
  const latestM = latestMetrics();
  const summary = {
    name: community.name || 'Anonymous',
    lastWorkout: latestW ? {date: latestW.date, title: latestW.title, volume: latestW.sets.reduce((t,s)=>t+(s.weight||0)*(s.reps||0),0)} : null,
    weight: latestM.weight ?? settings.weightLb,
    bf: latestM.bodyFat ?? null
  };
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(summary))));
  try {
    await navigator.clipboard.writeText(code);
    alert('Share code copied to clipboard!');
  } catch {
    prompt('Copy your share code:', code);
  }
});
if($('#cImport')) $('#cImport').addEventListener('click', ()=>{
  const txt = $('#cImportText').value.trim();
  if(!txt) return alert('Paste a share code first.');
  try{
    const data = JSON.parse(decodeURIComponent(escape(atob(txt))));
    community.feed = community.feed || [];
    community.feed.unshift({
      author: data.name || 'Friend',
      text: data.lastWorkout
        ? `${data.name||'Friend'} trained "${data.lastWorkout.title}" on ${data.lastWorkout.date} (volume ${fmt(data.lastWorkout.volume)}). Weight: ${data.weight??'?'} lb${data.bf?`, ~${data.bf}% BF`:''}.`
        : `${data.name||'Friend'} shared stats. Weight: ${data.weight??'?'} lb${data.bf?`, ~${data.bf}% BF`:''}.`
    });
    // keep last 50
    community.feed = community.feed.slice(0,50);
    write(KEYS.community, community);
    renderFeed();
    $('#cImportText').value='';
  } catch(e){
    alert('Invalid code!');
  }
});

// ---------- initial render
renderHistory(); renderDashboard(); renderCharts(); renderMetrics();
renderPlanPreview(); renderReadiness(); renderFeed(); updateGoalProgress();

// ---------- BMR/TDEE (metric internal)
function calcBmrTdee(sex, age, heightCm, weightKg){
  let bmr;
  if(sex === 'male') bmr = 10*weightKg + 6.25*heightCm - 5*age + 5;
  else bmr = 10*weightKg + 6.25*heightCm - 5*age - 161;
  return { bmr, tdeeModerate: bmr * 1.55 };
}
