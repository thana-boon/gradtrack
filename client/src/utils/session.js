// ─── นโยบายหมดเวลาใช้งาน (ฝั่ง client) ──────────────────────────────────────
//
// มีสองชั้นซ้อนกัน:
//   1. ไม่ขยับ 15 นาที → หลุด            ← ไฟล์นี้
//   2. token หมดอายุตามจริง (JWT_EXPIRES_IN ฝั่ง server, ค่าเริ่มต้น 8h) → หลุด
//
// ⚠️  ชั้นที่ 1 เป็นแค่ "ล็อกหน้าจอที่เปิดค้างไว้" ไม่ใช่มาตรการความปลอดภัย —
//     ใครลบ lastActivity ใน localStorage ทิ้งก็ข้ามได้ ตัวที่บังคับจริงคือ
//     อายุ token ที่ server ตรวจใน verifyToken เสมอ
//
// นับเวลาผ่าน localStorage ไม่ใช่ตัวแปรในหน่วยความจำ เพื่อให้
//   · reload หน้าแล้วนาฬิกาไม่รีเซ็ต (ไม่งั้นเปิดค้างข้ามคืนแล้ว F5 ก็ยังอยู่)
//   · ขยับในแท็บหนึ่ง = แท็บอื่นไม่หลุดตาม (ครูเปิดหลายแท็บพร้อมกันเป็นเรื่องปกติ)
//
// "ไม่ได้แตะ GradTrack" ยังไม่เท่ากับ "ลุกจากเครื่องไปแล้ว" — ครูมักเปิดระบบอื่นของ
// SchoolOS ค้างไว้ด้วย session เดียวกัน แล้วทำงานอยู่ตรงนั้นทั้งชั่วโมง นาฬิกาตัวนี้
// จึงมีสองเข็ม: เข็มของแท็บนี้ กับเข็มที่บอกว่า "เพิ่งยืนยันว่ายังมี session ของ
// SchoolOS อยู่จริง" · หมดเวลาก็ต่อเมื่อเงียบทั้งคู่ (ดู isIdleExpired)

import { withBase } from './withBase';

// ตั้งเป็นนาทีไว้ตัวเดียว แล้วให้ข้อความที่หน้า login อ้างอิงค่านี้ — เคยมีปัญหา
// แก้ตัวเลขที่นี่แล้วลืมแก้ข้อความ ผู้ใช้เลยอ่านเจอเวลาที่ไม่ตรงกับของจริง
//
// ต้องไม่ยาวกว่า idle window ของ SchoolOS (SESSION_IDLE_MINUTES) ไม่งั้นจะเจอ
// สภาพ "ยังอยู่ใน GradTrack แต่ SchoolOS ตายไปแล้ว" แล้วต้องกรอกรหัสใหม่ทั้งที่
// เพิ่งใช้งานอยู่แท้ ๆ
export const IDLE_TIMEOUT_MINUTES = 15;
export const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;

// เขียน lastActivity ถี่สุดทุก ๆ เท่านี้ — กัน mousemove ยิง localStorage รัวๆ
const ACTIVITY_WRITE_INTERVAL_MS = 30 * 1000;

const LAST_ACTIVITY_KEY = 'lastActivity';
const PLATFORM_ACTIVITY_KEY = 'lastPlatformActivity';
const LOGOUT_REASON_KEY = 'logoutReason';
const LOGOUT_AT_KEY = 'logoutAt';

// ที่อยู่ SchoolOS ที่จะเด้งกลับไปเมื่อ session จบ — utils/sso.js เขียนไว้ให้ตอนอ่าน
// คอนฟิกจาก server (ค่าเดียวกับ SCHOOLOS_PORTAL_URL) · เก็บใน localStorage เพราะ
// ไฟล์นี้ถูกเรียกจาก axios interceptor ซึ่งรออะไรแบบ async ไม่ได้
export const SCHOOLOS_HOME_KEY = 'schoolosHome';

