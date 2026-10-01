'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STORAGE_KEY = 'coc6-investigator-maker-v1';
const SKILL_MAP = Object.fromEntries(SKILLS.map(d => [d.k, d]));
const SKILL_ORDER = Object.fromEntries(SKILLS.map((d, i) => [d.k, i]));
const OCC_MAP = Object.fromEntries(OCCUPATIONS.map(o => [o.id, o]));
const STEP_LABELS = ['時代', '能力値', '職業', '技能', '背景', '完成'];
const KANJI_NUM = ['1', '2', '3', '4', '5', '6'];

const defaultState = () => ({
  step: 1,
  era: '1920',
  stats: {},
  dice: {},
  rerolls: 0,
  occ: null,
  custom: { name: '', desc: '' },
  choices: {},
  customOcc: [],
  specs: {},
  extraRows: [],
  alloc: {},
  profile: { name: '', kana: '', player: '', sex: '', age: '', birthplace: '', school: '' },
  bg: {},
});

let state = loadState();
let skillFilter = 'all';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* 保存領域が使えない場合は新規 */ }
  return defaultState();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  $('#saveStatus').textContent = '保存中…';
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('#saveStatus').textContent = '自動保存済み';
    } catch (e) {
      $('#saveStatus').textContent = '保存できません';
    }
  }, 300);
}

// 確認ダイアログ（ブラウザ標準の confirm() は環境によって表示されないため自前で用意）
function ask(title, msg, okLabel = 'OK') {
  const modal = $('#modal');
  $('#modalTitle').textContent = title;
  $('#modalMsg').textContent = msg;
  $('#modalOk').textContent = okLabel;
  modal.hidden = false;
  $('#modalCancel').focus();
  return new Promise(resolve => {
    const close = result => {
      modal.hidden = true;
      $('#modalOk').onclick = $('#modalCancel').onclick = modal.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = e => { if (e.key === 'Escape') close(false); };
    $('#modalOk').onclick = () => close(true);
    $('#modalCancel').onclick = () => close(false);
    modal.onclick = e => { if (e.target === modal) close(false); };
    document.addEventListener('keydown', onKey);
  });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================= 計算 ================= */

const allRolled = () => STATS.every(s => Number.isFinite(state.stats[s.k]));
const st = k => state.stats[k] ?? 0;

function damageBonus(v) {
  if (v <= 12) return '-1D6';
  if (v <= 16) return '-1D4';
  if (v <= 24) return '0';
  if (v <= 32) return '+1D4';
  if (v <= 40) return '+1D6';
  if (v <= 56) return '+2D6';
  if (v <= 72) return '+3D6';
  return `+${3 + Math.ceil((v - 72) / 16)}D6`;
}

function derived() {
  const mythos = rowTotal(rowById('mythos'));
  return {
    san: st('POW') * 5,
    maxSan: 99 - mythos,
    luck: st('POW') * 5,
    idea: st('INT') * 5,
    know: Math.min(99, st('EDU') * 5),
    hp: Math.ceil((st('CON') + st('SIZ')) / 2),
    mp: st('POW'),
    db: damageBonus(st('STR') + st('SIZ')),
    occPts: st('EDU') * 20,
    intPts: st('INT') * 10,
    minAge: st('EDU') + 6,
  };
}

/* ================= 技能の行 ================= */

const eraOk = def => !def.eras || def.eras.includes(state.era);
const specDefaults = def => (def.def[state.era] || def.def.all || ['']);
const keyToRowId = k => {
  const d = SKILL_MAP[k];
  return d.spec ? `${k}:${specDefaults(d)[0]}` : k;
};
const entryKey = e => (typeof e === 'string' ? e : e.k);
const entryToRowId = e => (typeof e === 'string' ? keyToRowId(e) : `${e.k}:${e.s}`);

let rowsCache = [];
function buildRows() {
  const rows = [];
  const seen = new Set();
  const add = (k, preset, extra) => {
    const id = preset === null ? k : `${k}:${preset}`;
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, k, def: SKILL_MAP[k], preset: extra ? '' : preset, extra: !!extra });
  };
  for (const d of SKILLS) {
    if (!eraOk(d)) continue;
    if (d.spec) specDefaults(d).forEach(p => add(d.k, p));
    else add(d.k, null);
  }
  const occ = currentOcc();
  if (occ) occ.skills.forEach(e => { if (typeof e === 'object' && eraOk(SKILL_MAP[e.k])) add(e.k, e.s); });
  state.extraRows.forEach(x => { if (eraOk(SKILL_MAP[x.k])) add(x.k, x.p, true); });
  rows.sort((a, b) => SKILL_ORDER[a.k] - SKILL_ORDER[b.k]);
  rowsCache = rows;
  return rows;
}
const rowById = id => rowsCache.find(r => r.id === id);

function rowName(r, withSpec = true) {
  if (!r.def.spec || !withSpec) return r.def.n;
  const sp = state.specs[r.id] ?? r.preset;
  return sp ? `${r.def.n}（${sp}）` : r.def.n;
}
function rowBase(r) {
  const b = r.def.base;
  return typeof b === 'function' ? b(state.stats) : b;
}
function alloc(id) { return state.alloc[id] || { o: 0, i: 0 }; }
function rowTotal(r) {
  if (!r) return 0;
  const a = alloc(r.id);
  return rowBase(r) + (a.o || 0) + (a.i || 0);
}

function currentOcc() {
  if (!state.occ || state.occ === 'custom') return null;
  return OCC_MAP[state.occ] || null;
}
function occName() {
  if (state.occ === 'custom') return state.custom.name || 'オリジナル職業';
  return currentOcc()?.name || '';
}
function occDesc() {
  if (state.occ === 'custom') return state.custom.desc || '';
  return currentOcc()?.desc || '';
}

