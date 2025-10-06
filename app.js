// LiftLog (imperial-only UI: lb, ft, in) — localStorage-based tracker
const KEYS = {
  workouts: 'll.workouts',
  metrics: 'll.metrics',
  settings: 'll.settings',
  badges: 'll.badges',
  migrated: 'll.migratedImperialV1'
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

// ---------- state
let workouts = read(KEYS.workouts, []);
let metrics  = read(KEYS.metrics,  []);
let settings = read(KEYS.settings, { sex:'male', age:25, heightFt:5, heightIn:10, weightLb:175, gamify:'on' });
let badges = read(KEYS.badges, {});

// ---------- migration from old metric data (one-time)
(function migrateToImperial(){
  if(read(KEYS.migrated, false)) return;
  const old = read(KEYS.settings, null);
  if(old && (old.units === 'metric' || (old.height && old.weight && !('heightFt' in old)))){
    // settings
    const heightCm = Number(old.height) || 175;
    const totalIn = heightCm / 2.54;
    const ft = Math.floor(totalIn / 12);
    const inch = totalIn - ft*12;
    const weightLb = (Number(old.weight) || 75) * 2.20462;
    settings = { sex: old.sex || 'male', age: old.age || 25, heightFt: ft, heightIn: +inch.toFixed(1), weightLb: +weightLb.toFixed(1), gamify: old.gamify || 'on' };
    write(KEYS.settings, settings);

    // metrics
    metrics = metrics.map(m => {
      const out = {...m};
      if('height' in out){ // cm -> ft/in
        const ti = (Number(out.height)||0)/2.54; const f = Math.floor(ti/12); const i = ti - f*12;
        out.heightFt = f; out.heightIn = +i.toFixed(1); delete out.height;
      }
      if(typeof out.waist === 'number' && out.waist > 50) out.waist = +(out.waist/2.54).toFixed(1);
      if(typeof out.hip === 'number' && out.hip > 50) out.hip = +(out.hip/2.54).toFixed(1);
      if(typeof out.chest === 'number' && out.chest > 50) out.chest = +(out.chest/2.54).toFixed(1);
      if(typeof out.weight === 'number' && out.weight < 300) out.weight = +(out.weight*2.20462).toFixed(1);
      return out;
    });
    write(KEYS.metrics, metrics);

    // workouts: convert set weights kg->lb
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
    if(id === 'dashboard') renderDashboard();
    if(id === 'metrics') renderMetrics();
  });
});
$('#goLog').addEventListener('click', () => {
  $('[data-tab="workout"]').click();
});
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
  renderHistory(); renderDashboard(); alert('Workout saved.');
});

