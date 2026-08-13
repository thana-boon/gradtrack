// ─── ตัวตรวจตัวตนสด — "ตอนนี้เบราว์เซอร์นี้เป็นใคร" ──────────────────────────
//
// ปัญหาที่ตัวนี้แก้: GradTrack แลก SSO handoff แค่ครั้งเดียวตอนเข้าระบบ แล้วออก
// token ของตัวเองซึ่งเชื่อไปจนหมดอายุ พอมีคนล็อกอินใหม่ที่ portal ของ SchoolOS
// token ใบเดิมก็ยัง valid และยังชี้ไปที่คนเก่าอยู่ดี — บนเครื่องส่วนกลางแปลว่า
// คนใหม่เห็นข้อมูล/สิทธิ์ของคนเก่า และ hard refresh ก็ไม่ช่วย
//
// การลดอายุ token ช่วยให้ "ผิดสั้นลง" ไม่ได้ทำให้ "ไม่ผิด" — ต้องถามตัวตนสด
//
// ทำงานตอน: mount (= ทุกครั้งที่โหลดหน้า) · กลับมาที่แท็บ · และทุก ๆ CHECK_INTERVAL_MS
// ระหว่างที่แท็บเปิดค้างอยู่ (คนเปลี่ยนบัญชีในอีกแท็บ แท็บนี้ต้องรู้เองด้วย)
//
// ⚠️ ใช้กับ session ที่มาจาก SSO เท่านั้น — บัญชี local และคนที่กรอกรหัสผ่านเอง
// ไม่มี session ฝั่งแพลตฟอร์มให้เทียบ ถ้าเอามาใช้ด้วยจะเตะพวกเขาออกจากระบบตัวเอง
// และวันที่ SchoolOS ล่ม ทางเข้าสำรองจะล่มตามไปด้วย ซึ่งเป็นวันที่ต้องการมันที่สุด
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { withBase } from '../utils/withBase';
import {
  LOGOUT_REASONS,
  bounceAfterSessionEnd,
  getTokenClaims,
  markPlatformActivity,
  saveSession,
} from '../utils/session';
import { clearSilentLoginBlock, fetchLiveSession, trySilentLogin } from '../utils/sso';

// ถามซ้ำระหว่างแท็บเปิดค้างไว้ — endpoint นี้ตอบจาก claim ใน token ไม่แตะฐานข้อมูล
// และไม่ต่ออายุ idle window ของ SchoolOS จึงยิงถี่ระดับนี้ได้โดยไม่มีผลข้างเคียง
const CHECK_INTERVAL_MS = 60 * 1000;

// กันยิงรัวตอนสลับแท็บถี่ ๆ (visibilitychange + focus มาพร้อมกันได้ด้วย)
const MIN_GAP_MS = 10 * 1000;

// ─── กันลูป ─────────────────────────────────────────────────────────────────
// การสลับคนจบด้วยการโหลดหน้าใหม่ ซึ่ง mount ตัวนี้ขึ้นมาอีกรอบ ถ้ารอบใหม่ยังไม่ตรงอีก
// ก็จะสลับซ้ำวนไม่รู้จบ · เคสนี้เกิดจริงตอน deploy: token ที่ออกก่อนแพตช์ยังไม่มี ssoSub
// เก็บใน sessionStorage เพราะต้องรอดข้ามการโหลดหน้า แต่ไม่ควรข้ามไปแท็บอื่น
const SWITCH_KEY = 'ssoSwitchedAt';
const SWITCH_COOLDOWN_MS = 30 * 1000;

