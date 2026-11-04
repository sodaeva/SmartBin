// =====================================================================
//  Giao diện SmartBin: bản đồ, trang chi tiết, điều khiển nắp, thống kê
//  Phụ thuộc: config.js, api.js, Chart.js (CDN)
// =====================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const COLORS = { EMPTY: '#22c55e', MEDIUM: '#eab308', FULL: '#ef4444', UNKNOWN: '#9ca3af' };
const STATUS_TEXT = { EMPTY: 'Empty (low waste)', MEDIUM: 'Medium', FULL: 'Full' };

// ---------------------------------------------------------------------
//  Trạng thái chung
// ---------------------------------------------------------------------
const state = { bins: null, error: null, fetchedAt: null };
let current = { type: 'dashboard', built: false };
let charts = {};
const commands = {};   // binId -> { id, status, message, netError, local }
const busy = {};       // binId -> đang gửi request_open_lid

const getBin = () => (state.bins || []).find(b => b.bin_id === current.id);

// Tin cậy = đọc được Supabase VÀ thiết bị vẫn gửi dữ liệu (is_online do server tính)
const isTrusted = b => !state.error && b.is_online;
const colorOf = b => (isTrusted(b) ? COLORS[b.status] || COLORS.UNKNOWN : COLORS.UNKNOWN);

function connText(b) {
  if (state.error) return 'Lost connection to Supabase — showing stale data';
  if (b.is_online) return 'Online';
  return b.last_seen_at ? 'Offline — device stopped sending data' : 'No data has ever been received from the device';
}

function fmtTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

// Ngày theo giờ Việt Nam dạng YYYY-MM-DD
const vnToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Điền <dl> bằng textContent (không chèn HTML từ dữ liệu)
function fillDl(dl, rows) {
  dl.replaceChildren();
  rows.forEach(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  });
}

function summaryRows(b) {
  const stale = isTrusted(b) ? '' : ' (last known data)';
  return [
    ['Bin', b.name + ' (' + b.bin_id + ')'],
    ['Floor', (FLOOR_INFO[b.floor] || {}).title || 'Floor ' + b.floor],
    ['Fill level', b.fill_percent + '%' + stale],
    ['Status', (STATUS_TEXT[b.status] || b.status) + stale],
    ['Connection', connText(b)],
    ['Sensor last updated', fmtTime(b.last_seen_at)],
  ];
}

// ---------------------------------------------------------------------
//  Mặt bằng SVG (hệ tọa độ 400 x 280)
// ---------------------------------------------------------------------
const WALLS =
  '<rect class="wall" x="10" y="10" width="380" height="260" rx="3"/>' +
  '<rect class="gap" x="41" y="266" width="48" height="8"/>' +
  '<path class="door" d="M40 270 V220 M40 220 A50 50 0 0 1 90 270"/>';

const KITCHEN =
  '<rect class="furn" x="25" y="22" width="350" height="46" rx="3"/>' +
  '<text class="lbl" x="190" y="50">Kitchen counter</text>' +
  '<rect class="furn2" x="70" y="30" width="60" height="30" rx="6"/><circle class="tap" cx="100" cy="45" r="3"/>' +
  '<text class="lbl" x="100" y="84">Sink</text>' +
  '<rect class="furn2" x="245" y="30" width="70" height="30" rx="3"/>' +
  '<circle class="burner" cx="262" cy="39" r="5"/><circle class="burner" cx="298" cy="39" r="5"/>' +
  '<circle class="burner" cx="262" cy="52" r="5"/><circle class="burner" cx="298" cy="52" r="5"/>' +
  '<text class="lbl" x="280" y="84">Stove</text>' +
  '<rect class="furn" x="120" y="130" width="150" height="60" rx="4"/><text class="lbl" x="195" y="165">Dining table</text>';

const BEDROOM =
  '<rect class="furn" x="30" y="30" width="150" height="120" rx="4"/>' +
  '<rect class="pillow" x="42" y="40" width="55" height="26" rx="6"/><rect class="pillow" x="113" y="40" width="55" height="26" rx="6"/>' +
  '<text class="lbl" x="105" y="115">Bed</text>' +
  '<rect class="furn" x="300" y="22" width="80" height="50" rx="3"/><text class="lbl" x="340" y="52">Wardrobe</text>' +
  '<rect class="furn2" x="192" y="26" width="40" height="34" rx="3"/><text class="lbl" x="212" y="78">Side table</text>' +
  '<rect class="window" x="240" y="7" width="50" height="6"/><text class="lbl" x="265" y="32">Window</text>';