function occSkillIds() {
  if (state.occ === 'custom') return new Set(state.customOcc.filter(id => rowById(id)));
  const occ = currentOcc();
  if (!occ) return new Set();
  const ids = [];
  occ.skills.forEach(e => { if (eraOk(SKILL_MAP[entryKey(e)])) ids.push(entryToRowId(e)); });
  (occ.choose || []).forEach((c, ci) => {
    (state.choices['c' + ci] || [])
      .filter(k => c.of.includes(k) && eraOk(SKILL_MAP[k]))
      .slice(0, c.n)
      .forEach(k => ids.push(keyToRowId(k)));
  });
  (state.choices.any || []).slice(0, occ.any || 0).forEach(id => { if (id && rowById(id)) ids.push(id); });
  return new Set(ids);
}

function pointsUsed(occSet) {
  let o = 0, i = 0;
  for (const r of rowsCache) {
    const a = alloc(r.id);
    if (occSet.has(r.id)) o += a.o || 0;
    i += a.i || 0;
  }
  return { o, i };
}

// 職業技能でなくなった行の職業ポイントを消す
function sanitizeAlloc() {
  const occSet = occSkillIds();
  for (const id of Object.keys(state.alloc)) {
    const a = state.alloc[id];
    if (!occSet.has(id)) a.o = 0;
    if (id === 'mythos') a.i = 0;
    if (!a.o && !a.i) delete state.alloc[id];
  }
}

/* ================= ステップ制御 ================= */

function stepStatus(n) {
  switch (n) {
    case 1: return !!state.era;
    case 2: return allRolled();
    case 3: return !!state.occ && (state.occ !== 'custom' || !!state.custom.name.trim());
    case 4: {
      if (!allRolled() || !state.occ) return false;
      const d = derived(); const u = pointsUsed(occSkillIds());
      return u.o === d.occPts && u.i === d.intPts;
    }
    case 5: return !!state.profile.name.trim();
    default: return false;
  }
}

