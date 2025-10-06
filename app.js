// LiftLog — imperial-only with BF% calibration/hybrid
const KEYS = { workouts:'ll.workouts', metrics:'ll.metrics', settings:'ll.settings', badges:'ll.badges', migrated:'ll.migratedImperialV1' };
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const todayISO = () => new Date().toISOString().slice(0,10);
const parseNum = v => (v===''||v==null||isNaN(Number(v)))?null:Number(v);
const uid = () => Math.random().toString(36).slice(2,10);
const read = (k,f)=>{ try{return JSON.parse(localStorage.getItem(k))??f;}catch(e){return f;} };
const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const fmt=n=>(Math.round(n*100)/100).toLocaleString();

let workouts = read(KEYS.workouts, []);
let metrics  = read(KEYS.metrics,  []);
let settings = read(KEYS.settings, { sex:'male', age:25, heightFt:5, heightIn:10, weightLb:175, gamify:'on', bfSource:'manual', bfCalOffset:0 });
let badges   = read(KEYS.badges, {});

// one-time migration (if old metric units existed)
(function(){
  if(read(KEYS.migrated,false)) return;
  const old = read(KEYS.settings,null);
  if(old && (old.units==='metric'||(old.height&&old.weight&&!('heightFt'in old)))){
    const heightCm = Number(old.height)||175, totalIn = heightCm/2.54;
    const ft = Math.floor(totalIn/12), inch = totalIn-ft*12;
    const weightLb = (Number(old.weight)||75)*2.20462;
    settings = { sex:old.sex||'male', age:old.age||25, heightFt:ft, heightIn:+inch.toFixed(1), weightLb:+weightLb.toFixed(1), gamify:old.gamify||'on', bfSource:'manual', bfCalOffset:0 };
    write(KEYS.settings, settings);
    metrics = metrics.map(m=>{ const o={...m};
      if('height'in o){ const ti=(+o.height||0)/2.54, f=Math.floor(ti/12), i=ti-f*12; o.heightFt=f;o.heightIn=+i.toFixed(1); delete o.height; }
      if(typeof o.waist==='number'&&o.waist>50) o.waist=+(o.waist/2.54).toFixed(1);
      if(typeof o.hip==='number'&&o.hip>50) o.hip=+(o.hip/2.54).toFixed(1);
      if(typeof o.chest==='number'&&o.chest>50) o.chest=+(o.chest/2.54).toFixed(1);
      if(typeof o.weight==='number'&&o.weight<300) o.weight=+(o.weight*2.20462).toFixed(1);
      return o; }); write(KEYS.metrics, metrics);
    workouts = workouts.map(w=>({...w, sets:(w.sets||[]).map(s=>typeof s.weight==='number'?{...s, weight:+(s.weight*2.20462).toFixed(1)}:s)}));
    write(KEYS.workouts, workouts);
  }
  write(KEYS.migrated,true);
})();

// nav
$$('.tab').forEach(b=>b.addEventListener('click', ()=>{
  $$('.tab').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  $$('.panel').forEach(p=>p.classList.remove('active')); document.getElementById(b.dataset.tab).classList.add('active');
  if(b.dataset.tab==='dashboard') renderDashboard();
  if(b.dataset.tab==='metrics') renderMetrics();
}));
document.getElementById('goLog').addEventListener('click', ()=> $$('[data-tab="workout"]')[0].click());
document.getElementById('year').textContent=new Date().getFullYear();

// workout form
const setsBox = document.getElementById('sets');
document.getElementById('wDate').value=todayISO();
function addSetRow(superset=false, preset={}){
  const d=document.createElement('div'); d.className='set'+(superset?' superset':''); d.innerHTML=`
    <input placeholder="Exercise (e.g., Bench Press)" class="exName" value="${preset.name??''}"/>
    <input type="number" step="1" placeholder="Reps" class="exReps" value="${preset.reps??''}"/>
    <input type="number" step="0.5" placeholder="Weight (lb)" class="exWeight" value="${preset.weight??''}"/>
    <input type="number" step="0.5" placeholder="RPE (opt)" class="exRPE" value="${preset.rpe??''}"/>
    <button type="button" class="btn" data-del>Delete</button>`;
  d.querySelector('[data-del]').onclick=()=>d.remove();
  setsBox.appendChild(d);
}
document.getElementById('addSet').onclick=()=>addSetRow(false);
document.getElementById('addSuperset').onclick=()=>addSetRow(true);
addSetRow(false);