function floorSVG(floor) {
  const p = FLOOR_BIN_POSITION[floor] || { x: 200, y: 140 };
  return '<svg class="floor-svg" viewBox="0 0 400 280" role="img">' + WALLS + (floor === 1 ? KITCHEN : BEDROOM) +
    '<g class="bin-marker" data-floor="' + floor + '" transform="translate(' + p.x + ' ' + p.y + ')">' +
    '<title></title><circle r="16" fill="' + COLORS.UNKNOWN + '"/><text y="5" text-anchor="middle">' + floor + '</text></g></svg>';
}

function updateMarkers(root) {
  root.querySelectorAll('.bin-marker').forEach(g => {
    const b = state.bins.find(x => Number(x.floor) === Number(g.dataset.floor));
    const title = g.querySelector('title');
    const circle = g.querySelector('circle');
    if (!b) {
      circle.setAttribute('fill', COLORS.UNKNOWN);
      g.classList.add('offline');
      title.textContent = 'No bin data for this floor yet';
      delete g.dataset.bin;
      return;
    }
    g.dataset.bin = b.bin_id;
    circle.setAttribute('fill', colorOf(b));
    g.classList.toggle('offline', !isTrusted(b));
    title.textContent = summaryRows(b).map(r => r[0] + ': ' + r[1]).join('\n');
  });
}

// ---------------------------------------------------------------------
//  Trang tổng quan
// ---------------------------------------------------------------------
function buildDashboard() {
  app.innerHTML =
    '<h1 class="page-title">SmartBin Map</h1><div class="floors">' +
    [1, 2].map(f => '<section class="card" data-floor="' + f + '"><h2>' + FLOOR_INFO[f].title + '</h2>' +
      floorSVG(f) + '<dl class="info"></dl></section>').join('') +
    '</div>' +
    '<div class="legend">' +
    '<span><i style="background:' + COLORS.EMPTY + '"></i>Empty (&lt; ~30%)</span>' +
    '<span><i style="background:' + COLORS.MEDIUM + '"></i>Medium (~30–75%)</span>' +
    '<span><i style="background:' + COLORS.FULL + '"></i>Full (≥ ~75%)</span>' +
    '<span><i style="background:' + COLORS.UNKNOWN + '"></i>Gray: disconnected / no reliable data</span>' +
    '<span><i style="background:#fff"></i>Solid outline: online</span>' +
    '<span><i class="dash"></i>Dashed outline: offline</span>' +
    '</div>' +
    '<p class="note">Online = the device has sent data within the last 15 seconds. The lid locks when the bin is ≥ 95% full (unlocks below 90%). Click a dot to see details.</p>';
}

function updateDashboard() {
  updateMarkers(app);
  app.querySelectorAll('section[data-floor]').forEach(sec => {
    const b = state.bins.find(x => Number(x.floor) === Number(sec.dataset.floor));
    fillDl($('dl.info', sec), b ? summaryRows(b) : [['Status', 'No bin data for this floor yet']]);
  });
}

// Bấm chấm trên bản đồ -> trang chi tiết
app.addEventListener('click', e => {
  const g = e.target.closest('.bin-marker');
  if (g && g.dataset.bin && current.type === 'dashboard') location.hash = '#/bin/' + g.dataset.bin;
});