// "เพิ่งเด้งไป SchoolOS ไปแล้วรอบหนึ่ง" — ตัวกันลูป ดู bouncedToSchoolOSRecently()
const BOUNCED_AT_KEY = 'schoolosBouncedAt';
const BOUNCE_COOLDOWN_MS = 10 * 60 * 1000;

export const TOKEN_KEY = 'token';
export const USER_KEY = 'user';

// เหตุผลที่หลุด — ใช้บอกผู้ใช้ที่หน้า login ว่าไม่ได้กดออกเอง
export const LOGOUT_REASONS = {
  IDLE: 'idle',       // ไม่ได้ใช้งานนานเกินกำหนด
  EXPIRED: 'expired', // token หมดอายุ / server ตอบ 401
  // ─── สองตัวล่างมาจากตัวตรวจตัวตนสด (components/SessionGuard.jsx) ───────────
  SSO_ENDED: 'sso_ended',       // ไม่มีใครล็อกอิน SchoolOS แล้ว — session เราหมดความชอบธรรม
  SSO_DENIED: 'sso_denied',     // เปลี่ยนคนที่ portal แล้ว แต่คนใหม่ไม่มีสิทธิ์ใช้ระบบนี้
};

// เหตุผลที่ **อาจ** วนเป็นวงถ้าให้ silent SSO พาเข้าใหม่ทันที
//
// EXPIRED อยู่ในนี้เพราะ token ที่ server ปฏิเสธ (401) แล้วให้ silent SSO พาเข้าใหม่ทันที
// เสี่ยงวนเป็นวง: เข้าได้ → โดน 401 อีก → เข้าใหม่ → ...
//
// ⚠️ "อาจ" ไม่ใช่ "ทุกครั้ง" — เคสที่พบบ่อยกว่าลูปมาก คือคนที่ไม่ได้เปิด GradTrack มา
// ข้ามวันจน token 8 ชั่วโมงหมดอายุคาไว้ใน localStorage แล้ววันนี้ล็อกอิน SchoolOS ใหม่
// เดินเข้ามา: loadSession() ปั๊ม EXPIRED ให้ตั้งแต่ยังไม่ทันยิง request แรก ถ้าถือว่า
// EXPIRED = ต้องกรอกรหัสเองเสมอ เขาจะเจอ "เซสชันหมดอายุแล้ว" พร้อมฟอร์มเปล่า ทั้งที่
// เพิ่งล็อกอิน SchoolOS มาหมาด ๆ และ SSO พาเข้าได้อยู่แล้ว (เด้งกลับไปก็ไม่ช่วย เพราะ
// session ฝั่งโน้นยังดีอยู่ shouldBounceToSchoolOS จึงไม่เด้ง = ยืนค้างอยู่ที่ฟอร์ม)
//
// ตัวที่บอกว่า "วนอยู่จริง" คือ silent SSO เพิ่งพาเข้ามาเมื่อกี้แล้วหลุดซ้ำภายในไม่กี่สิบ
// วินาที ไม่ใช่ตัวเหตุผลเอง → ดู mustLoginManually()
//
// IDLE **ไม่**อยู่ในนี้แล้ว — silent SSO จะพาเข้าใหม่ได้ก็ต่อเมื่อ SchoolOS ยืนยันว่า
// "ยังล็อกอินอยู่" ซึ่งแปลว่าผู้ใช้ยังทำงานอยู่ในระบบอื่นของแพลตฟอร์มด้วย session
// เดียวกันมาตลอด (ดู isIdleExpired) การบังคับให้พิมพ์รหัสซ้ำในจังหวะนั้นไม่ได้เพิ่ม
// ความปลอดภัยอะไร มีแต่ทำให้ครูที่ทำงานอยู่แท้ ๆ เจอ "ไม่ได้ใช้งานเกิน 15 นาที"
// ทั้งที่ไม่จริง · ลุกจากเครื่องไปจริง ๆ session ฝั่งแพลตฟอร์มก็หมดตามไปด้วย
// → ขอโค้ด handoff ไม่ได้ → เห็นฟอร์มพร้อมข้อความบอกเหตุผลเหมือนเดิม
//
// ส่วนเหตุผลฝั่ง SSO ไม่อยู่ในนี้: มันแปลว่า "ตัวตนที่ SchoolOS เปลี่ยนไปแล้ว"
// การให้คนที่ล็อกอิน SchoolOS อยู่ตอนนี้กรอกรหัสเองซ้ำไม่ได้เพิ่มความปลอดภัยอะไร
// มีแต่จะทำให้เครื่องส่วนกลางใช้ยากขึ้นเปล่า ๆ
const LOOP_PRONE_REASONS = [LOGOUT_REASONS.EXPIRED];