document.getElementById('workoutForm').addEventListener('submit', e=>{
  e.preventDefault();
  const date=document.getElementById('wDate').value||todayISO();
  const title=document.getElementById('wTitle').value.trim()||'Workout';
  const notes=document.getElementById('wNotes').value.trim();
  const sets = $$('.set').map(s=>({
    name:s.querySelector('.exName').value.trim(),
    reps:parseNum(s.querySelector('.exReps').value),
    weight:parseNum(s.querySelector('.exWeight').value),
    rpe:parseNum(s.querySelector('.exRPE').value)
  })).filter(s=>s.name);
  if(!sets.length){ alert('Add at least one set'); return; }
  workouts.push({id:uid(), date, title, notes, sets}); write(KEYS.workouts, workouts);
  maybeAwardBadgesAfterSave();
  setsBox.innerHTML=''; document.getElementById('wTitle').value=''; document.getElementById('wNotes').value=''; addSetRow(false);
  renderHistory(); renderDashboard(); alert('Workout saved.');
});

document.getElementById('historySearch').addEventListener('input', renderHistory);
document.getElementById('exportData').onclick=()=>{ const blob=new Blob([JSON.stringify({workouts,metrics,settings,badges},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='liftlog-export.json'; a.click(); };
document.getElementById('clearAll').onclick=()=>{ if(confirm('Clear ALL workouts & metrics?')){ workouts=[];metrics=[];badges={}; write(KEYS.workouts,workouts);write(KEYS.metrics,metrics);write(KEYS.badges,badges); renderHistory();renderMetrics();renderDashboard(); }};

function renderHistory(){
  const q=document.getElementById('historySearch').value.toLowerCase().trim();
  const list=workouts.slice().sort((a,b)=>b.date.localeCompare(a.date));
  const out=list.filter(w=>{ const hay=(w.title+' '+w.notes+' '+w.sets.map(s=>s.name).join(' ')).toLowerCase(); return !q||hay.includes(q); })
    .map(w=>{ const vol=w.sets.reduce((t,s)=>t+(s.weight??0)*(s.reps??0),0);
      const items=w.sets.map(s=>`${s.name} — ${s.reps??'?'} x ${s.weight??'?'} lb`).join('<br>');
      return `<div class="item"><div class="row"><strong>${w.date}</strong><span>${w.title}</span><div class="spacer"></div><small>Volume: ${fmt(vol)}</small></div><div class="muted">${w.notes||''}</div><div>${items}</div></div>`; }).join('');
  document.getElementById('historyList').innerHTML = out || '<p class="muted">No workouts yet.</p>';
}

// BF estimators
function estimateBodyFatPercent({sex, age, heightInches, weightLb, waistIn, hipIn, neckIn}){
  const log10 = x => Math.log(x)/Math.LN10; let bf=null;
  if(sex==='male' && waistIn && neckIn && heightInches && waistIn>neckIn){
    bf = 86.010*log10(waistIn - neckIn) - 70.041*log10(heightInches) + 36.76;
  } else if(sex==='female' && waistIn && hipIn && neckIn && heightInches && waistIn+hipIn>neckIn){
    bf = 163.205*log10(waistIn + hipIn - neckIn) - 97.684*log10(heightInches) - 78.387;
  }
  if(bf==null && waistIn && weightLb){
    bf = (sex==='male'
      ? (((waistIn*4.15) - (weightLb*0.082) - 98.42) / weightLb) * 100
      : (((waistIn*4.15) - (weightLb*0.082) - 76.76) / weightLb) * 100);
  }
  if(bf==null && heightInches && weightLb){
    const bmi = (703*weightLb)/(heightInches*heightInches);
    bf = 1.20*bmi + 0.23*age - 10.8*(sex==='male'?1:0) - 5.4;
  }
  if(bf==null || !isFinite(bf)) return null;
  return Math.max(3, Math.min(60, bf));
}
function latestMetrics(){ const s=metrics.slice().sort((a,b)=>b.date.localeCompare(a.date)); return s[0]||{}; }
function getBFForEntry(entry){
  if(settings.bfSource==='manual') return entry.bodyFat ?? null;
  const est = estimateBodyFatPercent({
    sex:settings.sex, age:settings.age,
    heightInches: ((entry.heightFt??settings.heightFt||0)*12 + (entry.heightIn??settings.heightIn||0)),
    weightLb: entry.weight ?? settings.weightLb,
    waistIn: entry.waist, hipIn: entry.hip, neckIn: entry.neck
  });
  if(settings.bfSource==='estimated') return est;
  const off = Number(settings.bfCalOffset||0);
  if(est==null) return entry.bodyFat ?? null;
  return est + off;
}

// Metrics
document.getElementById('mDate').value=todayISO();
document.getElementById('calcBMR').onclick=()=>{
  const hFt=parseNum(document.getElementById('mHeightFt').value)??settings.heightFt;
  const hIn=parseNum(document.getElementById('mHeightIn').value)??settings.heightIn;
  const totalIn=(hFt||0)*12+(hIn||0), heightCm=totalIn*2.54;
  const weightLb=parseNum(document.getElementById('mWeightLb').value)??settings.weightLb, weightKg=(weightLb||0)*0.453592;
  const res=calcBmrTdee(settings.sex, settings.age, heightCm, weightKg);
  document.getElementById('bmrBox').innerHTML = `
    <div>Estimated BMR: <strong>${Math.round(res.bmr)} kcal</strong></div>
    <div>TDEE (moderate): <strong>${Math.round(res.tdeeModerate)} kcal</strong></div>
    <div class="muted">Mifflin–St Jeor. Imperial inputs converted internally.</div>`;
};
document.getElementById('estimateBF').onclick=()=>{
  const hFt=parseNum(document.getElementById('mHeightFt').value)??settings.heightFt;
  const hIn=parseNum(document.getElementById('mHeightIn').value)??settings.heightIn;
  const totalIn=(hFt||0)*12+(hIn||0);
  const weightLb=parseNum(document.getElementById('mWeightLb').value)??settings.weightLb;
  const waist=parseNum(document.getElementById('mWaist').value);
  const hip=parseNum(document.getElementById('mHip').value);
  const neck=parseNum(document.getElementById('mNeck').value);
  const bf=estimateBodyFatPercent({sex:settings.sex, age:settings.age, heightInches:totalIn, weightLb, waistIn:waist, hipIn:hip, neckIn:neck});
  document.getElementById('bfBox').innerHTML = bf==null? 'Not enough data to estimate body fat.' : `Estimated BF%: <strong>${bf.toFixed(1)}%</strong> (tape-measure methods).`;
  if(bf!=null){ const i=document.getElementById('mBodyFat'); if(i) i.value=bf.toFixed(1); }
};
document.getElementById('calibrateBF').onclick=()=>{
  const hFt=parseNum(document.getElementById('mHeightFt').value)??settings.heightFt;
  const hIn=parseNum(document.getElementById('mHeightIn').value)??settings.heightIn;
  const totalIn=(hFt||0)*12+(hIn||0);
  const weightLb=parseNum(document.getElementById('mWeightLb').value)??settings.weightLb;
  const waist=parseNum(document.getElementById('mWaist').value);
  const hip=parseNum(document.getElementById('mHip').value);
  const neck=parseNum(document.getElementById('mNeck').value);
  const manual=parseNum(document.getElementById('mBodyFat').value);
  if(manual==null){ alert('Enter your scale BF% in the Body Fat % field first.'); return; }
  const est=estimateBodyFatPercent({sex:settings.sex, age:settings.age, heightInches:totalIn, weightLb, waistIn:waist, hipIn:hip, neckIn:neck});
  if(est==null){ alert('Not enough measurements to compute an estimate for calibration.'); return; }
  settings.bfCalOffset = manual - est; settings.bfSource = 'hybrid'; write(KEYS.settings, settings);
  loadSettingsForm(); alert(`Calibration set. Offset = ${settings.bfCalOffset.toFixed(1)}%. Future estimates will add this.`);
};
document.getElementById('saveMetrics').onclick=()=>{
  const e={
    date: document.getElementById('mDate').value || todayISO(),
    heightFt: parseNum(document.getElementById('mHeightFt').value),
    heightIn: parseNum(document.getElementById('mHeightIn').value),
    weight: parseNum(document.getElementById('mWeightLb').value),
    bodyFat: parseNum(document.getElementById('mBodyFat').value),
    waist: parseNum(document.getElementById('mWaist').value),
    hip: parseNum(document.getElementById('mHip').value),
    chest: parseNum(document.getElementById('mChest').value),
    neck: parseNum(document.getElementById('mNeck').value),
    rhr: parseNum(document.getElementById('mRHR').value),
    musclePct: parseNum(document.getElementById('mMusclePct').value),
    waterPct: parseNum(document.getElementById('mWaterPct').value),
    boneLb: parseNum(document.getElementById('mBoneLb').value),
    proteinPct: parseNum(document.getElementById('mProteinPct').value),
    visceral: parseNum(document.getElementById('mVisceral').value)
  };
  metrics.push(e); write(KEYS.metrics, metrics); renderMetrics(); renderDashboard(); alert('Metrics saved.');
};

function renderMetrics(){
  const list=metrics.slice().sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('metricsList').innerHTML = list.map(m=>{
    const bf=getBFForEntry(m);
    const parts=[];
    if(m.heightFt!=null||m.heightIn!=null) parts.push(`Height: ${m.heightFt??'?'} ft ${m.heightIn??'?'} in`);
    if(m.weight!=null) parts.push(`Weight: ${m.weight} lb`);
    if(bf!=null) parts.push(`BF: ${bf.toFixed(1)}%`); else if(m.bodyFat!=null) parts.push(`BF: ${m.bodyFat}%`);
    if(m.waist!=null) parts.push(`Waist: ${m.waist} in`);
    if(m.hip!=null) parts.push(`Hip: ${m.hip} in`);
    if(m.chest!=null) parts.push(`Chest: ${m.chest} in`);
    if(m.neck!=null) parts.push(`Neck: ${m.neck} in`);
    if(m.rhr!=null) parts.push(`RHR: ${m.rhr} bpm`);
    if(m.musclePct!=null) parts.push(`Muscle: ${m.musclePct}%`);
    if(m.waterPct!=null) parts.push(`Water: ${m.waterPct}%`);
    if(m.boneLb!=null) parts.push(`Bone: ${m.boneLb} lb`);
    if(m.proteinPct!=null) parts.push(`Protein: ${m.proteinPct}%`);
    if(m.visceral!=null) parts.push(`Visceral: ${m.visceral}`);
    return `<div class="item"><strong>${m.date}</strong> — ${parts.join(' • ')}</div>`;
  }).join('') || '<p class="muted">No metrics logged.</p>';
}

// settings
function loadSettingsForm(){
  document.getElementById('sSex').value=settings.sex;
  document.getElementById('sAge').value=settings.age;
  document.getElementById('sHeightFt').value=settings.heightFt??5;
  document.getElementById('sHeightIn').value=settings.heightIn??10;
  document.getElementById('sWeightLb').value=settings.weightLb??175;
  document.getElementById('sGamify').value=settings.gamify;
  document.getElementById('sBfSource').value=settings.bfSource??'manual';
  const off=Number(settings.bfCalOffset||0).toFixed(1);
  document.getElementById('calibNote').textContent = (settings.bfSource==='hybrid' && off!=0) ? `Calibrated offset: ${off}%` : '';
}
loadSettingsForm();
document.getElementById('saveSettings').onclick=()=>{
  settings.sex=document.getElementById('sSex').value;
  settings.age=parseInt(document.getElementById('sAge').value||settings.age);
  settings.heightFt=parseNum(document.getElementById('sHeightFt').value)??settings.heightFt;
  settings.heightIn=parseNum(document.getElementById('sHeightIn').value)??settings.heightIn;
  settings.weightLb=parseNum(document.getElementById('sWeightLb').value)??settings.weightLb;
  settings.gamify=document.getElementById('sGamify').value;
  settings.bfSource=document.getElementById('sBfSource').value;
  write(KEYS.settings, settings); alert('Settings saved.'); loadSettingsForm(); renderDashboard();
};
document.getElementById('resetAll').onclick=()=>{ if(confirm('Reset everything to factory settings? All data will be erased.')){ localStorage.clear(); location.reload(); }};

// Projection chart
let chartsProj=null;
function renderProjectionChart(weeks, weights, bfs){
  if(chartsProj){ chartsProj.destroy(); chartsProj=null; }
  chartsProj = new Chart(document.getElementById('chartProj'), {
    type:'line',
    data:{ labels: weeks.map(w=>`W${w}`), datasets:[ {label:'Weight (lb)', data:weights, yAxisID:'y'}, {label:'Body Fat %', data:bfs, yAxisID:'y1'} ] },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{type:'linear',position:'left'}, y1:{type:'linear',position:'right'} } }
  });
}

// calories & projection
document.getElementById('estimateWeight').onclick=()=>{
  const cals=parseNum(document.getElementById('caloriesInput').value);
  const activity=document.getElementById('activityLevel').value;
  if(!cals){ alert('Enter your daily calories.'); return; }
  const heightCm=((settings.heightFt||0)*12+(settings.heightIn||0))*2.54;
  const weightKg=(settings.weightLb||0)*0.453592;
  const {bmr}=calcBmrTdee(settings.sex, settings.age, heightCm, weightKg);
  const mult={sedentary:1.2, light:1.375, moderate:1.55, very:1.725, athlete:1.9}[activity];
  const tdee=bmr*mult, delta=cals-tdee, lbPerWeek=delta/3500*7;
  const sign=lbPerWeek>0?'gain':(lbPerWeek<0?'loss':'maintain');

  const latest=latestMetrics();
  const curWeight=(latest.weight??settings.weightLb)||175;
  let curBF=getBFForEntry(latest);
  const hIn=(settings.heightFt||0)*12+(settings.heightIn||0);
  if(curBF==null){ curBF=estimateBodyFatPercent({sex:settings.sex,age:settings.age,heightInches:hIn,weightLb:curWeight,waistIn:latest.waist,hipIn:latest.hip,neckIn:latest.neck}); }

  const weeks=Array.from({length:9},(_,i)=>i);
  const weights=weeks.map(w=>+(curWeight+lbPerWeek*w).toFixed(1));
  const fatFrac=0.75;
  let fatMass0=curBF!=null?curWeight*(curBF/100):curWeight*0.25;
  const bfs=weeks.map(w=>{ const d=lbPerWeek*w; const fat=fatMass0+d*fatFrac; const tot=curWeight+d; return +(Math.max(3,Math.min(60,100*fat/Math.max(tot,1)))).toFixed(1); });
  renderProjectionChart(weeks, weights, bfs);
  document.getElementById('projectionBox').innerHTML=`TDEE est: <strong>${Math.round(tdee)}</strong> kcal/day. At ${cals} kcal, projected <strong>${sign}</strong> ≈ ${Math.abs(lbPerWeek).toFixed(2)} lb/week.<br><span class="muted">Projection assumes ~${Math.round(fatFrac*100)}% of weight change is fat mass.</span>`;
};

// dashboard & analytics
function renderDashboard(){
  const today=todayISO(), todayWs=workouts.filter(w=>w.date===today);
  const vol=todayWs.flatMap(w=>w.sets).reduce((t,s)=>t+(s.weight??0)*(s.reps??0),0);
  document.getElementById('todayMeta').textContent=today;
  document.getElementById('todaySummary').innerHTML = todayWs.length ? `<p>${todayWs.length} workout(s) logged. Volume: <strong>${fmt(vol)}</strong> (lb×reps).</p>` : `<p>No workout logged yet.</p><button class="btn primary" id="goLog2">Log a workout</button>`;
  const g2=document.getElementById('goLog2'); if(g2) g2.onclick=()=>$$('[data-tab="workout"]')[0].click();
  renderStreak(); renderCharts();
}
function renderStreak(){
  const days=new Set(workouts.map(w=>w.date)); let streak=0; let d=new Date();
  for(;;){ const iso=d.toISOString().slice(0,10); if(days.has(iso)){ streak++; d.setDate(d.getDate()-1);} else break; }
  document.getElementById('streakBox').textContent=`🔥 ${streak}-day streak`;
  const box=document.getElementById('badges'); box.innerHTML=''; Object.values(badges).forEach(v=>{ const b=document.createElement('span'); b.className='badge'; b.textContent=v; box.appendChild(b); });
}
function maybeAwardBadgesAfterSave(){
  if(!badges.first) badges.first='🏅 First Workout Logged';
  const days=new Set(workouts.map(w=>w.date)); let run=0; let d=new Date(); while(days.has(d.toISOString().slice(0,10))){ run++; d.setDate(d.getDate()-1); } if(run>=5) badges.streak5='🔥 5-Day Streak';
  const prs=computePRs(); if(Object.keys(prs).length && !badges.pr) badges.pr='💪 New PR';
  write(KEYS.badges, badges);
}

let charts={};
function renderCharts(){
  for(const k in charts){ charts[k].destroy(); } charts={};
  // volume/week
  const byWeek={}; workouts.forEach(w=>{ const wk=isoYearWeek(w.date); const vol=w.sets.reduce((t,s)=>t+(s.weight??0)*(s.reps??0),0); byWeek[wk]=(byWeek[wk]||0)+vol; });
  const weekLabels=Object.keys(byWeek).sort(), weekData=weekLabels.map(k=>byWeek[k]);
  charts.volume=new Chart(document.getElementById('chartVolume'),{type:'bar',data:{labels:weekLabels,datasets:[{label:'Volume (lb×reps)',data:weekData}]},options:{responsive:true,maintainAspectRatio:false}});
  // 1RM best/day (Epley)
  const oneRM={}; workouts.forEach(w=>{ let best=0; w.sets.forEach(s=>{ const est=epley1RM(s.weight??0,s.reps??0); if(est>best) best=est; }); oneRM[w.date]=Math.max(oneRM[w.date]||0,best); });
  const d1=Object.keys(oneRM).sort();
  charts.onerm=new Chart(document.getElementById('chart1RM'),{type:'line',data:{labels:d1,datasets:[{label:'Best 1RM (lb, est)',data:d1.map(k=>Math.round(oneRM[k]))}]},options:{responsive:true,maintainAspectRatio:false}});
  // body weight & bf
  const ms=metrics.slice().sort((a,b)=>a.date.localeCompare(b.date));
  charts.body=new Chart(document.getElementById('chartBody'),{type:'line',data:{labels:ms.map(m=>m.date),datasets:[{label:'Weight (lb)',data:ms.map(m=>m.weight??null),yAxisID:'y'},{label:'Body Fat %',data:ms.map(m=>{const v=getBFForEntry(m);return v==null?null:+v.toFixed(1);}),yAxisID:'y1'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{type:'linear',position:'left'},y1:{type:'linear',position:'right'}}}});
  // PRs
  const prs=computePRs(true), labels=Object.keys(prs), data=labels.map(n=>prs[n].weight);
  charts.pr=new Chart(document.getElementById('chartPR'),{type:'bar',data:{labels,datasets:[{label:'Heaviest Weight (lb)',data}]},options:{responsive:true,maintainAspectRatio:false}});
}
function epley1RM(w,r){ if(!w||!r) return 0; return w*(1+r/30); }
function isoYearWeek(iso){ const d=new Date(iso); d.setHours(0,0,0,0); d.setDate(d.getDate()+3-(d.getDay()+6)%7); const w1=new Date(d.getFullYear(),0,4); return d.getFullYear()+'-W'+String(1+Math.round(((d-w1)/86400000-3+(w1.getDay()+6)%7)/7)).padStart(2,'0'); }
function computePRs(withDates=false){ const map={}; workouts.forEach(w=>w.sets.forEach(s=>{ if(!s.name||!s.weight) return; if(!map[s.name]||s.weight>map[s.name].weight){ map[s.name]={weight:s.weight,date:w.date}; } })); if(withDates) return map; const out={}; Object.keys(map).forEach(k=>out[k]=map[k].weight); return out; }

// init
renderHistory(); renderDashboard(); renderMetrics();

function calcBmrTdee(sex, age, heightCm, weightKg){ let bmr; if(sex==='male') bmr=10*weightKg+6.25*heightCm-5*age+5; else bmr=10*weightKg+6.25*heightCm-5*age-161; return {bmr, tdeeModerate:bmr*1.55}; }