// ---------------------------------------------------------------------
//  Trang chi tiết thùng
// ---------------------------------------------------------------------
function buildBin(b) {
  const thisYear = Number(vnToday().slice(0, 4));
  const years = [thisYear - 1, thisYear].map(y => '<option value="' + y + '">' + y + '</option>').join('');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const months = Array.from({ length: 12 }, (_, i) => '<option value="' + (i + 1) + '">' + monthNames[i] + '</option>').join('');

  app.innerHTML =
    '<a class="back" href="#/">← Overview</a>' +
    '<h1 class="page-title" id="d-title"></h1>' +
    '<div class="detail-top">' +
      '<section class="card static"><h2>' + ((FLOOR_INFO[b.floor] || {}).title || 'Floor ' + b.floor) + '</h2>' + floorSVG(b.floor) + '</section>' +
      '<section class="card">' +
        '<h2>Current status</h2>' +
        '<div class="gauge"><div class="gauge-fill" id="g-fill"></div><span id="g-text"></span></div>' +
        '<p class="note" id="d-stale" hidden></p>' +
        '<dl class="info" id="d-info"></dl>' +
        '<p class="note">Lid state is the servo angle commanded by the ESP8266 (the system has no separate lid sensor).</p>' +
      '</section>' +
    '</div>' +

    '<section class="card" id="control">' +
      '<h2>Lid control</h2>' +
      '<p class="note">Commands are written to Supabase; the ESP8266 receives a command on its next data upload (usually ≤ 3 seconds) and runs its own safety checks before opening. ' +
      'Web commands only work while the lid is locked because the bin is full; when it is not locked, the lid opens automatically when someone approaches.</p>' +
      '<div class="row"><input type="password" id="pin" placeholder="PIN code" autocomplete="off" inputmode="numeric">' +
      '<button id="btn-open">Open lid</button></div>' +
      '<p class="note" id="open-reason"></p>' +
      '<div class="cmd" id="cmd-box" hidden></div>' +
      '<hr>' +
      '<div class="row"><button id="btn-empty" class="secondary">Confirm bin emptied</button></div>' +
      '<p class="note" id="empty-hint"></p><p class="note" id="empty-msg"></p>' +
    '</section>' +

    '<h2 class="stats-title">Statistics</h2>' +
    '<section class="card"><div class="tiles" id="st-summary"></div><p class="note" id="st-note"></p></section>' +
    '<div class="stats-grid">' +
      '<section class="card"><h2>Lid openings by hour</h2>' +
        '<select id="hour-range"><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>' +
        '<div class="chart-box"><canvas id="c-hour"></canvas></div><p class="err-text" id="e-hour"></p><p class="note" id="n-hour"></p></section>' +
      '<section class="card"><h2>Lid openings by day</h2>' +
        '<div class="row"><select id="day-month">' + months + '</select><select id="day-year">' + years + '</select></div>' +
        '<div class="chart-box"><canvas id="c-day"></canvas></div><p class="err-text" id="e-day"></p><p class="note" id="n-day"></p></section>' +
    '</div>' +
    '<p class="note">“Lid openings” counts both automatic openings when someone approaches and openings triggered from the web — it is not the amount of waste and not the number of times the bin was emptied. ' +
    'Emptying data is only recorded when you click “Confirm bin emptied”.</p>';

  // Sự kiện
  $('#btn-open').onclick = () => onOpenClick(b.bin_id);
  $('#btn-empty').onclick = () => onEmptyClick(b.bin_id);
  $('#hour-range').onchange = () => loadHour(b.bin_id, current);
  $('#day-month').onchange = $('#day-year').onchange = () => loadDay(b.bin_id, current);

  // Mặc định: tháng/năm hiện tại (giờ VN)
  const today = vnToday();
  $('#day-year').value = today.slice(0, 4);
  $('#day-month').value = String(Number(today.slice(5, 7)));

  // Thống kê chỉ tải khi mở trang / đổi bộ lọc (không tải mỗi giây)
  loadSummary(b.bin_id, current);
  loadHour(b.bin_id, current);
  loadDay(b.bin_id, current);
}

function updateBin() {
  const b = getBin();
  if (!b) return;
  const trusted = isTrusted(b);
  updateMarkers(app);

  $('#d-title').textContent = b.name + ' — ' + b.bin_id;
  const fill = $('#g-fill');
  fill.style.width = b.fill_percent + '%';
  fill.style.background = colorOf(b);
  $('#g-text').textContent = b.fill_percent + '%';

  const stale = $('#d-stale');
  stale.hidden = trusted;
  stale.textContent = 'Last known data — may no longer be accurate (' + connText(b) + ').';

  fillDl($('#d-info'), [
    ['Name / ID', b.name + ' / ' + b.bin_id],
    ['Floor', (FLOOR_INFO[b.floor] || {}).title || 'Floor ' + b.floor],
    ['Fill level', b.fill_percent + '%'],
    ['Status', STATUS_TEXT[b.status] || b.status],
    ['Tilt', b.is_tilted ? 'Tilted / tipped over' : 'Normal'],
    ['Lid lock', b.lid_locked ? 'Locked (bin full)' : 'Unlocked'],
    ['Person nearby', b.person_near ? 'Yes' : 'No'],
    ['Connection', connText(b)],
    ['Sensor last updated', fmtTime(b.last_seen_at)],
    ['Last confirmed emptying', b.last_emptied_at ? fmtTime(b.last_emptied_at) : 'None yet'],
  ]);

  $('#empty-hint').textContent = b.emptying_suspected
    ? 'The fill level just dropped sharply — the bin may have been emptied. Click “Confirm bin emptied” to record it.' : '';
  renderControl();
}