// ─── ตัวจับลูปของ silent SSO ─────────────────────────────────────────────────
//
// "เพิ่งถูก silent SSO พาเข้ามา" — sessionStorage เพราะต้องรอดข้ามการโหลดหน้า
// (เข้าระบบแล้วโดน 401 → เด้งออก → เดินกลับเข้ามา) แต่ไม่ควรข้ามไปแท็บอื่น
const SSO_ENTERED_KEY = 'ssoEnteredAt';

// กว้างพอครอบ "เข้าแล้วโดนเตะทันที" แต่แคบกว่าการใช้งานจริงมาก — ครูที่ทำงานอยู่
// สักพักแล้ว token หมดอายุตามกำหนด ไม่ควรถูกนับเป็นลูป
const SSO_LOOP_WINDOW_MS = 60 * 1000;

/** ⚠️ เรียกจาก trySilentLogin() ที่เดียว — ที่อื่นเรียก = ตัวจับลูปเพี้ยน */
export function markSilentLogin() {
  sessionStorage.setItem(SSO_ENTERED_KEY, String(Date.now()));
}

/**
 * ต้องกรอกรหัสเองรอบนี้ไหม (= ห้าม silent SSO พาเข้า)
 *
 * จริงก็ต่อเมื่อครบทั้งสามข้อ: เพิ่งหลุดมาหมาด ๆ · หลุดด้วยเหตุที่วนได้ · และ silent SSO
 * เพิ่งพาเข้ามาก่อนหน้านั้นไม่ถึงนาที = เข้าแล้วหลุดซ้ำทันที ซึ่งคือลูปของจริง
 * อย่างมากจึงลองพาเข้าเองซ้ำได้ 1 ครั้งต่อนาที ไม่ใช่ปิดยาว 15 นาทีให้ทุกคนที่ token หมดอายุ
 */
