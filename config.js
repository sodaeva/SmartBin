// =====================================================================
//  CẤU HÌNH  (file duy nhất bạn cần sửa khi đổi project / vị trí thùng)
// =====================================================================

const CONFIG = {
  // Lấy từ Supabase Dashboard > Project Settings > API (giá trị này trùng với trong SmartBin_ESP.ino).
  // Publishable key được phép nằm ở frontend. TUYỆT ĐỐI không dùng service_role / sb_secret_...
  SUPABASE_URL: 'https://wkuxovghtatwadzwottz.supabase.co',
  SUPABASE_KEY: 'sb_publishable_MDAfMVK6FdZQvqiYTFg3ig_JdXfl7lF',

  POLL_MS: 1000,            // chu kỳ đọc trạng thái hiện tại
  REQUEST_TIMEOUT_MS: 5000, // quá thời gian này coi là lỗi mạng
};

// ---------------------------------------------------------------------
//  VỊ TRÍ CHẤM THÙNG RÁC TRÊN BẢN ĐỒ
//  Hệ tọa độ SVG của mỗi tầng: rộng 400, cao 280 (góc trên-trái là 0,0).
//  Muốn dời thùng: chỉ cần sửa x, y ở đây. (pos_x/pos_y trong database KHÔNG được dùng.)
// ---------------------------------------------------------------------
const floor1BinPosition = { x: 335, y: 225 };   // Tầng 1 - khu bếp   (BIN_01)
const floor2BinPosition = { x: 330, y: 190 };   // Tầng 2 - phòng ngủ (BIN_02)

const FLOOR_BIN_POSITION = { 1: floor1BinPosition, 2: floor2BinPosition };
const FLOOR_INFO = {
  1: { title: 'Tầng 1 — Khu bếp' },
  2: { title: 'Tầng 2 — Phòng ngủ' },
};
