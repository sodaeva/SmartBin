// =====================================================================
//  Giao tiếp với Supabase (REST). Không chứa logic giao diện.
//  Tên view/RPC/tham số lấy đúng từ smartbin.sql.
// =====================================================================

async function sb(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
  const headers = { apikey: CONFIG.SUPABASE_KEY };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Key dạng JWT cũ (eyJ...) mới cần Authorization; publishable key thì không (giống firmware ESP).
  if (CONFIG.SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + CONFIG.SUPABASE_KEY;
  try {
    const res = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { /* không phải JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'HTTP ' + res.status);
      err.http = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('timeout'); t.timeout = true; throw t; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const rpc = (fn, args) => sb('rpc/' + fn, args || {});

function describeError(e) {
  if (e.timeout) return 'request timed out';
  if (e.http === 401 || e.http === 403) return 'access denied (wrong key or missing GRANT permission)';
  if (e.http === 404) return 'view/function not found (has smartbin.sql been run? wrong parameter name?)';
  if (e instanceof TypeError) return 'network error or wrong SUPABASE_URL';
  return e.message || String(e);
}

// ---- Trạng thái hiện tại (view v_bins_current, chỉ đọc) ----
const fetchBins = () => sb('v_bins_current?select=*&order=bin_id');

// ---- Lệnh mở nắp ----
const requestOpenLid   = (binId, pin) => rpc('request_open_lid', { p_bin_id: binId, p_pin: pin });
const getCommandStatus = (commandId)  => rpc('get_command_status', { p_command_id: commandId });

// ---- Xác nhận đã đổ rác ----
const confirmEmptied = (binId, pin) => rpc('confirm_emptied', { p_bin_id: binId, p_pin: pin });

// ---- Thống kê (trả về mảng dòng) ----
function statsByHour(binId, fromDate, toDate) {
  const a = { p_bin_id: binId };
  if (fromDate) a.p_from = fromDate;     // 'YYYY-MM-DD' (giờ VN), khoảng [from, to)
  if (toDate) a.p_to = toDate;
  return rpc('stats_by_hour', a);
}
const statsByDay        = (year, month, binId) => rpc('stats_by_day', { p_year: year, p_month: month, p_bin_id: binId });
const statsSummary      = (binId) => rpc('stats_emptying_summary', { p_bin_id: binId });
const statsAvgTimeToFull = (binId) => rpc('stats_avg_time_to_full', { p_bin_id: binId });