export function mustLoginManually() {
  if (!wasRecentlyLoggedOut()) return false;
  if (!LOOP_PRONE_REASONS.includes(getLogoutReason())) return false;
  const at = Number(sessionStorage.getItem(SSO_ENTERED_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < SSO_LOOP_WINDOW_MS;
}

// ─── บันทึกความเคลื่อนไหว ────────────────────────────────────────────────────

let lastWrite = 0;

export function markActivity({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastWrite < ACTIVITY_WRITE_INTERVAL_MS) return;
  lastWrite = now;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
}

export function clearActivity() {
  lastWrite = 0;
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  localStorage.removeItem(PLATFORM_ACTIVITY_KEY);
}

/**
 * บันทึกว่า "เพิ่งยืนยันแล้วว่ายังมี session ของ SchoolOS ของคนเดิมอยู่จริง"
 *
 * ⚠️ เขียนได้จากที่เดียว: หลังถาม GET /api/auth/session แล้วได้คนเดิมกลับมา
 * ห้ามให้ event ในหน้าเว็บเขียนเด็ดขาด ไม่งั้นจะกลายเป็นวงจรป้อนกลับที่ทำให้
 * session ไม่มีวันหมดอายุ — แท็บที่เปิดค้างไว้ต่ออายุ session ของแพลตฟอร์ม
 * (AuthContext) → แพลตฟอร์มยังสด → แท็บไม่หลุด → ต่ออายุอีก วนไปเรื่อย ๆ
 * ด้วยเหตุผลเดียวกัน msSinceActivity() จึงต้องนับเฉพาะการขยับในแท็บนี้เสมอ
 */
export function markPlatformActivity() {
  localStorage.setItem(PLATFORM_ACTIVITY_KEY, String(Date.now()));
}

export function clearPlatformActivity() {
  localStorage.removeItem(PLATFORM_ACTIVITY_KEY);
}

/** ผ่านมากี่ ms ตั้งแต่ยืนยันครั้งล่าสุด · Infinity = ยังไม่เคยยืนยัน */
export function msSincePlatformActivity() {
  const last = Number(localStorage.getItem(PLATFORM_ACTIVITY_KEY));
  if (!Number.isFinite(last) || last <= 0) return Infinity;
  return Date.now() - last;
}

/**
 * ผ่านมากี่ ms ตั้งแต่ผู้ใช้ขยับล่าสุด · Infinity = ยังไม่เคยบันทึก
 * ใช้ตัดสินว่า "ยังทำงานอยู่จริง" ก่อนไปต่ออายุ session ของ SchoolOS ให้
 */
export function msSinceActivity() {
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  if (!Number.isFinite(last) || last <= 0) return Infinity;
  return Date.now() - last;
}

/**
 * หมดเวลาจริงหรือยัง — ต้องเงียบทั้งสองเข็ม
 *
 * เข็มที่สอง (SchoolOS) กันอาการที่ผู้ใช้เจอบ่อยที่สุด: เปิด GradTrack ค้างไว้แล้วไป
 * ทำงานในระบบอื่นของ SchoolOS ด้วย session เดียวกันเป็นชั่วโมง พอกลับมาก็เจอ
 * "ไม่ได้ใช้งานเกิน 15 นาที" ทั้งที่ใช้งานแพลตฟอร์มอยู่ตลอด
 *
 * เข็มนี้เดินหน้าได้ก็ต่อเมื่อ **ถามแล้วได้คำยืนยัน** เท่านั้น (ดู markPlatformActivity)
 * ถามไม่ได้/ไม่มีใครล็อกอินแล้ว = เข็มค้างอยู่ที่เดิม แล้วหมดเวลาตามกำหนดเดิม —
 * ตั้งใจให้ผิดไปทางเตะออก ไม่ใช่ทางยืดให้ ตัว probe ที่พังจึงกลายเป็น session
 * อมตะไม่ได้
 */
export function isIdleExpired() {
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  // ยังไม่เคยบันทึก = เพิ่งอัปเดตมาจากเวอร์ชันก่อนหน้าที่ยังไม่มีฟีเจอร์นี้
  // → ปล่อยให้อายุ token เป็นตัวตัดสินแทน ไม่เตะออกทันทีโดยไม่มีเหตุ
  if (!Number.isFinite(last) || last <= 0) return false;
  if (Date.now() - last < IDLE_TIMEOUT_MS) return false;
  return msSincePlatformActivity() >= IDLE_TIMEOUT_MS;
}

// ─── อ่านวันหมดอายุจาก JWT ───────────────────────────────────────────────────
// decode เฉย ๆ ไม่ verify — ใช้เพื่อ "รู้ล่วงหน้า" ว่าหมดอายุแล้วจะได้ไม่ต้อง
// ยิง request ไปให้ server ตอบ 401 ก่อน ความถูกต้องจริงตรวจที่ server เสมอ

/**
 * claim ทั้งก้อนใน token · {} เมื่ออ่านไม่ออก
 *
 * ใช้อ่านฟิลด์ที่ไม่ได้อยู่ใน user object เช่น via / ssoSub ที่ตัวตรวจตัวตนสดต้องใช้
 * (ดู components/SessionGuard.jsx) — ค่าที่ได้ใช้ "ตัดสินใจฝั่งหน้าเว็บ" เท่านั้น
 * ห้ามเอาไปใช้แทนการตรวจสิทธิ์ ซึ่ง server ทำจากลายเซ็นเสมอ
 *
 * ⚠️ ข้อความภาษาไทย (เช่น name) ที่อ่านออกมาทางนี้จะเพี้ยน เพราะ atob คืนไบต์ดิบ
 * ไม่ได้ decode UTF-8 — อ่านเฉพาะฟิลด์ที่เป็น ASCII
 */
export function getTokenClaims(token) {
  if (!token) return {};
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64));
    return claims && typeof claims === 'object' ? claims : {};
  } catch {
    return {}; // token พัง → ให้ 401 จาก server จัดการ
  }
}

