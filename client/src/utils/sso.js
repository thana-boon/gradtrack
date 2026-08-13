// ─── Silent SSO — เข้าระบบต่อจาก SchoolOS โดยไม่ต้องกรอกรหัสซ้ำ ───────────────
//
// ลำดับที่หน้า login ทำตอนเปิด:
//   1. ถามค่าคอนฟิกจาก server ของเรา (ที่อยู่ SchoolOS + ชื่อ audience)
//   2. ขอ "โค้ดใช้ครั้งเดียว" จาก SchoolOS ด้วย cookie ของผู้ใช้เอง
//      · ยังไม่ได้ล็อกอิน → ตอบ 200 พร้อม valid:false (ไม่ใช่ error) → แสดงฟอร์มตามปกติ
//   3. ส่งโค้ดให้ server ของเราไปแลกเป็นตัวตนด้วย API key แล้วออก token ของ GradTrack
//
// กติกาที่ห้ามพลาด:
//   · โค้ดคือ credential ชั่วคราว — ห้ามเก็บลง localStorage / ห้ามใส่ใน URL / ห้าม log
//   · ใช้ได้ครั้งเดียว ยิงซ้ำด้วยโค้ดเดิมจะได้ used_code → ต้องขอใหม่เสมอ
//   · ล้มเหลวเมื่อไหร่ก็แค่ "แสดงหน้า login ตามปกติ" ห้ามทำให้หน้าเว็บค้างหรือพัง
import api from './api';
import { SCHOOLOS_HOME_KEY, markSilentLogin } from './session';

// เพดานรอคำตอบจาก SchoolOS — เกินกว่านี้ให้ไปแสดงฟอร์มเลย ดีกว่าปล่อยจอค้าง
const PROBE_TIMEOUT_MS = 6000;

// ─── ปิด silent SSO ชั่วคราว ─────────────────────────────────────────────────
// ใช้ตอนกด "ออกจากระบบ": คำขอ logout ไปที่ SchoolOS เป็น async แต่หน้า login
// ถูก render ทันที ถ้าไม่กันไว้ probe อาจวิ่งชนะแล้วดึงผู้ใช้กลับเข้าระบบเอง
//
// ตั้งเวลาสั้น ๆ พอกันจังหวะนั้น ไม่ได้ปิดถาวร — พอ session ของ SchoolOS ถูกลบจริง
// probe ก็จะได้ valid:false เองอยู่แล้ว และถ้าผู้ใช้ไปล็อกอิน SchoolOS ใหม่
// ก็ควรกลับมาเข้า GradTrack ได้เลยโดยไม่ต้องรอ
const BLOCK_KEY = 'ssoBlockUntil';
const BLOCK_MS = 30 * 1000;

export function blockSilentLogin(ms = BLOCK_MS) {
  localStorage.setItem(BLOCK_KEY, String(Date.now() + ms));
}

export function clearSilentLoginBlock() {
  localStorage.removeItem(BLOCK_KEY);
}

export function isSilentLoginBlocked() {
  const until = Number(localStorage.getItem(BLOCK_KEY));
  return Number.isFinite(until) && until > 0 && Date.now() < until;
}

// ─── คอนฟิก (จาก server ของเรา) ──────────────────────────────────────────────
// อ่านครั้งเดียวต่อการโหลดหน้า — ค่าไม่เปลี่ยนระหว่างใช้งาน
let configPromise = null;

function loadConfig() {
  if (!configPromise) {
    configPromise = api
      .get('/auth/sso/config')
      .then((res) => {
        // เก็บที่อยู่ SchoolOS ไว้ให้ utils/session.js อ่านแบบ sync — ตอน session จบ
        // เราต้องเด้งออกไปทันทีจากที่ที่รอ await ไม่ได้ (axios interceptor)
        // ค่านี้ไม่ใช่ความลับ และเปลี่ยนเมื่อไหร่ก็ถูกทับตอนโหลดหน้าถัดไปเอง
        if (res.data?.portalUrl) localStorage.setItem(SCHOOLOS_HOME_KEY, res.data.portalUrl);
        return res.data;
      })
      // server ตอบไม่ได้ = ถือว่าไม่มี SSO ไปหน้า login ปกติ
      .catch(() => ({ enabled: false }));
  }
  return configPromise;
}