// history
$('#historySearch').addEventListener('input', renderHistory);
$('#exportData').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify({workouts, metrics, settings, badges}, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liftlog-export.json';
  a.click();
});
$('#clearAll').addEventListener('click', ()=>{
  if(confirm('Clear ALL workouts & metrics? This cannot be undone.')){
    workouts = []; metrics = []; badges = {}; write(KEYS.workouts, workouts); write(KEYS.metrics, metrics); write(KEYS.badges, badges);
    renderHistory(); renderMetrics(); renderDashboard();
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
    <div class="muted">Formula: Mifflin–St Jeor. Uses your Settings + latest metrics (imperial inputs converted internally).</div>`;
});
$('#saveMetrics').addEventListener('click', ()=>{
  const entry = {
    date: $('#mDate').value || todayISO(),
    heightFt: parseNum($('#mHeightFt').value),
    heightIn: parseNum($('#mHeightIn').value),
    weight: parseNum($('#mWeightLb').value), // lb
    bodyFat: parseNum($('#mBodyFat').value),
    waist: parseNum($('#mWaist').value), // in
    hip: parseNum($('#mHip').value),     // in
    chest: parseNum($('#mChest').value), // in
    rhr: parseNum($('#mRHR').value)
  };
  metrics.push(entry); write(KEYS.metrics, metrics);
  renderMetrics(); renderDashboard(); alert('Metrics saved.');
});

function renderMetrics(){
  const list = metrics.slice().sort((a,b)=>b.date.localeCompare(a.date));
  $('#metricsList').innerHTML = list.map(m=>{
    const parts = [];
    if(m.heightFt!=null || m.heightIn!=null) parts.push(`Height: ${m.heightFt??'?'} ft ${m.heightIn??'?'} in`);
    if(m.weight!=null) parts.push(`Weight: ${m.weight} lb`);
    if(m.bodyFat!=null) parts.push(`BodyFat: ${m.bodyFat}%`);
    if(m.waist!=null) parts.push(`Waist: ${m.waist} in`);
    if(m.hip!=null) parts.push(`Hip: ${m.hip} in`);
    if(m.chest!=null) parts.push(`Chest: ${m.chest} in`);
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
}
loadSettingsForm();
$('#saveSettings').addEventListener('click', ()=>{
  settings.sex = $('#sSex').value;
  settings.age = parseInt($('#sAge').value||settings.age);
  settings.heightFt = parseNum($('#sHeightFt').value) ?? settings.heightFt;
  settings.heightIn = parseNum($('#sHeightIn').value) ?? settings.heightIn;
  settings.weightLb = parseNum($('#sWeightLb').value) ?? settings.weightLb;
  settings.gamify = $('#sGamify').value;
  write(KEYS.settings, settings);
  alert('Settings saved.');
  renderDashboard();
});
$('#resetAll').addEventListener('click', ()=>{
  if(confirm('Reset everything to factory settings? All data will be erased.')){
    localStorage.clear();
    location.reload();
  }
});

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
  const kgPerWeek = lbPerWeek * 0.453592;
  const sign = lbPerWeek>0 ? 'gain' : (lbPerWeek<0 ? 'loss' : 'maintain');
  $('#projectionBox').innerHTML = `TDEE est: <strong>${Math.round(tdee)}</strong> kcal/day. At ${cals} kcal, projected <strong>${sign}</strong> ≈ ${Math.abs(lbPerWeek).toFixed(2)} lb/week (${Math.abs(kgPerWeek).toFixed(2)} kg/week).`;
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
  renderCharts();
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
  Object.entries(badges).forEach(([k,v])=>{
    if(v) { const b = document.createElement('span'); b.className='badge'; b.textContent = v; box.appendChild(b); }
  });
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
  charts.volume = new Chart($('#chartVolume'), {
    type:'bar', data:{labels:weekLabels, datasets:[{label:'Volume (lb×reps)', data:weekData}]},
    options:{responsive:true, maintainAspectRatio:false}
  });

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
  charts.onerm = new Chart($('#chart1RM'), {
    type:'line', data:{labels:d1, datasets:[{label:'Best 1RM (lb, est)', data:d1.map(k=>Math.round(oneRM[k]))}]},
    options:{responsive:true, maintainAspectRatio:false}
  });

  // Body weight & body fat % trends
  const sortedM = metrics.slice().sort((a,b)=>a.date.localeCompare(b.date));
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

  // PR history (heaviest weight per exercise)
  const prs = computePRs(true);
  const labels = Object.keys(prs);
  const data = labels.map(n=>prs[n].weight);
  charts.pr = new Chart($('#chartPR'), {
    type:'bar', data:{labels, datasets:[{label:'Heaviest Weight (lb)', data}]},
    options:{responsive:true, maintainAspectRatio:false}
  });
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
$('#closeDemo').addEventListener('click', ()=> demoModal.close());
function openDemo(name){
  const d = DEMOS.find(x=>x.name===name);
  $('#demoTitle').textContent = name;
  $('#demoContent').innerHTML = `<iframe src="${d.yt}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  demoModal.showModal();
}

// ---------- Charts need render on first load
renderHistory(); renderDashboard(); renderMetrics();

// ---------- BMR/TDEE helper (expects metric inputs internally)
function calcBmrTdee(sex, age, heightCm, weightKg){
  let bmr;
  if(sex === 'male') bmr = 10*weightKg + 6.25*heightCm - 5*age + 5;
  else bmr = 10*weightKg + 6.25*heightCm - 5*age - 161;
  return { bmr, tdeeModerate: bmr * 1.55 };
}