export function getTokenExpiry(token) {
  const { exp } = getTokenClaims(token);
  return typeof exp === 'number' ? exp * 1000 : 0;
}

export function isTokenExpired(token) {
  const exp = getTokenExpiry(token);
  return exp > 0 && Date.now() >= exp;
}

// ─── เหตุผลที่หลุด (ส่งต่อไปหน้า login) ──────────────────────────────────────

// เขียนทุกครั้งที่ session จบ — ส่ง null เมื่อผู้ใช้กดออกเอง เพื่อล้างเหตุผลเก่าทิ้ง
// (ไม่งั้นกดออกเองแล้วยังเห็นข้อความ "หมดเวลา" จากรอบก่อนค้างอยู่)
//
// เก็บ "เมื่อไหร่" ไว้ด้วย เพราะเหตุผลนี้เป็นคำอธิบายของ *ตอนนี้* ไม่ใช่ตราประทับถาวร
// ดู wasRecentlyLoggedOut()
export function setLogoutReason(reason) {
  if (reason) {
    localStorage.setItem(LOGOUT_REASON_KEY, reason);
    localStorage.setItem(LOGOUT_AT_KEY, String(Date.now()));
  } else {
    localStorage.removeItem(LOGOUT_REASON_KEY);
    localStorage.removeItem(LOGOUT_AT_KEY);
  }
}

/**
 * เพิ่งถูกเตะออกไปหมาด ๆ หรือเปล่า (ไม่ใช่ "เคยถูกเตะเมื่อไหร่ก็ได้")
 *
 * ใช้ตัดสินสองอย่างที่ต้องไปด้วยกัน: จะโชว์ข้อความ "หมดเวลา" ไหม และจะข้าม
 * silent SSO ไหม — เพราะถ้าเพิ่งโดนเตะ ผู้ใช้ควรได้เห็นเหตุผลแล้วกรอกรหัสเอง
 *
 * ⚠️ ห้ามดูแค่ว่า "มี logoutReason ค้างอยู่ไหม" — ค่านั้นถูกล้างตอนล็อกอินสำเร็จ
 * เท่านั้น เบราว์เซอร์ที่เคยหมดเวลาสักครั้งจึงติดธงนี้ค้างข้ามวัน แล้ว silent SSO
 * จะไม่ทำงานอีกเลยจนกว่าจะกรอกรหัสด้วยมือ (อาการ "บางเครื่องเข้าเอง บางเครื่องไม่เข้า")
 *
 * ไม่มี logoutAt = ข้อมูลจากเวอร์ชันก่อนหน้า → ถือว่าเก่าแล้ว
 */
export function wasRecentlyLoggedOut(withinMs = IDLE_TIMEOUT_MS) {
  if (!localStorage.getItem(LOGOUT_REASON_KEY)) return false;
  const at = Number(localStorage.getItem(LOGOUT_AT_KEY));
  if (!Number.isFinite(at) || at <= 0) return false;
  return Date.now() - at < withinMs;
}

// อ่านเฉย ๆ ไม่ลบ — คนที่ล้างคือ setLogoutReason() ตอนจบ session รอบถัดไป
// และตอน login สำเร็จ จึงอ่านตอน render ได้โดยค่าไม่กระโดดระหว่างรีเรนเดอร์
export function getLogoutReason() {
  return localStorage.getItem(LOGOUT_REASON_KEY);
}