const switchedRecently = () => {
  const at = Number(sessionStorage.getItem(SWITCH_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < SWITCH_COOLDOWN_MS;
};

// ปลายทางเลือกตาม role ของ **คนใหม่** เสมอ — พาไปหน้าเดิมของคนเก่าไม่ได้ เพราะคนใหม่
// อาจไม่มีสิทธิ์เปิดหน้านั้น (และถ้าเป็นนักเรียนก็คนละโครงหน้าไปเลย)
const homeFor = (user) => withBase(user?.role === 'student' ? '/student' : '/dashboard');

export default function SessionGuard() {
  const { token } = useAuth();
  const [switching, setSwitching] = useState(false);

  // ออกจากหน้านี้ไปแล้ว (window.location.assign ถูกสั่งแล้ว) — ห้ามตรวจซ้ำระหว่างรอ
  const leaving = useRef(false);
  const busy = useRef(false);
  const lastCheck = useRef(0);

  const { via, ssoSub } = getTokenClaims(token);
  const watching = Boolean(token) && via === 'sso' && Boolean(ssoSub);

  useEffect(() => {
    if (!watching) return;

    /**
     * ล้าง session ของเราแล้วออกจากหน้านี้แบบโหลดใหม่ทั้งหน้า (ดู utils/session.js)
     *
     * ปลายทางแล้วแต่เหตุผล: SSO_ENDED → กลับไปเข้าระบบที่ SchoolOS ·
     * SSO_DENIED → ฟอร์มของเราพร้อมข้อความ เพราะเขาล็อกอิน SchoolOS อยู่แล้ว
     * ส่งกลับไปก็ไม่ได้แก้อะไร
     */
    const leaveToLogin = (reason) => {
      leaving.current = true;
      bounceAfterSessionEnd(reason);
    };

    const check = async () => {
      if (leaving.current || busy.current) return;
      if (Date.now() - lastCheck.current < MIN_GAP_MS) return;

      busy.current = true;
      lastCheck.current = Date.now();
      try {
        const live = await fetchLiveSession();

        // ถามไม่ได้ ≠ ไม่มีใครล็อกอิน — เน็ตกระตุก/SchoolOS ล่ม ห้ามทำอะไรทั้งนั้น
        if (!live) return;

        // คนเดิม — sub กับ code เทียบได้ทั้งคู่ เผื่อ SchoolOS ส่งรหัสมาคนละฟิลด์
        if (live.valid && (live.sub === ssoSub || live.code === ssoSub)) {
          // คำถามนี้ถูกถามอยู่แล้วทุก 60 วิ — บอกนาฬิกา idle ไปด้วยเลยว่ายังมี session
          // ของคนเดิมอยู่จริง เพื่อไม่ให้เตะคนที่กำลังทำงานในระบบอื่นของ SchoolOS อยู่
          // (ดู isIdleExpired ใน utils/session.js) · ไม่ได้ต่ออายุ idle window ของ
          // SchoolOS จึงไม่เกิดวงจรที่ทำให้ session ทั้งสองใบไม่มีวันหมดอายุ
          markPlatformActivity();
          // ผ่านแล้ว = ไม่ได้อยู่ในลูป ปลดธงกันลูปทิ้ง ไม่งั้นการสลับคนครั้งถัดไป
          // ภายใน 30 วิ (เครื่องส่วนกลางที่คนต่อคิวกัน) จะถูกกันไปหน้า login เปล่า ๆ
          sessionStorage.removeItem(SWITCH_KEY);
          return;
        }

        // ── ถึงตรงนี้ = ตัวตนไม่ตรงกับตอนที่รับช่วงมาแล้ว ────────────────────
        if (!live.valid) {
          // ออกจาก SchoolOS ไปแล้ว → session ของเราหมดความชอบธรรมตามไปด้วย
          leaveToLogin(LOGOUT_REASONS.SSO_ENDED);
          return;
        }

        // เป็นคนใหม่ — เขาล็อกอิน SchoolOS อยู่แล้ว จึงแลก handoff ใหม่ให้เงียบ ๆ
        // ได้เลย ไม่ต้องให้พิมพ์อะไร
        if (switchedRecently()) {
          // เพิ่งสลับไปแล้วแต่ยังไม่ตรงอีก = กำลังจะวน ตัดจบที่หน้า login
          leaveToLogin(LOGOUT_REASONS.SSO_ENDED);
          return;
        }

        leaving.current = true;
        setSwitching(true); // คลุมหน้าของคนเก่าไว้ กันกดโดนระหว่างสลับ
        sessionStorage.setItem(SWITCH_KEY, String(Date.now()));

        let data = null;
        try {
          data = await trySilentLogin();
        } catch (err) {
          // 403 = คนใหม่ล็อกอิน SchoolOS ได้จริง แต่ไม่มีสิทธิ์ในระบบนี้ (ลาออก /
          // จบไปนานแล้ว / ไม่อยู่ในรายชื่อ) — เหตุผลนี้ต้องบอก ไม่งั้นเขาจะกรอกรหัสซ้ำ
          // อยู่นั่นแล้วงงว่าทำไมไม่เข้า · error อื่น (โค้ดหมดอายุ/429/ระบบสะดุด)
          // ไม่ได้แปลว่าไม่มีสิทธิ์ จึงใช้ข้อความกลาง ๆ แทน
          leaveToLogin(
            err?.response?.status === 403 ? LOGOUT_REASONS.SSO_DENIED : LOGOUT_REASONS.SSO_ENDED
          );
          return;
        }

        if (data?.token) {
          clearSilentLoginBlock();
          saveSession(data.user, data.token);
          window.location.assign(homeFor(data.user));
          return;
        }

        // ขอโค้ดไม่สำเร็จ (ขอถี่เกิน/จังหวะไม่ดี) — ปล่อยหน้าของคนเก่าค้างไว้ให้คนใหม่
        // ไม่ได้ เพราะรู้แน่แล้วว่าคนหน้าเครื่องเปลี่ยนไปแล้ว จึงพากลับหน้า login
        leaveToLogin(LOGOUT_REASONS.SSO_ENDED);
      } finally {
        busy.current = false;
      }
    };

    check();

    const onWake = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    const timer = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      clearInterval(timer);
    };
  }, [watching, ssoSub]);

  if (!switching) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-base-100/95 backdrop-blur-sm"
    >
      <span className="loading loading-spinner loading-lg text-primary" />
      <p className="text-sm text-base-content/60">กำลังสลับไปยังบัญชีที่เข้าสู่ระบบ SchoolOS อยู่…</p>
    </div>
  );
}
