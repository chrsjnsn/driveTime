import { DEFAULTS, DISTANCE_BY_ROAD, simulate, compare, offsets } from './model.js';

const $ = (id) => document.getElementById(id);
const STORE = 'driveTime:v1';
const NUM_FIELDS = ['distance', 'cityShare', 'mpg', 'gasPrice', 'timeValue', 'hwyLimit', 'cityLimit',
  'offset', 'lightsPerMile', 'redSeconds', 'crashCostPerMile'];

let state = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ---------- formatting ----------
const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2);
const signedMoney = (n) => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
function dur(hours) {
  const totalMin = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function savedText(hours) {
  const min = hours * 60;
  if (Math.abs(min) < 0.5) return '0 min';
  return (min > 0 ? '' : '+') + dur(hours) + (min > 0 ? '' : ' slower');
}
function clock(startHHMM, hours) {
  const [h, m] = (startHHMM || '08:00').split(':').map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  const days = Math.floor(total / 1440);
  const d = new Date(2000, 0, 1, 0, ((total % 1440) + 1440) % 1440);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return days > 0 ? `${t} +${days}d` : t;
}
const offsetText = (o) => o === 0 ? 'At the limit' : o > 0 ? `+${o} mph` : `−${-o} mph`;
function speedsFor(o) {
  const parts = [];
  if (state.roadType !== 'city') parts.push(`<b>${state.hwyLimit + o} mph</b> on the interstate`);
  if (state.roadType !== 'interstate') parts.push(`<b>${Math.max(10, state.cityLimit + o)} mph</b> between lights`);
  return parts.join(' · ');
}

// ---------- controls ----------
function syncInputs() {
  for (const k of NUM_FIELDS) if (document.activeElement !== $(k)) $(k).value = state[k];
  $('includeRisk').checked = state.includeRisk;
  $('cityShareOut').textContent = `${state.cityShare}%`;
  document.querySelectorAll('.seg button').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.road === state.roadType)));
  const hasCity = state.roadType !== 'interstate';
  const hasHwy = state.roadType !== 'city';
  $('shareField').classList.toggle('hidden', state.roadType !== 'mixed');
  $('cityLimitField').classList.toggle('hidden', !hasCity);
  $('hwyLimitField').classList.toggle('hidden', !hasHwy);
  $('cityAdv').classList.toggle('hidden', !hasCity);
}

for (const k of NUM_FIELDS) {
  $(k).addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) { state[k] = v; update(); }
  });
}
$('includeRisk').addEventListener('change', (e) => { state.includeRisk = e.target.checked; update(); });
$('leaveAt').addEventListener('input', () => render());
document.querySelectorAll('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    // Keep a custom distance, but swap the stock one for something sensible.
    if (state.distance === DISTANCE_BY_ROAD[state.roadType]) state.distance = DISTANCE_BY_ROAD[b.dataset.road];
    state.roadType = b.dataset.road;
    update();
  }));
$('reset').addEventListener('click', () => { state = { ...DEFAULTS }; update(); });

function update() { save(); syncInputs(); render(); }

// ---------- render ----------
function render() {
  const p = state;
  const base = simulate(p, 0);
  const runs = offsets().map((o) => ({ run: simulate(p, o) }));
  runs.forEach((r) => (r.cmp = compare(r.run, base, p)));
  const cur = simulate(p, p.offset);
  const c = compare(cur, base, p);

  $('offsetLabel').textContent = offsetText(p.offset);
  $('speedsLabel').innerHTML = speedsFor(p.offset);

  $('sArrive').textContent = clock($('leaveAt').value, cur.hours);
  $('sTime').textContent = `${dur(cur.hours)} on the road`;
  $('sSaved').textContent = savedText(c.hoursSaved);
  $('sGas').textContent = signedMoney(c.extraFuel);
  $('sGal').textContent = `${cur.gallons.toFixed(2)} gal · ${cur.mpg.toFixed(1)} mpg`;
  $('sRisk').textContent = `${cur.crashMult.toFixed(2)}×`;
  $('sFatal').textContent = `fatal crash ${cur.fatalMult.toFixed(2)}×`;

  renderVerdict(cur, c);
  renderTable(runs);
  renderTimeChart(runs);
  renderCostChart(runs);
}