// ─── เขียน/ล้าง session ใน localStorage ──────────────────────────────────────
// จุดเดียวที่รู้รูปร่างของ session ที่เก็บไว้ — AuthContext (ผ่าน React state)
// และตัวตรวจตัวตนสด (ที่โหลดหน้าใหม่ทันทีจึงไม่ผ่าน React) ใช้ตัวเดียวกัน
// ไม่งั้นจะมีที่ที่ลืม markActivity หรือลืมล้าง logoutReason แล้วอาการไปโผล่ที่อื่น

export function saveSession(user, token) {
  setLogoutReason(null); // ล็อกอินใหม่แล้ว — ข้อความ "หมดเวลา" รอบก่อนไม่ต้องค้าง
  localStorage.removeItem(BOUNCED_AT_KEY); // เข้าได้แล้ว = ไม่ได้อยู่ในลูป ปลดธงกันลูป
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(TOKEN_KEY, token);
  markActivity({ force: true }); // เริ่มจับเวลา idle ตั้งแต่วินาทีที่ล็อกอิน
  // คำยืนยันของ session ก่อนหน้าใช้กับคนใหม่ไม่ได้ — ล็อกอินด้วยรหัสผ่าน (ไม่มี session
  // ฝั่งแพลตฟอร์มให้ยืนยันเลย) จะได้ไม่ยืมเข็มที่ค้างไว้จากผู้ใช้ SSO คนก่อน
  clearPlatformActivity();
}

export function clearStoredSession(reason) {
  setLogoutReason(reason);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearActivity();
}

// ─── ปลายทางเมื่อ session จบ ─────────────────────────────────────────────────
//
// นโยบาย: **จบยังไงก็กลับไปเข้าระบบที่ SchoolOS** — GradTrack ไม่ใช่ประตูหน้าของตัวเอง
// ทางเข้าปกติคือล็อกอินที่ SchoolOS แล้วเดินเข้ามา ดังนั้นคนที่หลุด (หมดเวลา / token
// หมดอายุ / 401 / SchoolOS ออกไปแล้ว) และคนที่เปิด /grad ตรง ๆ โดยไม่มี session
// ก็ควรไปจบที่เดียวกัน ไม่ใช่ค้างอยู่ที่ฟอร์มของเรา
//
// แลกมาด้วยการที่ข้อความ TIMEOUT_NOTICES ไม่ถูกเห็นในกรณีที่เด้งออกไป — ยอมรับได้
// เพราะปลายทางคือหน้าล็อกอินที่ผู้ใช้คุ้นอยู่แล้ว ไม่ใช่หน้าที่ทำให้งงว่าหลงมาได้ยังไง

/**
 * ที่อยู่ SchoolOS ในสายตาเบราว์เซอร์ · "/" = โดเมนเดียวกัน (prod อยู่ใต้
 * schoolos.sukhon.ac.th/grad อยู่แล้ว "/" จึงเป็น schoolos.sukhon.ac.th พอดี)
 *
 * อ่านจากค่าที่ utils/sso.js cache ไว้ให้ ไม่ได้ hardcode โดเมน — ย้ายโดเมนเมื่อไหร่
 * ก็ยังแก้ที่ SCHOOLOS_PORTAL_URL ฝั่ง server ที่เดียวเหมือนเดิม
 */
export function schoolosHome() {
  const cached = (localStorage.getItem(SCHOOLOS_HOME_KEY) || '').trim();
  return cached || '/';
}

/**
 * เหตุผลที่ต้องจบที่ฟอร์มของเราเอง ห้ามเด้งไป SchoolOS
 *
 * SSO_DENIED = "ล็อกอิน SchoolOS อยู่จริง แต่บัญชีนี้ไม่มีสิทธิ์ใช้ GradTrack"
 * (ลาออก / จบไปนานแล้ว / ไม่อยู่ในรายชื่อครู) — คนกลุ่มนี้ session ฝั่งโน้นยังดีอยู่
 * ส่งกลับไปก็เท่ากับส่งกลับไปหาสิ่งที่เขามีอยู่แล้ว แล้วเขาก็เดินกลับเข้ามาโดนปฏิเสธซ้ำ
 * โดยไม่มีใครบอกสักครั้งว่าเพราะอะไร
 */