// ---------------------------------------------------------------------
//  Mở nắp
// ---------------------------------------------------------------------
const OPEN_ERRORS = {
  INVALID_PIN: 'Incorrect PIN.',
  BIN_NOT_FOUND: 'Bin not found (or the bin has been disabled).',
  DEVICE_OFFLINE: 'The device is offline — the command cannot be sent.',
  BIN_TILTED: 'The bin is tilted / tipped over — the lid cannot be opened.',
  ALREADY_OPEN: 'The lid is already open.',
  NOT_LOCKED: 'The lid is not locked (the bin is not full) — it opens automatically when someone approaches, so no web command is needed.',
  COMMAND_IN_PROGRESS: 'Another command is already pending.',
};
const FAIL_MSG = {
  BIN_TILTED: 'the bin is tilted / tipped over.',
  ALREADY_OPEN: 'the lid is already open.',
  TIMEOUT: 'the servo did not open within 5 seconds.',
};

// Lý do chặn phía giao diện (backend vẫn kiểm tra lại, đây chỉ để báo rõ cho người dùng)
function openBlockReason(b) {
  if (state.error) return 'Connection to Supabase is lost.';
  if (!b.is_online) return 'The device is offline.';
  if (b.is_tilted) return 'The bin is tilted / tipped over.';
  if (b.lid_open) return 'The lid is already open.';
  if (!b.lid_locked) return 'The lid is not locked (the bin is not full): it opens automatically when someone approaches. Web commands only work while the lid is locked.';
  return '';
}

const isActive = c => c && !c.local && (c.status === 'PENDING' || c.status === 'DELIVERED');

function cmdView(c) {
  let r;
  switch (c.status) {
    case 'PENDING':   r = ['wait', 'Command sent. Waiting for the device to receive it (usually ≤ 3 seconds; the command expires after 30 seconds).']; break;
    case 'DELIVERED': r = ['wait', 'The device received the command and is opening the lid…']; break;
    case 'SUCCESS':   r = ['ok', 'The device confirmed the lid is open (the servo reached the open angle). The lid will close automatically after about 8–11 seconds.']; break;
    case 'EXPIRED':   r = ['fail', 'Command expired: the device did not receive it within 30 seconds.']; break;
    case 'FAILED':    r = ['fail', 'The device reported a failure: ' + (FAIL_MSG[c.message] || c.message || 'unknown reason')]; break;
    default:          r = ['fail', c.message || 'Command rejected.'];
  }
  if (c.netError && isActive(c)) r[1] += ' (Network error while tracking the command: ' + c.netError + ' — retrying.)';
  return r;
}

function renderControl() {
  const b = getBin();
  if (!b || !$('#btn-open')) return;
  const c = commands[b.bin_id];
  const reason = openBlockReason(b);
  const active = isActive(c);
  $('#btn-open').disabled = !!reason || active || !!busy[b.bin_id];
  $('#open-reason').textContent = active ? '' : reason;
  const box = $('#cmd-box');
  if (!c) { box.hidden = true; return; }
  const [cls, text] = cmdView(c);
  box.hidden = false;
  box.className = 'cmd ' + cls;
  box.textContent = text;
}

async function onOpenClick(binId) {
  const pin = $('#pin').value;
  if (!pin) { commands[binId] = { local: true, status: 'REJECTED', message: 'Please enter the PIN.' }; renderControl(); return; }
  if (busy[binId] || isActive(commands[binId])) return;       // chống bấm liên tục
  busy[binId] = true; renderControl();
  try {
    const r = await requestOpenLid(binId, pin);
    if (r.ok) trackCommand(binId, r.command_id, r.status);
    else if (r.error === 'COMMAND_IN_PROGRESS' && r.command_id) trackCommand(binId, r.command_id, 'PENDING');
    else commands[binId] = { local: true, status: 'REJECTED', message: OPEN_ERRORS[r.error] || ('Error: ' + r.error) };
  } catch (e) {
    commands[binId] = { local: true, status: 'REJECTED', message: 'Could not send the command: ' + describeError(e) };
  } finally {
    busy[binId] = false;
    if (current.type === 'bin' && current.id === binId) renderControl();
  }
}