function renderVerdict(cur, c) {
  const el = $('verdict');
  const p = state;
  let cls = '', title = '', body = '';
  const riskNote = p.includeRisk ? ' and crash risk' : '';
  if (p.offset === 0) {
    title = 'This is your baseline.';
    body = `Driving the limit takes ${dur(cur.hours)} and burns ${cur.gallons.toFixed(2)} gallons (${money(cur.fuelCost)}). Move the slider to see what speeding buys you.`;
  } else if (c.hoursSaved <= 1 / 120) {
    cls = p.offset > 0 ? 'bad' : 'good';
    if (p.offset > 0) {
      title = 'Faster, but you barely get there sooner.';
      body = `You save under 30 seconds, mostly because you're catching more red lights, and still pay ${money(c.extraCost)} in extra gas${riskNote}.`;
    } else {
      title = `Driving slower saves ${money(-c.extraCost)}.`;
      body = `It costs you ${dur(-c.hoursSaved)} of extra driving time, worth ${money(-c.timeWorth)} at $${p.timeValue}/hr.`;
      cls = c.net >= 0 ? 'bad' : 'good';
      if (c.net >= 0) title = `Driving slower saves ${money(-c.extraCost)}, but the extra time is worth more.`;
    }
  } else {
    const perHour = c.costPerHourSaved;
    const perHourTxt = perHour <= 0 ? 'nothing' : `${money(perHour)}`;
    if (c.net >= 0) {
      cls = perHour > p.timeValue * 0.75 ? 'meh' : 'good';
      title = `Worth it if your time is worth more than ${perHourTxt}/hr.`;
      body = `You save ${dur(c.hoursSaved)} for ${money(c.extraCost)} in extra gas${riskNote}. At $${p.timeValue}/hr that time is worth ${money(c.timeWorth)}.`;
    } else {
      cls = 'bad';
      title = `Not worth it: you're paying ${perHourTxt} for every hour saved.`;
      body = `You save ${dur(c.hoursSaved)} but spend ${money(c.extraCost)} more on gas${riskNote}. At $${p.timeValue}/hr that time is only worth ${money(c.timeWorth)}.`;
    }
  }
  el.className = 'verdict ' + cls;
  el.innerHTML = `<strong>${title}</strong><p>${body}</p>`;
}

function renderTable(runs) {
  const p = state;
  $('table').innerHTML = runs.map(({ run, cmp }) => {
    const label = run.offset === 0 ? 'At the limit' : offsetText(run.offset);
    const speeds = p.roadType === 'city' ? `${run.vCity}` : p.roadType === 'interstate' ? `${run.vHwy}` : `${run.vHwy}/${run.vCity}`;
    let per = '—', cls = '';
    if (run.offset > 0) {
      if (cmp.costPerHourSaved === null) { per = 'no time saved'; cls = 'bad'; }
      else { per = money(cmp.costPerHourSaved) + '/hr'; cls = cmp.costPerHourSaved <= p.timeValue ? 'good' : 'bad'; }
    } else if (run.offset < 0 && cmp.hoursSaved < 0) {
      per = `saves ${money(-cmp.extraCost)}`;
    }
    return `<tr data-o="${run.offset}" class="${run.offset === p.offset ? 'on' : ''}">
      <td>${label} <span class="note">${speeds} mph</span></td>
      <td>${dur(run.hours)}</td>
      <td>${run.offset === 0 ? '—' : savedText(cmp.hoursSaved)}</td>
      <td>${run.mpg.toFixed(1)}</td>
      <td>${money(run.fuelCost)}</td>
      <td>${p.includeRisk ? money(run.riskCost) : run.crashMult.toFixed(2) + '×'}</td>
      <td class="${cls}">${per}</td>
    </tr>`;
  }).join('');
  $('table').querySelectorAll('tr').forEach((tr) =>
    tr.addEventListener('click', () => { state.offset = Number(tr.dataset.o); update(); }));
}