const STAY_ON_LOGIN_REASONS = [LOGOUT_REASONS.SSO_DENIED];

/** พาออกไป SchoolOS · ไม่แตะ session ฝั่งโน้น (คนละเรื่องกับปุ่ม "ออกจากระบบ") */
export function leaveToSchoolOS() {
  localStorage.setItem(BOUNCED_AT_KEY, String(Date.now()));
  window.location.assign(schoolosHome());
}

/**
 * เพิ่งถูกเด้งไป SchoolOS มาแล้วหรือเปล่า — **ตัวกันลูป ห้ามถอดออก**
 *
 * ลูปที่กันไว้: คนที่ไม่มี session ฝั่ง SchoolOS ให้ใช้ — บัญชี admin local ซึ่งเป็น
 * ทางเข้าสำรองตอน SchoolOS ล่ม · ครู/นักเรียนที่กรอกรหัสเอง · ตอน dev ที่ยังไม่ได้
 * ชี้ base มาที่ Users จริง · ถ้าเด้งทุกครั้งที่ไม่มี session พวกเขาจะเดินวนอยู่ระหว่าง
 * สองเว็บโดยไม่มีทางเห็นฟอร์มเลยสักครั้ง
 *
 * ธงถูกล้างตอนล็อกอินสำเร็จ (saveSession) — นับต่อเนื่องเฉพาะช่วงที่ยังเข้าไม่ได้จริง ๆ
 * คนที่เข้าออกตามปกติจึงไม่มีวันสะสมจนโดนกัน
 */
export function bouncedToSchoolOSRecently() {
  const at = Number(localStorage.getItem(BOUNCED_AT_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < BOUNCE_COOLDOWN_MS;
}

/**
 * จบ session แล้วพาออกไป — ปลายทางคือ SchoolOS เสมอ ยกเว้น STAY_ON_LOGIN_REASONS
 *
 * โหลดหน้าใหม่ทั้งหน้าเสมอ ห้ามใช้ router — หน้าที่ค้างอยู่ถูก render ไว้ให้คนเก่า
 * การ navigate ฝั่ง client จะ re-render จาก cache ก้อนเดิม ซึ่งบนเครื่องส่วนกลาง
 * แปลว่าคนถัดไปอาจเห็นข้อมูลของคนก่อนหน้าค้างอยู่
 */
export function bounceAfterSessionEnd(reason) {
  clearStoredSession(reason);

  if (!STAY_ON_LOGIN_REASONS.includes(reason)) {
    leaveToSchoolOS();
    return;
  }

  const target = withBase('/login');
  // อยู่หน้า login อยู่แล้ว → reload เพื่อให้ข้อความเหตุผลรอบนี้ถูกอ่านใหม่
  // (assign ไป path เดิมบางเบราว์เซอร์ไม่โหลดหน้าใหม่ให้)
  if (window.location.pathname === target) window.location.reload();
  else window.location.assign(target);
}

// ─── สะพานระหว่าง axios interceptor กับ AuthContext ──────────────────────────
// interceptor อยู่นอก React จึงเรียก logout() ของ context ตรง ๆ ไม่ได้
// AuthContext ฝากฟังก์ชันไว้ตอน mount แล้ว interceptor เรียกผ่านตัวนี้

let sessionExpiredHandler = null;

export function setSessionExpiredHandler(fn) {
  sessionExpiredHandler = fn;
}

export function notifySessionExpired(reason = LOGOUT_REASONS.EXPIRED) {
  if (sessionExpiredHandler) {
    sessionExpiredHandler(reason);
    return;
  }
  // ยังไม่มี AuthContext (เช่นหน้า print ที่อยู่นอกโครงแอป) → เคลียร์เองแบบดิบ ๆ
  clearStoredSession(reason);
}