function goStep(n) {
  state.step = Math.max(1, Math.min(6, n));
  save();
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStepper() {
  $('#stepper').innerHTML = `<div class="stepper-inner">${STEP_LABELS.map((l, i) => {
    const n = i + 1;
    const cls = [n === state.step ? 'active' : '', stepStatus(n) ? 'done' : ''].join(' ');
    return `<button class="step-btn ${cls}" data-go="${n}"><span class="num">${stepStatus(n) && n !== state.step ? '✓' : KANJI_NUM[i]}</span><span class="lbl">${l}</span></button>`;
  }).join('')}</div>`;
  $$('#stepper [data-go]').forEach(b => b.onclick = () => goStep(+b.dataset.go));
  $$('.step').forEach(s => s.classList.toggle('active', +s.dataset.step === state.step));
  $('#prevBtn').disabled = state.step === 1;
  $('#nextBtn').textContent = state.step === 6 ? '完成！' : `次へ（${STEP_LABELS[state.step] || ''}）→`;
  $('#nextBtn').disabled = state.step === 6;
  $('#eraBadge').textContent = ERAS[state.era]?.label || '';
  renderHint();
}

function renderHint() {
  const h = $('#stepHint');
  let msg = '', warn = false;
  const d = derived();
  switch (state.step) {
    case 1: msg = `${ERAS[state.era].label}を選択中`; break;
    case 2: {
      const left = STATS.filter(s => !Number.isFinite(state.stats[s.k])).length;
      msg = left ? `あと ${left} 個の能力値を振ってください` : '能力値が決まりました';
      warn = !!left; break;
    }
    case 3: msg = state.occ ? `職業：${occName()}` : '職業を選んでください'; warn = !state.occ; break;
    case 4: {
      if (!allRolled()) { msg = '先に能力値を決めてください'; warn = true; break; }
      const u = pointsUsed(occSkillIds());
      msg = `職業P 残り ${d.occPts - u.o} ／ 興味P 残り ${d.intPts - u.i}`;
      warn = u.o !== d.occPts || u.i !== d.intPts; break;
    }
    case 5: msg = state.profile.name ? `探索者：${state.profile.name}` : '名前を入力してください'; warn = !state.profile.name; break;
    case 6: msg = '探索者の完成です。良き探索を。'; break;
  }
  h.textContent = msg;
  h.classList.toggle('warn', warn);
}

/* ================= 1. 時代 ================= */

function renderEras() {
  $('#eraGrid').innerHTML = Object.entries(ERAS).map(([k, e]) => `
    <button class="era-card ${state.era === k ? 'on' : ''}" data-era="${k}">
      <span class="check">✓</span>
      <div class="era-year">${e.label}</div>
      <span class="era-sub">${e.sub}</span>
      <p>${e.desc}</p>
      <p class="era-notes">${e.notes}</p>
    </button>`).join('');
  $$('#eraGrid [data-era]').forEach(b => b.onclick = () => {
    state.era = b.dataset.era;
    const occ = currentOcc();
    if (occ?.eras && !occ.eras.includes(state.era)) {
      toast(`「${occ.name}」は${ERAS[state.era].label}では選べないため、職業を解除しました`);
      state.occ = null; state.choices = {};
    }
    buildRows(); sanitizeAlloc(); save(); renderAll();
  });
}

/* ================= 2. 能力値とダイス ================= */

const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
const faceHTML = n => `<div class="face f${n}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(p => PIPS[n].includes(p) ? `<i style="grid-area:${Math.ceil(p / 3)}/${(p - 1) % 3 + 1}"></i>` : '').join('')}</div>`;
const dieHTML = (val) => {
  const [rx, ry] = FACE_ROT[val || 1];
  return `<div class="die ${val ? '' : 'unrolled'}"><div class="cube" style="transform:${cubeTransform(0, rx, ry)}">${[1, 2, 3, 4, 5, 6].map(faceHTML).join('')}</div></div>`;
};
// 外側の傾きは固定し、内側の回転（360°の倍数＋出目の向き）で転がす
const cubeTransform = (z, x, y) => `rotateX(-16deg) rotateY(20deg) rotateZ(${z}deg) rotateX(${x}deg) rotateY(${y}deg)`;

const REROLL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

function resultClass(s, v) {
  const avg = s.dice * 3.5 + s.plus;
  if (v >= avg + 3) return 'hi';
  if (v <= avg - 3) return 'lo';
  return '';
}

function renderStats() {
  const manual = $('#manualToggle').checked;
  $('#statRows').innerHTML = STATS.map(s => {
    const v = state.stats[s.k];
    const dice = state.dice[s.k] || [];
    const has = Number.isFinite(v);
    return `<div class="stat-row ${has ? 'rolled' : ''}" data-k="${s.k}">
      <div class="stat-label"><b>${s.k}</b><small>${s.dice}D6${s.plus ? '+' + s.plus : ''}</small><span>${s.n}<em>（${s.hint}）</em></span></div>
      <div class="tray">${Array.from({ length: s.dice }, (_, i) => dieHTML(dice[i])).join('')}${s.plus ? `<span class="plus-chip">＋${s.plus}</span>` : ''}</div>
      <div class="stat-result ${has ? resultClass(s, v) : 'empty'}">${manual
        ? `<input type="number" class="input" min="1" max="30" value="${has ? v : ''}" data-manual="${s.k}">`
        : (has ? v : '—')}</div>
      <button class="reroll" data-roll="${s.k}" title="${s.k}を${has ? '振り直す' : '振る'}" aria-label="${s.k}を振る">${REROLL_SVG}</button>
    </div>`;
  }).join('');
  $$('#statRows [data-roll]').forEach(b => b.onclick = () => rollStat(b.dataset.roll));
  $$('#statRows [data-manual]').forEach(inp => inp.oninput = () => {
    const v = parseInt(inp.value, 10);
    if (Number.isFinite(v) && v > 0) state.stats[inp.dataset.manual] = v;
    else delete state.stats[inp.dataset.manual];
    onStatsChanged();
  });
  $('#rerollCount').textContent = state.rerolls ? `振った回数：${state.rerolls}` : '';
  renderDerived();
}

function rollStat(k, delay = 0) {
  const s = STATS.find(x => x.k === k);
  const row = $(`#statRows .stat-row[data-k="${k}"]`);
  const dice = Array.from({ length: s.dice }, () => 1 + Math.floor(Math.random() * 6));
  const total = dice.reduce((a, b) => a + b, 0) + s.plus;
  state.rerolls++;
  const btn = row.querySelector('.reroll');
  btn.disabled = true;
  return new Promise(resolve => setTimeout(() => {
    const res = row.querySelector('.stat-result');
    res.className = 'stat-result empty';
    res.textContent = '…';
    $$('.die', row).forEach((die, i) => {
      die.classList.remove('unrolled', 'toss');
      void die.offsetWidth;
      die.classList.add('toss');
      const cube = die.querySelector('.cube');
      const [rx, ry] = FACE_ROT[dice[i]];
      const turnsX = 2 + Math.floor(Math.random() * 2);
      const turnsY = 2 + Math.floor(Math.random() * 2);
      // 前回の回転量から続けて回すことで、毎回しっかり転がって見える
      const base = +(cube.dataset.turn || 0) + 1;
      cube.dataset.turn = base + Math.max(turnsX, turnsY);
      cube.style.transitionDuration = (0.9 + Math.random() * 0.35) + 's';
      cube.style.transform = cubeTransform(Math.round(Math.random() * 12 - 6), (base + turnsX) * 360 + rx, (base + turnsY) * 360 + ry);
    });
    setTimeout(() => {
      state.stats[k] = total;
      state.dice[k] = dice;
      res.className = `stat-result pop ${resultClass(s, total)}`;
      if ($('#manualToggle').checked) res.innerHTML = `<input type="number" class="input" min="1" max="30" value="${total}" data-manual="${k}">`;
      else res.textContent = total;
      row.classList.add('rolled');
      btn.disabled = false;
      $('#rerollCount').textContent = `振った回数：${state.rerolls}`;
      onStatsChanged();
      resolve();
    }, 1250);
  }, delay));
}

async function rollAll() {
  const b = $('#rollAll');
  b.disabled = true;
  await Promise.all(STATS.map((s, i) => rollStat(s.k, i * 140)));
  b.disabled = false;
  b.textContent = 'すべて振り直す';
}

function onStatsChanged() {
  buildRows();
  save();
  renderDerived();
  renderStepper();
}

function renderDerived() {
  const el = $('#derived');
  if (!allRolled()) {
    const done = STATS.filter(s => Number.isFinite(state.stats[s.k])).length;
    el.innerHTML = `<h3>副次的な数値</h3><p class="note">すべての能力値を振ると、正気度やHPなどが計算されます。（${done} / ${STATS.length}）</p>`;
    return;
  }
  const d = derived();
  el.innerHTML = `<h3>副次的な数値</h3>
    <div class="derived-grid">
      <div class="dv sanity"><span>正気度（SAN）</span><b>${d.san}</b><small>POW×5</small></div>
      <div class="dv"><span>幸運</span><b>${d.luck}</b><small>POW×5</small></div>
      <div class="dv"><span>アイデア</span><b>${d.idea}</b><small>INT×5</small></div>
      <div class="dv"><span>知識</span><b>${d.know}</b><small>EDU×5</small></div>
      <div class="dv"><span>耐久力（HP）</span><b>${d.hp}</b><small>(CON+SIZ)÷2</small></div>
      <div class="dv"><span>マジック・ポイント</span><b>${d.mp}</b><small>POW</small></div>
      <div class="dv wide"><span>ダメージ・ボーナス</span><b>${d.db}</b><small>STR+SIZ = ${st('STR') + st('SIZ')}</small></div>
      <div class="dv"><span>職業技能P</span><b>${d.occPts}</b><small>EDU×20</small></div>
      <div class="dv"><span>興味技能P</span><b>${d.intPts}</b><small>INT×10</small></div>
    </div>
    <p class="note">年齢は EDU+6（${d.minAge}歳）以上が目安です。</p>`;
}

/* ================= 3. 職業 ================= */

function occAvailable(o) { return !o.eras || o.eras.includes(state.era); }

function renderOccGrid() {
  const q = $('#occSearch').value.trim();
  const starOnly = $('#occStarOnly').checked;
  const list = OCCUPATIONS.filter(o => {
    if (!occAvailable(o)) return false;
    if (starOnly && !o.star) return false;
    if (!q) return true;
    const skillNames = o.skills.map(e => SKILL_MAP[entryKey(e)].n).concat((o.choose || []).flatMap(c => c.of.map(k => SKILL_MAP[k].n)));
    return o.name.includes(q) || o.desc.includes(q) || skillNames.some(n => n.includes(q));
  });
  $('#occGrid').innerHTML = `
    <button class="occ-card custom ${state.occ === 'custom' ? 'on' : ''}" data-occ="custom">
      <span class="occ-name">＋ オリジナル職業</span>
      <span class="occ-mini">自由に名前をつけ、職業技能を好きに選べます。</span>
    </button>
    ${list.map(o => `
    <button class="occ-card ${state.occ === o.id ? 'on' : ''}" data-occ="${o.id}">
      <span class="occ-name">${o.star ? '<span class="star">★</span>' : ''}${esc(o.name)}</span>
      <span class="occ-mini">${esc(o.desc)}</span>
      ${o.eras ? '<span class="tag">現代のみ</span>' : ''}
    </button>`).join('')}
    ${list.length ? '' : '<p class="count-note">該当する職業がありません。</p>'}`;
  $$('#occGrid [data-occ]').forEach(b => b.onclick = () => selectOcc(b.dataset.occ));
}

function selectOcc(id) {
  if (state.occ === id) return;
  state.occ = id;
  state.choices = {};
  const occ = currentOcc();
  // 選択式の技能は、先頭から既定で選んでおく
  if (occ) (occ.choose || []).forEach((c, ci) => {
    state.choices['c' + ci] = c.of.filter(k => eraOk(SKILL_MAP[k])).slice(0, c.n);
  });
  buildRows(); sanitizeAlloc(); save();
  renderOccGrid(); renderOccDetail(); renderStepper();
}

function skillChip(e) {
  const k = entryKey(e);
  const d = SKILL_MAP[k];
  const ok = eraOk(d);
  const label = typeof e === 'object' ? `${d.n}（${e.s}）` : (d.spec && specDefaults(d)[0] ? `${d.n}（${specDefaults(d)[0]}）` : d.n);
  return `<span class="chip fixed ${ok ? '' : 'na'}" title="${ok ? '' : 'この時代にはない技能です'}">${esc(label)}</span>`;
}

function renderOccDetail() {
  const el = $('#occDetail');
  const d = allRolled() ? derived() : null;
  const ptsHTML = `<div class="pts-line">
      <div class="dv"><span>職業技能ポイント</span><b>${d ? d.occPts : '—'}</b><small>EDU×20</small></div>
      <div class="dv"><span>興味技能ポイント</span><b>${d ? d.intPts : '—'}</b><small>INT×10</small></div>
    </div>`;

  if (!state.occ) {
    el.innerHTML = '<div class="empty">左の一覧から職業を選んでください。<br>選ぶと職業技能が自動で設定されます。</div>';
    return;
  }

  if (state.occ === 'custom') {
    buildRows();
    const sel = new Set(state.customOcc);
    const groups = SKILL_GROUPS.map(g => {
      const rows = rowsCache.filter(r => r.def.g === g && !r.def.locked);
      return `<h4>${g}</h4><div class="chips">${rows.map(r => `<button class="chip ${sel.has(r.id) ? 'on' : ''}" data-cs="${r.id}">${esc(rowName(r))}</button>`).join('')}</div>`;
    }).join('');
    const n = sel.size;
    el.innerHTML = `<h3>オリジナル職業</h3>
      <label class="field" style="margin-top:12px"><span>職業名</span><input class="input" id="cName" value="${esc(state.custom.name)}" placeholder="例：古書店主、民俗学者、看護師"></label>
      <label class="field"><span>職業の説明</span><textarea class="input" id="cDesc" placeholder="どんな仕事で、どんな人がなるのか">${esc(state.custom.desc)}</textarea></label>
      <h4>職業技能を選ぶ</h4>
      <p class="count-note ${n > 8 ? 'warn' : ''}" id="cCount">選択中：${n} 個${n > 8 ? '（ルールブックでは8つ以下を推奨）' : '（ルールブックでは8つ以下を推奨）'}</p>
      ${groups}
      ${ptsHTML}`;
    $('#cName').oninput = e => { state.custom.name = e.target.value; save(); renderStepper(); };
    $('#cDesc').oninput = e => { state.custom.desc = e.target.value; save(); };
    $$('#occDetail [data-cs]').forEach(b => b.onclick = () => {
      const id = b.dataset.cs;
      const i = state.customOcc.indexOf(id);
      if (i >= 0) state.customOcc.splice(i, 1); else state.customOcc.push(id);
      b.classList.toggle('on');
      const c = state.customOcc.length;
      const cc = $('#cCount');
      cc.textContent = `選択中：${c} 個（ルールブックでは8つ以下を推奨）`;
      cc.classList.toggle('warn', c > 8);
      sanitizeAlloc(); save();
    });
    return;
  }

  const occ = currentOcc();
  buildRows();
  const fixedIds = new Set(occ.skills.filter(e => eraOk(SKILL_MAP[entryKey(e)])).map(entryToRowId));
  const chooseHTML = (occ.choose || []).map((c, ci) => {
    const cur = state.choices['c' + ci] || [];
    return `<div class="choose-box">
      <div class="cap">次の中から <b>${c.n}つ</b> を選択（${cur.length} / ${c.n}）</div>
      <div class="chips">${c.of.map(k => {
        const ok = eraOk(SKILL_MAP[k]);
        const on = cur.includes(k);
        return `<button class="chip ${on ? 'on' : ''}" data-ci="${ci}" data-k="${k}" ${!ok || (!on && cur.length >= c.n) ? 'disabled' : ''}>${esc(SKILL_MAP[k].n)}</button>`;
      }).join('')}</div>
    </div>`;
  }).join('');

  const anyN = occ.any || 0;
  const anySel = state.choices.any || [];
  const taken = new Set([...fixedIds, ...(occ.choose || []).flatMap((c, ci) => (state.choices['c' + ci] || []).map(keyToRowId))]);
  const anyHTML = anyN ? `<div class="choose-box">
      <div class="cap">個人的あるいはその時代の特色的な技能を <b>${anyN}つ</b> 自由に選択</div>
      ${Array.from({ length: anyN }, (_, i) => `
        <div class="any-row"><select class="input input-sm" data-any="${i}">
          <option value="">— 技能を選ぶ —</option>
          ${SKILL_GROUPS.map(g => `<optgroup label="${g}">${rowsCache.filter(r => r.def.g === g && !r.def.locked && (!taken.has(r.id) || anySel[i] === r.id) && !anySel.some((x, j) => j !== i && x === r.id)).map(r => `<option value="${r.id}" ${anySel[i] === r.id ? 'selected' : ''}>${esc(rowName(r))}</option>`).join('')}</optgroup>`).join('')}
        </select></div>`).join('')}
    </div>` : '';

  const naSkills = occ.skills.filter(e => !eraOk(SKILL_MAP[entryKey(e)]));
  el.innerHTML = `<h3>${occ.star ? '<span class="star" style="color:var(--brass)">★</span>' : ''}${esc(occ.name)}</h3>
    <p class="desc">${esc(occ.desc)}</p>
    <h4>職業技能</h4>
    <div class="chips">${occ.skills.map(skillChip).join('')}</div>
    ${naSkills.length ? `<p class="count-note warn">打ち消し線の技能は${ERAS[state.era].label}には存在しません。</p>` : ''}
    ${chooseHTML}
    ${anyHTML}
    ${ptsHTML}`;

  $$('#occDetail [data-ci]').forEach(b => b.onclick = () => {
    const key = 'c' + b.dataset.ci;
    const cur = state.choices[key] || [];
    const k = b.dataset.k;
    state.choices[key] = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    sanitizeAlloc(); save(); renderOccDetail();
  });
  $$('#occDetail [data-any]').forEach(s => s.onchange = () => {
    const arr = (state.choices.any || []).slice();
    arr[+s.dataset.any] = s.value;
    state.choices.any = arr;
    sanitizeAlloc(); save(); renderOccDetail();
  });
}

/* ================= 4. 技能 ================= */

function renderPointsBar() {
  const el = $('#pointsBar');
  if (!allRolled()) { el.innerHTML = ''; return; }
  const d = derived();
  const u = pointsUsed(occSkillIds());
  const card = (label, sub, total, used) => {
    const remain = total - used;
    const cls = remain < 0 ? 'over' : remain === 0 ? 'zero' : '';
    return `<div class="pt ${cls}"><div class="pt-label"><b>${label}</b>${sub} ${total}<div class="bar"><i style="width:${Math.min(100, total ? used / total * 100 : 0)}%"></i></div></div>
      <div class="pt-remain">${remain}<small> 残り</small></div></div>`;
  };
  el.innerHTML = card('職業技能ポイント', 'EDU×20 =', d.occPts, u.o) + card('興味技能ポイント', 'INT×10 =', d.intPts, u.i);
}

function renderSkills() {
  const el = $('#skillTable');
  buildRows();
  if (!allRolled()) {
    el.innerHTML = '<div class="sk-empty">先に「能力値」ステップで能力値を決めてください。</div>';
    renderPointsBar(); return;
  }
  const occSet = occSkillIds();
  const custom = state.occ === 'custom';
  const visible = r => {
    if (skillFilter === 'occ') return occSet.has(r.id);
    if (skillFilter === 'used') { const a = alloc(r.id); return (a.o || 0) + (a.i || 0) > 0; }
    return true;
  };
  const html = SKILL_GROUPS.map(g => {
    const rows = rowsCache.filter(r => r.def.g === g && visible(r));
    if (!rows.length) return '';
    return `<div class="sk-group"><h3>${g}技能</h3>
      <div class="sk-head"><span>職</span><span>技能</span><span>初期</span><span>職業P</span><span>興味P</span><span>合計</span></div>
      ${rows.map(r => {
        const a = alloc(r.id);
        const isOcc = occSet.has(r.id);
        const total = rowTotal(r);
        const base = rowBase(r);
        const locked = r.def.locked;
        const nameHTML = r.def.spec
          ? `<span class="nm">${esc(r.def.n)}</span><input class="input spec" data-spec="${r.id}" value="${esc(state.specs[r.id] ?? r.preset)}" placeholder="${esc(SPEC_HINTS[r.k] || '')}">${r.extra ? `<button class="del" data-del="${r.id}" title="この行を削除">×</button>` : ''}`
          : `<span class="nm">${esc(r.def.n)}</span>`;
        return `<div class="sk-row ${isOcc ? 'is-occ' : ''}" data-id="${r.id}">
          <span class="occ-mark ${custom && !locked ? 'toggleable' : ''}" ${custom && !locked ? `data-toggle="${r.id}" title="職業技能にする／外す"` : ''}>${isOcc ? '職' : (custom && !locked ? '＋' : '')}</span>
          <span class="sk-name">${nameHTML}</span>
          <span class="sk-base">${base}</span>
          <input type="number" min="0" max="99" step="1" data-a="o" data-row="${r.id}" value="${a.o || ''}" class="${a.o ? 'has' : ''}" ${isOcc ? '' : 'disabled'} placeholder="${isOcc ? '0' : ''}">
          <input type="number" min="0" max="99" step="1" data-a="i" data-row="${r.id}" value="${a.i || ''}" class="${a.i ? 'has' : ''}" ${locked ? 'disabled' : ''} placeholder="${locked ? '' : '0'}">
          <span class="sk-total ${total > 99 ? 'over' : total > base ? 'up' : ''}">${total}</span>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
  el.innerHTML = html || '<div class="sk-empty">表示する技能がありません。</div>';

  $$('#skillTable input[data-a]').forEach(inp => {
    inp.oninput = () => {
      const id = inp.dataset.row;
      const v = Math.max(0, parseInt(inp.value, 10) || 0);
      const a = state.alloc[id] || (state.alloc[id] = { o: 0, i: 0 });
      a[inp.dataset.a] = v;
      if (!a.o && !a.i) delete state.alloc[id];
      inp.classList.toggle('has', v > 0);
      const r = rowById(id);
      const tot = inp.closest('.sk-row').querySelector('.sk-total');
      const total = rowTotal(r);
      tot.textContent = total;
      tot.className = `sk-total ${total > 99 ? 'over' : total > rowBase(r) ? 'up' : ''}`;
      save(); renderPointsBar(); renderStepper();
    };
  });
  $$('#skillTable [data-spec]').forEach(inp => inp.oninput = () => { state.specs[inp.dataset.spec] = inp.value; save(); });
  $$('#skillTable [data-del]').forEach(b => b.onclick = () => {
    const id = b.dataset.del;
    state.extraRows = state.extraRows.filter(x => `${x.k}:${x.p}` !== id);
    delete state.alloc[id]; delete state.specs[id];
    state.customOcc = state.customOcc.filter(x => x !== id);
    if (state.choices.any) state.choices.any = state.choices.any.map(x => x === id ? '' : x);
    save(); renderSkills(); renderStepper();
  });
  $$('#skillTable [data-toggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.toggle;
    const i = state.customOcc.indexOf(id);
    if (i >= 0) state.customOcc.splice(i, 1); else state.customOcc.push(id);
    sanitizeAlloc(); save(); renderSkills(); renderStepper();
  });
  renderPointsBar();
}

function renderAddSpec() {
  const specs = SKILLS.filter(d => d.spec && eraOk(d));
  $('#addSpecSel').innerHTML = specs.map(d => `<option value="${d.k}">${d.n}</option>`).join('');
}

/* ================= 5. 背景 ================= */

function renderProfile() {
  const p = state.profile;
  const d = allRolled() ? derived() : null;
  const age = parseInt(p.age, 10);
  const ageWarn = d && Number.isFinite(age) && age < d.minAge;
  const f = (k, label, ph, extra = '') => `<label class="field"><span>${label}</span><input class="input" data-p="${k}" value="${esc(p[k])}" placeholder="${ph}">${extra}</label>`;
  $('#profileGrid').innerHTML =
    f('name', '探索者の名前 *', '例：ハーベイ・ウォルターズ') +
    f('kana', 'ふりがな', '') +
    f('player', 'プレイヤー名', '') +
    `<label class="field"><span>職業</span><input class="input" value="${esc(occName())}" disabled></label>` +
    f('age', '年齢', d ? `${d.minAge}歳以上が目安` : '', `<span class="age-hint ${ageWarn ? 'warn' : ''}" id="ageHint">${d ? `EDU+6＝${d.minAge}歳以上が目安${ageWarn ? '（若すぎるかもしれません）' : ''}` : ''}</span>`) +
    f('sex', '性別', '') +
    f('birthplace', '出身地', '例：アーカム、東京') +
    f('school', '学校・学位', '例：ミスカトニック大学 文学修士');
  $$('#profileGrid [data-p]').forEach(inp => inp.oninput = () => {
    state.profile[inp.dataset.p] = inp.value;
    if (inp.dataset.p === 'age' && d) {
      const a = parseInt(inp.value, 10);
      const w = Number.isFinite(a) && a < d.minAge;
      const h = $('#ageHint');
      h.textContent = `EDU+6＝${d.minAge}歳以上が目安${w ? '（若すぎるかもしれません）' : ''}`;
      h.classList.toggle('warn', w);
    }
    save(); renderStepper();
  });

  $('#bgGrid').innerHTML = BACKGROUND_FIELDS.map(b => `
    <div class="bg-card">
      <label for="bg-${b.k}">${b.n}</label>
      <textarea class="input" id="bg-${b.k}" data-bg="${b.k}" placeholder="${esc(b.ph)}">${esc(state.bg[b.k] || '')}</textarea>
      ${b.chips ? `<div class="word-chips">${PERSONALITY_WORDS.map(w => `<button type="button" data-word="${esc(w)}">${esc(w)}</button>`).join('')}</div>` : ''}
    </div>`).join('');
  $$('#bgGrid [data-bg]').forEach(t => t.oninput = () => { state.bg[t.dataset.bg] = t.value; save(); });
  $$('#bgGrid [data-word]').forEach(b => b.onclick = () => {
    const t = $('#bg-personality');
    t.value = t.value ? `${t.value.replace(/[、\s]+$/, '')}、${b.dataset.word}` : b.dataset.word;
    state.bg.personality = t.value; save();
  });
}

/* ================= 6. シート ================= */

function sheetSkills(showAll) {
  const occSet = occSkillIds();
  return rowsCache
    .filter(r => showAll || rowTotal(r) !== rowBase(r) || occSet.has(r.id))
    .map(r => ({ r, name: rowName(r), base: rowBase(r), total: rowTotal(r), occ: occSet.has(r.id) }));
}

function renderSheet() {
  buildRows();
  const el = $('#sheet');
  const p = state.profile;
  const d = derived();
  const showAll = $('#showAllSkills').checked;
  const skills = sheetSkills(showAll);
  const bgFilled = BACKGROUND_FIELDS.filter(b => (state.bg[b.k] || '').trim());
  el.innerHTML = `
    <div class="sh-title">
      <div>
        <div class="kana">${esc(p.kana)}</div>
        <div class="name">${esc(p.name) || '名もなき探索者'}</div>
        <div class="occ">${esc(occName()) || '職業未定'}</div>
      </div>
      <div class="era">クトゥルフ神話TRPG 第6版<br>${ERAS[state.era].label}${p.player ? `<br>PL：${esc(p.player)}` : ''}</div>
    </div>
    <div class="sh-profile">
      <div><span>年齢</span>${esc(p.age)}</div>
      <div><span>性別</span>${esc(p.sex)}</div>
      <div><span>出身地</span>${esc(p.birthplace)}</div>
      <div><span>学校・学位</span>${esc(p.school)}</div>
    </div>
    ${occDesc() ? `<p class="sh-occdesc" style="margin-top:10px">${esc(occDesc())}</p>` : ''}

    <h2>能力値</h2>
    ${allRolled() ? `
    <div class="sh-stats">${STATS.map(s => `<div class="sh-stat"><span>${s.k}</span><b>${st(s.k)}</b></div>`).join('')}</div>
    <div class="sh-derived">
      <div><span>SAN</span><b>${d.san}</b></div>
      <div><span>最大SAN</span><b>${d.maxSan}</b></div>
      <div><span>幸運</span><b>${d.luck}</b></div>
      <div><span>アイデア</span><b>${d.idea}</b></div>
      <div><span>知識</span><b>${d.know}</b></div>
      <div><span>HP</span><b>${d.hp}</b></div>
      <div><span>MP</span><b>${d.mp}</b></div>
      <div><span>DB</span><b>${d.db}</b></div>
    </div>` : '<p>能力値が未決定です。</p>'}

    <h2>技能</h2>
    ${allRolled() ? `<div class="sh-skills">${skills.map(s => `<div class="sh-skill ${s.occ ? 'occ' : ''}"><span class="n">${esc(s.name)}</span><span class="v"><span class="b">${s.base}→</span>${s.total}</span></div>`).join('')}</div>
    <p class="sh-legend">◆＝職業技能　（初期値→現在値）</p>` : ''}

    ${bgFilled.length ? `<h2>バックグラウンド</h2>
    <div class="sh-bg">${bgFilled.map(b => `<div><h4>${b.n}</h4><p>${esc(state.bg[b.k])}</p></div>`).join('')}</div>` : ''}
  `;
}

function toText() {
  buildRows();
  const p = state.profile, d = derived();
  const lines = [
    `【名前】${p.name}${p.kana ? `（${p.kana}）` : ''}`,
    `【職業】${occName()}　【時代】${ERAS[state.era].label}`,
    `【年齢】${p.age}　【性別】${p.sex}　【出身】${p.birthplace}　【学校・学位】${p.school}`,
    '',
    '■能力値',
    STATS.map(s => `${s.k}:${st(s.k)}`).join('  '),
    `SAN:${d.san}  幸運:${d.luck}  アイデア:${d.idea}  知識:${d.know}  HP:${d.hp}  MP:${d.mp}  DB:${d.db}`,
    '',
    '■技能（初期値から変更したもの・職業技能）',
    ...sheetSkills(false).map(s => `${s.occ ? '◆' : '・'}${s.name} ${s.total}%`),
  ];
  const bg = BACKGROUND_FIELDS.filter(b => (state.bg[b.k] || '').trim());
  if (bg.length) {
    lines.push('', '■バックグラウンド');
    bg.forEach(b => lines.push(`【${b.n}】`, state.bg[b.k].trim()));
  }
  return lines.join('\n');
}

function toCcfolia() {
  buildRows();
  const p = state.profile, d = derived();
  const cmds = [
    `CCB<={SAN} 【正気度ロール】`,
    `CCB<=${d.idea} 【アイデア】`,
    `CCB<=${d.luck} 【幸運】`,
    `CCB<=${d.know} 【知識】`,
    ...sheetSkills(false).filter(s => !s.r.def.locked || s.total > 0).map(s => `CCB<=${s.total} 【${s.name}】`),
    `1d3+${d.db === '0' ? '0' : d.db.replace('+', '')} 【ダメージ判定（こぶし）】`.replace('+-', '-'),
    ...STATS.map(s => `CCB<=${st(s.k)}*5 【${s.k}×5】`),
  ];
  const memo = [
    `${p.kana || ''}`,
    `職業：${occName()}　年齢：${p.age}　性別：${p.sex}`,
    `出身：${p.birthplace}　学校：${p.school}`,
    '',
    ...BACKGROUND_FIELDS.filter(b => (state.bg[b.k] || '').trim()).map(b => `【${b.n}】${state.bg[b.k].trim()}`),
  ].join('\n').trim();
  return JSON.stringify({
    kind: 'character',
    data: {
      name: p.name || '探索者',
      initiative: st('DEX'),
      memo,
      commands: cmds.join('\n'),
      status: [
        { label: 'HP', value: d.hp, max: d.hp },
        { label: 'MP', value: d.mp, max: d.mp },
        { label: 'SAN', value: d.san, max: d.maxSan },
      ],
      params: [
        ...STATS.map(s => ({ label: s.k, value: String(st(s.k)) })),
        { label: 'DB', value: d.db },
      ],
    },
  });
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast(msg);
}

/* ================= 全体描画・イベント ================= */

function renderAll() {
  buildRows();
  renderStepper();
  switch (state.step) {
    case 1: renderEras(); break;
    case 2: renderStats(); break;
    case 3: renderOccGrid(); renderOccDetail(); break;
    case 4: renderAddSpec(); renderSkills(); break;
    case 5: renderProfile(); break;
    case 6: renderSheet(); break;
  }
}

function bind() {
  $('#prevBtn').onclick = () => goStep(state.step - 1);
  $('#nextBtn').onclick = () => goStep(state.step + 1);
  $('#rollAll').onclick = rollAll;
  $('#manualToggle').onchange = renderStats;
  $('#occSearch').oninput = renderOccGrid;
  $('#occStarOnly').onchange = renderOccGrid;
  $$('#skillFilter button').forEach(b => b.onclick = () => {
    skillFilter = b.dataset.f;
    $$('#skillFilter button').forEach(x => x.classList.toggle('on', x === b));
    renderSkills();
  });
  $('#addSpecBtn').onclick = () => {
    const k = $('#addSpecSel').value;
    const p = 'u' + Date.now().toString(36);
    state.extraRows.push({ k, p });
    save(); renderSkills();
    const inp = $(`#skillTable [data-spec="${k}:${p}"]`);
    if (inp) { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); inp.focus(); }
  };
  $('#showAllSkills').onchange = renderSheet;
  $('#copyText').onclick = () => copy(toText(), 'テキストをコピーしました');
  $('#copyCcf').onclick = () => copy(toCcfolia(), 'ココフォリアの盤面に貼り付けると駒になります');
  $('#printBtn').onclick = () => window.print();
  $('#copyJson').onclick = () => copy(JSON.stringify(state), 'JSONをコピーしました（メモ帳などに貼り付けて .json で保存できます）');
  // Web版（Artifact）では印刷とファイル保存ができないため隠す
  if (window.COC_ARTIFACT) $$('.local-only').forEach(el => { el.hidden = true; });
  $('#saveJson').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.profile.name || '探索者'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#loadJson').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      state = Object.assign(defaultState(), data, { step: 6 });
      save(); renderAll(); toast('探索者を読み込みました');
    } catch (err) { toast('読み込めませんでした（形式が違います）'); }
    e.target.value = '';
  };
  const resetAll = async () => {
    const ok = await ask('すべてリセットしますか？', '入力内容をすべて消して、最初からやり直します。残したい場合は先に「完成」ステップでJSON保存してください。', 'リセットする');
    if (!ok) return;
    state = defaultState();
    $('#rollAll').textContent = 'すべての能力値を振る';
    $('#manualToggle').checked = false;
    $('#occSearch').value = '';
    $('#occStarOnly').checked = false;
    save(); renderAll();
    window.scrollTo({ top: 0 });
    toast('リセットしました');
  };
  $('#resetHeader').onclick = resetAll;

  // 各ページのリセット：そのページで入力した内容だけを初期状態に戻す
  const def = defaultState();
  const PAGE_RESETS = {
    1: {
      title: '時代をリセットしますか？',
      msg: '時代を初期値の「1920年代」に戻します。',
      run: () => {
        state.era = def.era;
        const occ = currentOcc();
        if (occ?.eras && !occ.eras.includes(state.era)) { state.occ = null; state.choices = {}; }
      },
    },
    2: {
      title: '能力値をリセットしますか？',
      msg: '振ったダイスと能力値をすべて消します。職業や技能の割り振りは残ります。',
      run: () => {
        state.stats = {}; state.dice = {}; state.rerolls = 0;
        $('#rollAll').textContent = 'すべての能力値を振る';
        $('#manualToggle').checked = false;
      },
    },
    3: {
      title: '職業をリセットしますか？',
      msg: '選んだ職業、選択した職業技能、オリジナル職業の入力を消します。職業技能に振ったポイントも0になります。',
      run: () => {
        state.occ = null; state.choices = {}; state.customOcc = [];
        state.custom = { ...def.custom };
        $('#occSearch').value = '';
        $('#occStarOnly').checked = false;
      },
    },
    4: {
      title: '技能をリセットしますか？',
      msg: '職業ポイント・興味ポイントの割り振りと、追加した専門分野・入力した専門分野名を消します。能力値と職業は残ります。',
      run: () => { state.alloc = {}; state.extraRows = []; state.specs = {}; },
    },
    5: {
      title: 'プロフィールとバックグラウンドをリセットしますか？',
      msg: 'このページで入力した名前・年齢などのプロフィールと、バックグラウンドの内容をすべて消します。',
      run: () => { state.profile = { ...def.profile }; state.bg = {}; },
    },
  };
  $$('[data-reset]').forEach(b => b.onclick = async () => {
    const n = +b.dataset.reset;
    if (n === 6) return resetAll();
    const r = PAGE_RESETS[n];
    if (!await ask(r.title, r.msg, 'リセットする')) return;
    r.run();
    buildRows(); sanitizeAlloc(); save(); renderAll();
    toast(`「${STEP_LABELS[n - 1]}」をリセットしました`);
  });
}

bind();
if (allRolled()) $('#rollAll').textContent = 'すべて振り直す';
renderAll();