/** ต่อ base ของ SchoolOS เข้ากับ path — base เป็น path ล้วน ("/users") หรือ URL เต็มก็ได้ */
const usersUrl = (base, path) => `${base || ''}${path}`;

/**
 * ขอโค้ด handoff — คืน null เมื่อ "ยังไม่ได้ล็อกอิน SchoolOS" หรือขอไม่สำเร็จ
 * ทั้งสองกรณีจบเหมือนกันคือให้ผู้ใช้กรอกรหัสเอง จึงไม่ต้องแยก
 */
async function getHandoffCode({ usersBase, audience }) {
  try {
    const res = await fetch(
      usersUrl(usersBase, `/api/auth/handoff?audience=${encodeURIComponent(audience)}`),
      {
        credentials: 'include', // ขาดบรรทัดนี้ = ได้ valid:false ตลอด (cookie ไม่ถูกส่ง)
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    );
    if (!res.ok) return null; // 400/403/429 = ตั้งค่าไม่ครบหรือขอถี่ไป → ไปหน้า login
    const data = await res.json();
    return data?.valid ? data.code : null;
  } catch {
    // ต่อไม่ได้ / หมดเวลา / ตอบไม่ใช่ JSON (เช่นตอน dev ที่ยังไม่ได้ชี้ base มาที่ SchoolOS)
    return null;
  }
}

/**
 * ถาม SchoolOS สด ๆ ว่า "ตอนนี้เบราว์เซอร์นี้เป็นใคร"
 *
 * หัวใจของการกันเคส "ล็อกอินคนใหม่ที่ portal แล้วระบบยังโหลดคนเก่า": session ของเรา
 * กับของ SchoolOS เป็นคนละใบ handoff แค่ "คัดลอกตัวตน" มาตอนหนึ่งเท่านั้น ไม่ได้ผูก
 * สองใบเข้าด้วยกัน การผูกจึงเป็นสิ่งที่เราต้องถามซ้ำเอง
 *
 * @returns { valid, sub, code } · null = **ถามไม่ได้** (เน็ต/CORS/service ล่ม/SSO ปิด)
 *
 * ⚠️ null ห้ามตีความว่า "ไม่มีใครล็อกอิน" เด็ดขาด — ถ้าเหมารวมกัน เน็ตกระตุกทีเดียว
 * จะเตะทั้งโรงเรียนออกจากระบบพร้อมกัน ผู้เรียกต้องไม่ทำอะไรเลยเมื่อได้ null
 * "ไม่มีใครล็อกอิน" คือ HTTP 200 พร้อม valid:false ซึ่งต้องอ่านจาก field ไม่ใช่ status
 *
 * endpoint นี้เป็น cookie-based ล้วน (ห้ามยิงจาก server ด้วย X-API-Key เพราะ cookie
 * sso_session เป็น httpOnly อยู่ที่เบราว์เซอร์เท่านั้น) · ตอบจาก claim ใน token ไม่แตะ
 * ฐานข้อมูล และ **ไม่** ต่ออายุ idle window ของ SchoolOS จึงยิงบ่อยได้โดยไม่มีผลข้างเคียง
 */
export async function fetchLiveSession() {
  const config = await loadConfig();
  if (!config?.enabled) return null;

  try {
    const res = await fetch(usersUrl(config.usersBase, '/api/auth/session'), {
      credentials: 'include', // ขาดบรรทัดนี้ = ได้ valid:false ตลอดโดยไม่มี error ให้เห็น
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    return {
      valid: Boolean(data?.valid && data.user),
      sub: data?.user?.sub ?? null,
      code: data?.user?.code ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * ลองเข้าระบบเงียบ ๆ
 * @returns { token, user } เมื่อสำเร็จ · null เมื่อยังไม่ได้ล็อกอิน SchoolOS หรือ SSO ปิดอยู่
 * @throws  error ของ axios เมื่อ server ปฏิเสธแบบมีเหตุผล (403 = ไม่มีสิทธิ์เข้าระบบนี้)
 */
export async function trySilentLogin() {
  const config = await loadConfig();
  if (!config?.enabled) return null;

  const code = await getHandoffCode(config);
  if (!code) return null;

  const res = await api.post('/auth/sso', { code });
  // ประทับเวลาไว้ให้ตัวจับลูป — เข้าด้วยทางนี้แล้วหลุดซ้ำภายในไม่ถึงนาที
  // แปลว่าพาเข้าไปก็หลุดอยู่ดี รอบหน้าต้องให้กรอกเอง (ดู mustLoginManually)
  if (res.data?.token) markSilentLogin();
  return res.data;
}

/**
 * ออกจาก SchoolOS แล้วไปจบที่หน้า portal — ใช้กับปุ่ม "ออกจากระบบ" **เท่านั้น**
 *
 * ⚠️ ห้ามใช้กับ session ที่จบเอง (หมดเวลา / token หมดอายุ / 401) — พวกนั้นก็ออกไปที่
 * SchoolOS เหมือนกัน แต่ต้องไปด้วย leaveToSchoolOS() ใน utils/session.js ซึ่ง
 * **ไม่** เรียก /api/auth/logout · ต่างกันตรงนี้: หมดเวลาใน GradTrack ไม่ควรไปเตะ
 * ครูออกจาก SchoolOS ทั้งแพลตฟอร์มด้วย เขาอาจกำลังทำงานในระบบอื่นอยู่แท้ ๆ
 * และตัวนั้นมีธงกันลูปคุมอยู่ (bouncedToSchoolOSRecently) ตัวนี้ไม่มี
 *
 * ออกจาก SchoolOS ด้วยการ navigate ไป /api/auth/logout?next= ครั้งเดียว เชื่อถือได้กว่า
 * ยิง POST ทิ้งไว้แล้วรีบเปลี่ยนหน้า ซึ่งเบราว์เซอร์อาจตัดทิ้งกลางคันจนออกไม่สำเร็จ
 */
export async function leaveToPortal() {
  let target = '/';
  try {
    const config = await loadConfig();
    const portal = config?.portalUrl || '/';
    target = config?.enabled
      ? usersUrl(config.usersBase, `/api/auth/logout?next=${encodeURIComponent(portal)}`)
      : portal;
  } catch {
    /* อ่านค่าไม่ได้ → กลับหน้าแรกของโดเมนนี้ ดีกว่าค้างอยู่เฉย ๆ */
  }
  window.location.assign(target);
}

/**
 * ต่ออายุ session ของ SchoolOS
 *
 * จำเป็นเพราะ SchoolOS **ไม่นับ** การใช้งานในระบบเราเป็น activity ของ session
 * (API.md §4.10 จงใจให้เป็นแบบนี้ ไม่งั้นแท็บที่เปิดค้างไว้จะทำให้ session ไม่มีวันตาย)
 * ครูที่นั่งทำงานใน GradTrack จนเกิน idle window ของ SchoolOS โดยไม่แตะหน้านั้นเลย
 * จึงหลุดจาก SchoolOS เงียบ ๆ
 * แล้วรอบหน้าที่เปิด /grad ก็ต้องกรอกรหัสใหม่ทั้งที่เพิ่งใช้งานอยู่แท้ ๆ
 *
 * เงียบเสมอ: 401 = ไม่มี session ให้ต่อ (ล็อกอินด้วยรหัสผ่านมา ไม่ได้มาทาง SSO)
 * ซึ่งเป็นเรื่องปกติ ไม่ใช่ error
 */
export async function refreshSchoolOSSession() {
  try {
    const config = await loadConfig();
    if (!config?.enabled) return;
    await fetch(usersUrl(config.usersBase, '/api/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    /* ต่อไม่ได้ก็ปล่อย — ผลอย่างมากคือต้องล็อกอิน SchoolOS ใหม่รอบหน้า */
  }
}

// การออกจากระบบที่ SchoolOS ย้ายไปทำใน leaveToPortal() ด้วยการ navigate ไป
// /api/auth/logout?next= ครั้งเดียว — เชื่อถือได้กว่ายิง POST ทิ้งไว้แล้วรีบเปลี่ยนหน้า
// ซึ่งเบราว์เซอร์ยกเลิก request กลางคันได้
