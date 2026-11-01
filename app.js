// =====================================================================
//  Giao diện SmartBin: bản đồ, trang chi tiết, điều khiển nắp, thống kê
//  Phụ thuộc: config.js, api.js, Chart.js (CDN)
// =====================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const COLORS = { EMPTY: '#22c55e', MEDIUM: '#eab308', FULL: '#ef4444', UNKNOWN: '#9ca3af' };
const STATUS_TEXT = { EMPTY: 'Empty (ít rác)', MEDIUM: 'Medium (trung bình)', FULL: 'Full (đầy)' };

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
  if (state.error) return 'Mất kết nối tới Supabase — đang hiển thị dữ liệu cũ';
  if (b.is_online) return 'Online';
  return b.last_seen_at ? 'Offline — thiết bị ngừng gửi dữ liệu' : 'Chưa từng nhận dữ liệu từ thiết bị';
}

function fmtTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
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
  const stale = isTrusted(b) ? '' : ' (dữ liệu gần nhất)';
  return [
    ['Thùng', b.name + ' (' + b.bin_id + ')'],
    ['Tầng', (FLOOR_INFO[b.floor] || {}).title || 'Tầng ' + b.floor],
    ['Mức đầy', b.fill_percent + '%' + stale],
    ['Trạng thái', (STATUS_TEXT[b.status] || b.status) + stale],
    ['Nghiêng', b.is_tilted ? 'Đang nghiêng/đổ' : 'Bình thường'],
    ['Kết nối', connText(b)],
    ['Cảm biến cập nhật', fmtTime(b.last_seen_at)],
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
  '<text class="lbl" x="190" y="50">Bàn bếp</text>' +
  '<rect class="furn2" x="70" y="30" width="60" height="30" rx="6"/><circle class="tap" cx="100" cy="45" r="3"/>' +
  '<text class="lbl" x="100" y="84">Bồn rửa</text>' +
  '<rect class="furn2" x="245" y="30" width="70" height="30" rx="3"/>' +
  '<circle class="burner" cx="262" cy="39" r="5"/><circle class="burner" cx="298" cy="39" r="5"/>' +
  '<circle class="burner" cx="262" cy="52" r="5"/><circle class="burner" cx="298" cy="52" r="5"/>' +
  '<text class="lbl" x="280" y="84">Bếp nấu</text>' +
  '<rect class="furn" x="120" y="130" width="150" height="60" rx="4"/><text class="lbl" x="195" y="165">Bàn ăn</text>';

const BEDROOM =
  '<rect class="furn" x="30" y="30" width="150" height="120" rx="4"/>' +
  '<rect class="pillow" x="42" y="40" width="55" height="26" rx="6"/><rect class="pillow" x="113" y="40" width="55" height="26" rx="6"/>' +
  '<text class="lbl" x="105" y="115">Giường</text>' +
  '<rect class="furn" x="300" y="22" width="80" height="50" rx="3"/><text class="lbl" x="340" y="52">Tủ quần áo</text>' +
  '<rect class="furn2" x="192" y="26" width="40" height="34" rx="3"/><text class="lbl" x="212" y="78">Bàn nhỏ</text>' +
  '<rect class="window" x="240" y="7" width="50" height="6"/><text class="lbl" x="265" y="32">Cửa sổ</text>';

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
      title.textContent = 'Chưa có dữ liệu thùng cho tầng này';
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
    '<h1 class="page-title">Bản đồ SmartBin</h1><div class="floors">' +
    [1, 2].map(f => '<section class="card" data-floor="' + f + '"><h2>' + FLOOR_INFO[f].title + '</h2>' +
      floorSVG(f) + '<dl class="info"></dl></section>').join('') +
    '</div>' +
    '<div class="legend">' +
    '<span><i style="background:' + COLORS.EMPTY + '"></i>Empty (&lt; ~30%)</span>' +
    '<span><i style="background:' + COLORS.MEDIUM + '"></i>Medium (~30–75%)</span>' +
    '<span><i style="background:' + COLORS.FULL + '"></i>Full (≥ ~75%)</span>' +
    '<span><i style="background:' + COLORS.UNKNOWN + '"></i>Xám: mất kết nối / không có dữ liệu đáng tin cậy</span>' +
    '<span><i style="background:#fff"></i>Viền liền: online</span>' +
    '<span><i class="dash"></i>Viền đứt: offline</span>' +
    '</div>' +
    '<p class="note">Online = thiết bị gửi dữ liệu trong 15 giây gần nhất. Nắp bị khóa khi thùng ≥ 95% (mở khóa khi &lt; 90%). Bấm vào chấm để xem chi tiết.</p>';
}