// ---------- charts (hand-drawn SVG, no library) ----------
const W = 360, H = 200, PAD = { l: 44, r: 10, t: 10, b: 28 };
const xs = (i, n) => PAD.l + (i + 0.5) * (W - PAD.l - PAD.r) / n;
// Round a raw tick step up to a friendly number (1, 2, 2.5, 5, 10 x 10^n).
function niceStep(v) {
  const pow = 10 ** Math.floor(Math.log10(v || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}
// Friendly minute steps for the time axis.
function minuteStep(v) {
  for (const m of [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720]) if (m >= v) return m;
  return Math.ceil(v / 720) * 720;
}
function axes(min, max, fmt, n, runs) {
  const y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  let s = '';
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * i / 4;
    s += `<line class="grid-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text x="${PAD.l - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`;
  }
  runs.forEach(({ run }, i) => {
    const t = run.offset === 0 ? 'limit' : (run.offset > 0 ? '+' : '−') + Math.abs(run.offset);
    s += `<text x="${xs(i, n)}" y="${H - 8}" text-anchor="middle">${t}</text>`;
  });
  return { s, y };
}

function renderTimeChart(runs) {
  const n = runs.length;
  const vals = runs.map((r) => r.run.hours * 60);
  const vmin = Math.min(...vals), vmax = Math.max(...vals);
  let step = minuteStep(Math.max(vmax - vmin, 4) / 3);
  let lo = Math.floor(vmin / step) * step;
  while (lo + step * 4 < vmax) { step = minuteStep(step + 1); lo = Math.floor(vmin / step) * step; }
  const hi = lo + step * 4;
  const fmt = (m) => {
    if (m < 60) return `${Math.round(m)}m`;
    const h = Math.floor(m / 60), r = Math.round(m % 60);
    return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
  };
  const { s, y } = axes(lo, hi, fmt, n, runs);
  const pts = vals.map((v, i) => `${xs(i, n)},${y(v)}`).join(' ');
  const selI = runs.findIndex((r) => r.run.offset === Math.round(state.offset / 5) * 5);
  let out = s + `<polyline class="line" points="${pts}"/>`;
  vals.forEach((v, i) => { out += `<circle class="dot" cx="${xs(i, n)}" cy="${y(v)}" r="${i === selI ? 5 : 3}"/>`; });
  $('chartTime').innerHTML = out;
}

function renderCostChart(runs) {
  const n = runs.length;
  const totals = runs.map((r) => r.run.fuelCost + r.run.riskCost);
  const hi = 4 * niceStep(Math.max(...totals) * 1.05 / 4);
  const { s, y } = axes(0, hi, (v) => `$${Number.isInteger(v) ? v : v.toFixed(2)}`, n, runs);
  const bw = (W - PAD.l - PAD.r) / n * 0.6;
  const selI = runs.findIndex((r) => r.run.offset === Math.round(state.offset / 5) * 5);
  let out = s;
  runs.forEach(({ run }, i) => {
    const x = xs(i, n) - bw / 2;
    const cls = i === selI ? 'sel' : 'dim';
    const yF = y(run.fuelCost), yT = y(run.fuelCost + run.riskCost);
    out += `<rect class="bar-fuel ${cls}" x="${x}" y="${yF}" width="${bw}" height="${y(0) - yF}" rx="2"/>`;
    if (run.riskCost > 0) out += `<rect class="bar-risk ${cls}" x="${x}" y="${yT}" width="${bw}" height="${yF - yT}" rx="2"/>`;
  });
  $('chartCost').innerHTML = out;
}

syncInputs();
render();