// Theo dõi lệnh mỗi giây cho tới khi SUCCESS / FAILED / EXPIRED (lỗi mạng KHÔNG bị coi là lệnh thất bại)
async function trackCommand(binId, id, status) {
  const c = commands[binId] = { id, status: status || 'PENDING', message: null, netError: null };
  while (commands[binId] === c && isActive(c)) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await getCommandStatus(id);
      c.netError = null;
      if (r.ok) { c.status = r.status; c.message = r.message; }
      else { c.local = true; c.status = 'REJECTED'; c.message = 'Command not found on the server.'; }
    } catch (e) {
      c.netError = describeError(e);
    }
    if (current.type === 'bin' && current.id === binId) renderControl();
  }
}

// ---------------------------------------------------------------------
//  Xác nhận đã đổ rác
// ---------------------------------------------------------------------
const EMPTY_ERRORS = {
  INVALID_PIN: 'Incorrect PIN.',
  BIN_NOT_FOUND: 'Bin not found.',
  FUTURE_TIME: 'Invalid time.',
  TOO_SOON_AFTER_PREVIOUS: 'An emptying was already recorded less than 10 minutes ago.',
};

async function onEmptyClick(binId) {
  const msg = t => { if (current.type === 'bin') $('#empty-msg').textContent = t; };
  const pin = $('#pin').value;
  if (!pin) return msg('Please enter the PIN.');
  if (!confirm('Confirm that this bin has been emptied?')) return;
  const btn = $('#btn-empty'); btn.disabled = true;
  try {
    const r = await confirmEmptied(binId, pin);
    if (r.ok) { msg('Emptying recorded.'); loadSummary(binId, current); }
    else msg(EMPTY_ERRORS[r.error] || ('Error: ' + r.error));
  } catch (e) {
    msg('Could not send: ' + describeError(e));
  } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------------
//  Thống kê  (mỗi khối tự xử lý lỗi, lỗi một khối không ảnh hưởng khối khác)
// ---------------------------------------------------------------------
function drawBar(key, canvasSel, labels, data, label) {
  if (typeof Chart === 'undefined') throw new Error('Could not load the Chart.js library');
  if (charts[key]) charts[key].destroy();
  charts[key] = new Chart($(canvasSel), {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: '#3b82f6' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

async function loadSummary(binId, ctx) {
  const box = $('#st-summary');
  try {
    const [s, a] = await Promise.all([statsSummary(binId), statsAvgTimeToFull(binId)]);
    if (current !== ctx) return;
    const sm = s[0] || {}, av = a[0] || {};
    const tile = (label, value, sub) => '<div class="tile"><small>' + label + '</small><b>' + value + '</b><small>' + (sub || '') + '</small></div>';
    const hasAvg = av.completed_cycles > 0 && av.avg_days !== null;
    box.innerHTML =
      tile('Emptied this week', sm.week_count ?? '—', sm.week_start ? sm.week_start + ' → ' + sm.week_end : '') +
      tile('Emptied this month', sm.month_count ?? '—', '') +
      tile('Total times emptied', sm.total_count ?? '—', '') +
      tile('Avg. time to fill', hasAvg ? Number(av.avg_days).toFixed(2) + ' days' : 'Not enough data',
           hasAvg ? av.completed_cycles + ' completed cycles' : 'needs ≥ 1 cycle: emptied → bin fills up again');
    $('#st-note').textContent = Number(sm.total_count) === 0
      ? 'No emptying has been confirmed yet. These figures only have data after you click “Confirm bin emptied”.' : '';
  } catch (e) {
    if (current === ctx) box.innerHTML = '<p class="err-text">Could not load emptying statistics: ' + describeError(e) + '</p>';
  }
}

async function loadHour(binId, ctx) {
  const err = $('#e-hour'); err.textContent = ''; $('#n-hour').textContent = '';
  try {
    const r = $('#hour-range').value;
    let from = null, to = null;
    if (r !== 'all') { const t = vnToday(); from = addDays(t, -(Number(r) - 1)); to = addDays(t, 1); }
    const rows = await statsByHour(binId, from, to);
    if (current !== ctx) return;
    const data = rows.map(x => Number(x.lid_open_count));
    drawBar('hour', '#c-hour', rows.map(x => x.hour_of_day + 'h'), data, 'Lid openings');
    if (data.every(v => v === 0)) $('#n-hour').textContent = 'No lid openings in this period yet.';
  } catch (e) {
    if (current === ctx) err.textContent = 'Could not load the chart: ' + describeError(e);
  }
}

async function loadDay(binId, ctx) {
  const err = $('#e-day'); err.textContent = ''; $('#n-day').textContent = '';
  try {
    const rows = await statsByDay(Number($('#day-year').value), Number($('#day-month').value), binId);
    if (current !== ctx) return;
    const data = rows.map(x => Number(x.lid_open_count));
    drawBar('day', '#c-day', rows.map(x => Number(String(x.day).slice(8, 10))), data, 'Lid openings');
    if (data.every(v => v === 0)) $('#n-day').textContent = 'No lid openings this month yet.';
  } catch (e) {
    if (current === ctx) err.textContent = 'Could not load the chart: ' + describeError(e);
  }
}

// ---------------------------------------------------------------------
//  Điều hướng, banner, vòng lặp đọc dữ liệu
// ---------------------------------------------------------------------
function renderNav() {
  const nav = $('#nav');
  const key = (state.bins || []).map(b => b.bin_id + b.name).join('|') + '#' + location.hash;
  if (nav.dataset.key === key) return;
  nav.dataset.key = key;
  nav.replaceChildren();
  const add = (href, text) => {
    const a = document.createElement('a');
    a.href = href; a.textContent = text;
    if (location.hash === href || (href === '#/' && !location.hash.startsWith('#/bin/'))) a.className = 'active';
    nav.append(a);
  };
  add('#/', 'Overview');
  (state.bins || []).forEach(b => add('#/bin/' + b.bin_id, b.name + ' (Floor ' + b.floor + ')'));
}

function renderBanner() {
  const el = $('#banner');
  el.hidden = !state.error;
  if (!state.error) return;
  el.className = 'banner err';
  el.textContent = 'Could not fetch data from Supabase: ' + state.error + '. Showing stale data' +
    (state.fetchedAt ? ' (last successful fetch: ' + fmtTime(state.fetchedAt) + ')' : '') + '. Will retry automatically.';
}

function showMessage(text, withBack) {
  const p = document.createElement('p'); p.className = 'note'; p.textContent = text;
  app.replaceChildren(p);
  if (withBack) { const a = document.createElement('a'); a.className = 'back'; a.href = '#/'; a.textContent = '← Overview'; app.append(a); }
}

function refresh() {
  renderBanner();
  renderNav();
  $('#footer').textContent = state.fetchedAt
    ? 'The browser last fetched data successfully at ' + fmtTime(state.fetchedAt) + '. The device sends data about every 3 seconds.' : '';

  if (!state.bins) {
    if (!current.built) showMessage(state.error ? 'No data yet — ' + state.error : 'Loading…');
    return;
  }
  if (!current.built) {
    if (state.bins.length === 0) return showMessage('The v_bins_current view returned no rows — check the bins / bin_status tables.');
    if (current.type === 'dashboard') buildDashboard();
    else {
      const b = getBin();
      if (!b) return showMessage('Bin ' + current.id + ' not found.', true);
      buildBin(b);
    }
    current.built = true;
  }
  if (current.type === 'dashboard') updateDashboard(); else updateBin();
}

function route() {
  Object.values(charts).forEach(c => c.destroy());
  charts = {};
  const m = location.hash.match(/^#\/bin\/(BIN_\d{2})$/);
  current = m ? { type: 'bin', id: m[1], built: false } : { type: 'dashboard', built: false };
  app.replaceChildren();
  refresh();
}

// Đọc trạng thái hiện tại: lần sau chỉ chạy khi lần trước đã xong (không chồng request)
async function pollLoop() {
  try {
    state.bins = await fetchBins();
    state.error = null;
    state.fetchedAt = new Date();
  } catch (e) {
    state.error = describeError(e);     // giữ nguyên state.bins cũ, KHÔNG đặt lại về 0%
  }
  refresh();
  setTimeout(pollLoop, CONFIG.POLL_MS);
}

window.addEventListener('hashchange', route);
route();
pollLoop();