function updateDashboard() {
  updateMarkers(app);
  app.querySelectorAll('section[data-floor]').forEach(sec => {
    const b = state.bins.find(x => Number(x.floor) === Number(sec.dataset.floor));
    fillDl($('dl.info', sec), b ? summaryRows(b) : [['Trạng thái', 'Chưa có dữ liệu thùng cho tầng này']]);
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
  const months = Array.from({ length: 12 }, (_, i) => '<option value="' + (i + 1) + '">Tháng ' + (i + 1) + '</option>').join('');

  app.innerHTML =
    '<a class="back" href="#/">← Tổng quan</a>' +
    '<h1 class="page-title" id="d-title"></h1>' +
    '<div class="detail-top">' +
      '<section class="card static"><h2>' + ((FLOOR_INFO[b.floor] || {}).title || 'Tầng ' + b.floor) + '</h2>' + floorSVG(b.floor) + '</section>' +
      '<section class="card">' +
        '<h2>Trạng thái hiện tại</h2>' +
        '<div class="gauge"><div class="gauge-fill" id="g-fill"></div><span id="g-text"></span></div>' +
        '<p class="note" id="d-stale" hidden></p>' +
        '<dl class="info" id="d-info"></dl>' +
        '<p class="note">Trạng thái nắp là góc servo mà ESP8266 đang điều khiển (hệ thống không có cảm biến nắp riêng).</p>' +
      '</section>' +
    '</div>' +

    '<section class="card" id="control">' +
      '<h2>Điều khiển nắp</h2>' +
      '<p class="note">Lệnh được ghi vào Supabase; ESP8266 nhận lệnh ở lần gửi dữ liệu kế tiếp (thường ≤ 3 giây) và tự kiểm tra an toàn trước khi mở. ' +
      'Lệnh từ web chỉ dùng được khi nắp đang bị khóa do đầy; khi chưa khóa, nắp tự mở khi có người đến gần.</p>' +
      '<div class="row"><input type="password" id="pin" placeholder="Mã PIN" autocomplete="off" inputmode="numeric">' +
      '<button id="btn-open">Mở nắp</button></div>' +
      '<p class="note" id="open-reason"></p>' +
      '<div class="cmd" id="cmd-box" hidden></div>' +
      '<hr>' +
      '<div class="row"><button id="btn-empty" class="secondary">Xác nhận đã đổ rác</button></div>' +
      '<p class="note" id="empty-hint"></p><p class="note" id="empty-msg"></p>' +
    '</section>' +

    '<h2 class="stats-title">Thống kê</h2>' +
    '<section class="card"><div class="tiles" id="st-summary"></div><p class="note" id="st-note"></p></section>' +
    '<div class="stats-grid">' +
      '<section class="card"><h2>Số lần nắp mở theo giờ</h2>' +
        '<select id="hour-range"><option value="all">Tất cả</option><option value="7">7 ngày gần nhất</option><option value="30">30 ngày gần nhất</option></select>' +
        '<div class="chart-box"><canvas id="c-hour"></canvas></div><p class="err-text" id="e-hour"></p><p class="note" id="n-hour"></p></section>' +
      '<section class="card"><h2>Số lần nắp mở theo ngày</h2>' +
        '<div class="row"><select id="day-month">' + months + '</select><select id="day-year">' + years + '</select></div>' +
        '<div class="chart-box"><canvas id="c-day"></canvas></div><p class="err-text" id="e-day"></p><p class="note" id="n-day"></p></section>' +
    '</div>' +
    '<p class="note">“Số lần nắp mở” đếm cả khi nắp tự mở lúc có người đến gần lẫn khi mở từ web — không phải khối lượng rác và không phải số lần đổ rác. ' +
    'Số liệu đổ rác chỉ có khi bạn bấm “Xác nhận đã đổ rác”.</p>';

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
  stale.textContent = 'Dữ liệu gần nhất — có thể không còn đúng với hiện tại (' + connText(b) + ').';

  fillDl($('#d-info'), [
    ['Tên / ID', b.name + ' / ' + b.bin_id],
    ['Tầng', (FLOOR_INFO[b.floor] || {}).title || 'Tầng ' + b.floor],
    ['Mức đầy', b.fill_percent + '%'],
    ['Trạng thái', STATUS_TEXT[b.status] || b.status],
    ['Nghiêng', b.is_tilted ? 'Đang nghiêng/đổ' : 'Bình thường'],
    ['Nắp', b.lid_open ? 'Đang mở' : 'Đóng'],
    ['Khóa nắp', b.lid_locked ? 'Đang khóa do đầy' : 'Không khóa'],
    ['Người đến gần', b.person_near ? 'Có' : 'Không'],
    ['Kết nối', connText(b)],
    ['Cảm biến cập nhật', fmtTime(b.last_seen_at)],
    ['Đổ rác xác nhận gần nhất', b.last_emptied_at ? fmtTime(b.last_emptied_at) : 'Chưa có'],
  ]);

  $('#empty-hint').textContent = b.emptying_suspected
    ? 'Mức rác vừa tụt mạnh — có thể thùng đã được đổ. Bấm “Xác nhận đã đổ rác” để ghi nhận.' : '';
  renderControl();
}

// ---------------------------------------------------------------------
//  Mở nắp
// ---------------------------------------------------------------------
const OPEN_ERRORS = {
  INVALID_PIN: 'Mã PIN không đúng.',
  BIN_NOT_FOUND: 'Không tìm thấy thùng (hoặc thùng đã bị vô hiệu hóa).',
  DEVICE_OFFLINE: 'Thiết bị đang offline — không thể gửi lệnh.',
  BIN_TILTED: 'Thùng đang bị nghiêng/đổ — không được mở nắp.',
  ALREADY_OPEN: 'Nắp đang mở.',
  NOT_LOCKED: 'Nắp chưa bị khóa (thùng chưa đầy) — nắp tự mở khi có người đến gần, không cần lệnh từ web.',
  COMMAND_IN_PROGRESS: 'Đang có một lệnh khác chờ xử lý.',
};
const FAIL_MSG = {
  BIN_TILTED: 'thùng đang nghiêng/đổ.',
  ALREADY_OPEN: 'nắp đang mở.',
  TIMEOUT: 'servo không mở được trong 5 giây.',
};

// Lý do chặn phía giao diện (backend vẫn kiểm tra lại, đây chỉ để báo rõ cho người dùng)
function openBlockReason(b) {
  if (state.error) return 'Đang mất kết nối tới Supabase.';
  if (!b.is_online) return 'Thiết bị đang offline.';
  if (b.is_tilted) return 'Thùng đang bị nghiêng/đổ.';
  if (b.lid_open) return 'Nắp đang mở.';
  if (!b.lid_locked) return 'Nắp chưa bị khóa (thùng chưa đầy): nắp tự mở khi có người đến gần. Lệnh từ web chỉ dùng khi nắp đang khóa.';
  return '';
}

const isActive = c => c && !c.local && (c.status === 'PENDING' || c.status === 'DELIVERED');

function cmdView(c) {
  let r;
  switch (c.status) {
    case 'PENDING':   r = ['wait', 'Đã gửi lệnh. Đang chờ thiết bị nhận lệnh (thường ≤ 3 giây; lệnh hết hạn sau 30 giây).']; break;
    case 'DELIVERED': r = ['wait', 'Thiết bị đã nhận lệnh, đang mở nắp…']; break;
    case 'SUCCESS':   r = ['ok', 'Thiết bị xác nhận đã mở nắp (servo đã quay tới góc mở). Nắp sẽ tự đóng sau khoảng 8–11 giây.']; break;
    case 'EXPIRED':   r = ['fail', 'Lệnh hết hạn: thiết bị không nhận lệnh trong 30 giây.']; break;
    case 'FAILED':    r = ['fail', 'Thiết bị báo thất bại: ' + (FAIL_MSG[c.message] || c.message || 'không rõ lý do')]; break;
    default:          r = ['fail', c.message || 'Lệnh bị từ chối.'];
  }
  if (c.netError && isActive(c)) r[1] += ' (Lỗi mạng khi theo dõi lệnh: ' + c.netError + ' — đang thử lại.)';
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
  if (!pin) { commands[binId] = { local: true, status: 'REJECTED', message: 'Hãy nhập mã PIN.' }; renderControl(); return; }
  if (busy[binId] || isActive(commands[binId])) return;       // chống bấm liên tục
  busy[binId] = true; renderControl();
  try {
    const r = await requestOpenLid(binId, pin);
    if (r.ok) trackCommand(binId, r.command_id, r.status);
    else if (r.error === 'COMMAND_IN_PROGRESS' && r.command_id) trackCommand(binId, r.command_id, 'PENDING');
    else commands[binId] = { local: true, status: 'REJECTED', message: OPEN_ERRORS[r.error] || ('Lỗi: ' + r.error) };
  } catch (e) {
    commands[binId] = { local: true, status: 'REJECTED', message: 'Không gửi được lệnh: ' + describeError(e) };
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
      else { c.local = true; c.status = 'REJECTED'; c.message = 'Không tìm thấy lệnh trên server.'; }
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
  INVALID_PIN: 'Mã PIN không đúng.',
  BIN_NOT_FOUND: 'Không tìm thấy thùng.',
  FUTURE_TIME: 'Thời điểm không hợp lệ.',
  TOO_SOON_AFTER_PREVIOUS: 'Vừa ghi nhận lần đổ rác cách đây chưa đến 10 phút.',
};

async function onEmptyClick(binId) {
  const msg = t => { if (current.type === 'bin') $('#empty-msg').textContent = t; };
  const pin = $('#pin').value;
  if (!pin) return msg('Hãy nhập mã PIN.');
  if (!confirm('Xác nhận thùng này đã được đổ rác?')) return;
  const btn = $('#btn-empty'); btn.disabled = true;
  try {
    const r = await confirmEmptied(binId, pin);
    if (r.ok) { msg('Đã ghi nhận lần đổ rác.'); loadSummary(binId, current); }
    else msg(EMPTY_ERRORS[r.error] || ('Lỗi: ' + r.error));
  } catch (e) {
    msg('Không gửi được: ' + describeError(e));
  } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------------
//  Thống kê  (mỗi khối tự xử lý lỗi, lỗi một khối không ảnh hưởng khối khác)
// ---------------------------------------------------------------------
function drawBar(key, canvasSel, labels, data, label) {
  if (typeof Chart === 'undefined') throw new Error('Không tải được thư viện Chart.js');
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
      tile('Đổ rác tuần này', sm.week_count ?? '—', sm.week_start ? sm.week_start + ' → ' + sm.week_end : '') +
      tile('Đổ rác tháng này', sm.month_count ?? '—', '') +
      tile('Tổng số lần đổ rác', sm.total_count ?? '—', '') +
      tile('Thời gian TB để đầy', hasAvg ? Number(av.avg_days).toFixed(2) + ' ngày' : 'Chưa đủ dữ liệu',
           hasAvg ? av.completed_cycles + ' chu kỳ hoàn tất' : 'cần ≥ 1 chu kỳ: đổ rác → thùng đầy lại');
    $('#st-note').textContent = Number(sm.total_count) === 0
      ? 'Chưa có lần đổ rác nào được xác nhận. Các chỉ số này chỉ có số liệu sau khi bấm “Xác nhận đã đổ rác”.' : '';
  } catch (e) {
    if (current === ctx) box.innerHTML = '<p class="err-text">Không tải được thống kê đổ rác: ' + describeError(e) + '</p>';
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
    drawBar('hour', '#c-hour', rows.map(x => x.hour_of_day + 'h'), data, 'Số lần nắp mở');
    if (data.every(v => v === 0)) $('#n-hour').textContent = 'Chưa có lần nắp mở nào trong khoảng này.';
  } catch (e) {
    if (current === ctx) err.textContent = 'Không tải được biểu đồ: ' + describeError(e);
  }
}

async function loadDay(binId, ctx) {
  const err = $('#e-day'); err.textContent = ''; $('#n-day').textContent = '';
  try {
    const rows = await statsByDay(Number($('#day-year').value), Number($('#day-month').value), binId);
    if (current !== ctx) return;
    const data = rows.map(x => Number(x.lid_open_count));
    drawBar('day', '#c-day', rows.map(x => Number(String(x.day).slice(8, 10))), data, 'Số lần nắp mở');
    if (data.every(v => v === 0)) $('#n-day').textContent = 'Chưa có lần nắp mở nào trong tháng này.';
  } catch (e) {
    if (current === ctx) err.textContent = 'Không tải được biểu đồ: ' + describeError(e);
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
  add('#/', 'Tổng quan');
  (state.bins || []).forEach(b => add('#/bin/' + b.bin_id, b.name + ' (Tầng ' + b.floor + ')'));
}

function renderBanner() {
  const el = $('#banner');
  el.hidden = !state.error;
  if (!state.error) return;
  el.className = 'banner err';
  el.textContent = 'Không lấy được dữ liệu từ Supabase: ' + state.error + '. Đang hiển thị dữ liệu cũ' +
    (state.fetchedAt ? ' (lần lấy thành công gần nhất: ' + fmtTime(state.fetchedAt) + ')' : '') + '. Sẽ tự thử lại.';
}

function showMessage(text, withBack) {
  const p = document.createElement('p'); p.className = 'note'; p.textContent = text;
  app.replaceChildren(p);
  if (withBack) { const a = document.createElement('a'); a.className = 'back'; a.href = '#/'; a.textContent = '← Tổng quan'; app.append(a); }
}

function refresh() {
  renderBanner();
  renderNav();
  $('#footer').textContent = state.fetchedAt
    ? 'Trình duyệt lấy dữ liệu thành công lần cuối lúc ' + fmtTime(state.fetchedAt) + '. Thiết bị gửi dữ liệu mỗi ~3 giây.' : '';

  if (!state.bins) {
    if (!current.built) showMessage(state.error ? 'Chưa có dữ liệu — ' + state.error : 'Đang tải…');
    return;
  }
  if (!current.built) {
    if (state.bins.length === 0) return showMessage('View v_bins_current không có dòng nào — kiểm tra bảng bins / bin_status.');
    if (current.type === 'dashboard') buildDashboard();
    else {
      const b = getBin();
      if (!b) return showMessage('Không tìm thấy thùng ' + current.id + '.', true);
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
