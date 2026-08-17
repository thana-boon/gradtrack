import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import Icon from '../components/ui/Icon';
import {
  IDLE_TIMEOUT_MINUTES,
  LOGOUT_REASONS,
  bouncedToSchoolOSRecently,
  getLogoutReason,
  markBouncedToSchoolOS,
  mustLoginManually,
  wasRecentlyLoggedOut,
} from '../utils/session';
import { isSilentLoginBlocked, portalTarget, trySilentLogin } from '../utils/sso';

// เว้นระยะระหว่างการลอง SSO ซ้ำตอนกลับมาที่แท็บ — สลับแท็บไปมาเป็นสิบครั้งต่อนาที
// เป็นเรื่องปกติ แต่ฝั่ง SchoolOS จำกัดการขอโค้ดไว้ 10 ครั้ง/นาที/session
const SSO_RETRY_GAP_MS = 15 * 1000;

// ค้างหน้าจอ "กำลังพาไป SchoolOS" ไว้เท่านี้ก่อนเปลี่ยนหน้าจริง — พอให้อ่านทันว่า
// กำลังจะไปไหนและทำไม (และกดลิงก์อยู่ต่อได้) โดยไม่รู้สึกว่าเว็บค้าง
const LEAVE_AFTER_MS = 2500;

// ข้อความตอนพาออกไปเข้าระบบที่ SchoolOS — คนที่มาถึงตรงนี้ส่วนใหญ่คือคนที่ยังไม่ได้
// ล็อกอิน ไม่ใช่คนที่ทำอะไรผิด ข้อความจึงต้องเป็นการบอกทาง ไม่ใช่การฟ้องความผิดพลาด
const LEAVING_NOTICE = {
  title: 'ยังไม่ได้เข้าสู่ระบบ SchoolOS',
  body: 'GradTrack ใช้บัญชีเดียวกับ SchoolOS กำลังพาไปหน้าเข้าสู่ระบบของ SchoolOS ก่อน แล้วกลับเข้ามาที่ GradTrack ได้เลย…',
};

// ข้อความตอนถูกเตะออก — ต้องบอกให้ชัดว่าไม่ได้ล็อกอินหลุดเพราะระบบพัง
const TIMEOUT_NOTICES = {
  [LOGOUT_REASONS.IDLE]: `ไม่ได้ใช้งานนานเกิน ${IDLE_TIMEOUT_MINUTES} นาที ระบบออกจากระบบให้อัตโนมัติ กรุณาเข้าสู่ระบบใหม่`,
  [LOGOUT_REASONS.EXPIRED]: 'เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่',
  [LOGOUT_REASONS.SSO_ENDED]: 'บัญชี SchoolOS ที่ใช้อยู่ออกจากระบบไปแล้ว กรุณาเข้าสู่ระบบใหม่',
  [LOGOUT_REASONS.SSO_DENIED]:
    'บัญชี SchoolOS ที่เข้าสู่ระบบอยู่ตอนนี้ไม่มีสิทธิ์ใช้ GradTrack กรุณาเข้าสู่ระบบด้วยบัญชีอื่น',
};

/**
 * ต้องกรอกรหัสเองรอบนี้ไหม (= ข้าม silent SSO)
 *
 * ข้ามเมื่อ:
 *   · เพิ่งกดออกจากระบบ (ดู blockSilentLogin ใน utils/sso.js)
 *   · SSO เพิ่งพาเข้าไปแล้วหลุดกลับมาทันที = วนเป็นวงอยู่จริง (ดู mustLoginManually)
 *
 * แต่ **ไม่** ข้ามเมื่อ:
 *   · token หมดอายุคาไว้เฉย ๆ — คนที่ไม่ได้เปิดระบบข้ามวันแล้วล็อกอิน SchoolOS ใหม่
 *     เดินเข้ามาเจอ EXPIRED ตั้งแต่ยังไม่ทันยิง request แรก เขาควรถูกพาเข้าเลย
 *     ไม่ใช่เจอฟอร์มเปล่ากับข้อความ "เซสชันหมดอายุ" ทั้งที่เพิ่งล็อกอินมาหมาด ๆ
 *   · หลุดเพราะตัวตนฝั่ง SchoolOS เปลี่ยน (SSO_ENDED/SSO_DENIED) — มีคนใหม่อยู่หน้าเครื่อง
 *     การบังคับให้เขากรอกรหัสเองไม่ได้เพิ่มความปลอดภัยอะไร มีแต่ทำให้เครื่องส่วนกลางใช้ยากขึ้น
 *   · หลุดเพราะ idle — ตัวคัดกรองจริงคือ SchoolOS เอง: ขอโค้ด handoff ได้ก็ต่อเมื่อ
 *     session ของแพลตฟอร์มยังอยู่ = ผู้ใช้ยังทำงานอยู่ในระบบอื่นด้วย session เดียวกัน
 *     (เคสที่แท็บนี้ถูกปิด/รีโหลดไป จนไม่มีใครคอยยืนยันให้นาฬิกา idle — ดู isIdleExpired)
 *     ลุกจากเครื่องไปจริง session ฝั่งโน้นก็หมดตามไปด้วย → ได้ฟอร์มพร้อมข้อความตามเดิม
 */
const shouldSkipSso = () => isSilentLoginBlocked() || mustLoginManually();

// ─── ทางเข้าสำรอง: /grad/login?local=1 ───────────────────────────────────────
// บังคับให้เห็นฟอร์ม ไม่เด้งไป SchoolOS ไม่ว่ากรณีใด — สำหรับบัญชี admin local
// ที่ต้องใช้ในวันที่ SchoolOS ล่ม (ซึ่งเป็นวันที่การเด้งไป SchoolOS ช่วยอะไรไม่ได้เลย)
// silent SSO ยังทำงานตามปกติ ใครล็อกอินอยู่ก็ยังเข้าได้เองเหมือนเดิม
const wantsLocalForm = () => new URLSearchParams(window.location.search).has('local');

/**
 * เข้าเงียบ ๆ ไม่ได้ → ต้องพาไปเข้าระบบที่ SchoolOS ไหม · คืนที่อยู่ปลายทาง หรือ null
 * เมื่อฟอร์มนี้คือทางเข้าเดียวที่เหลือ
 *
 * ทางเข้าปกติของ GradTrack คือล็อกอินที่ SchoolOS แล้วเดินเข้ามา ฟอร์มนี้จึงไม่ใช่
 * ประตูหน้า — คนที่มาถึงตรงนี้โดยไม่มี session คือคนที่ยังไม่ได้ล็อกอิน และรหัสผ่าน
 * ของครูกับนักเรียนอยู่ที่ SchoolOS ไม่ใช่ที่นี่ ฟอร์มนี้จึงช่วยเขาไม่ได้เลยสักคน
 *
 * เงื่อนไขคือ "ขอโค้ด handoff ไม่ได้" ล้วน ๆ (trySilentLogin คืน null) ครอบทุกเหตุผล
 * ไม่ใช่แค่ตอนที่ยืนยันได้ว่าไม่มีใครล็อกอิน — เดิมตรงนี้ยืนกรานให้
 * GET /api/auth/session ตอบ valid:false ก่อนถึงจะยอมพาออกไป ผลคือทุกกรณีที่
 * "ถามไม่ได้" (Users ตอบช้า · CORS · โดน 429 ตอนคนเปิดพร้อมกันทั้งห้อง · dev ที่ยัง
 * ไม่ได้ชี้ base มาที่ Users) ไปจบที่ฟอร์มซึ่งใช้อะไรไม่ได้ — ซึ่งเป็นอาการที่ตั้งใจแก้
 * ตั้งแต่แรก
 *
 * ที่ทำให้ยอมพาออกไปกว้างขนาดนี้ได้อย่างปลอดภัย คือทางถอยสองอย่างที่มองเห็นด้วยตา
 * ไม่ใช่เงื่อนไขที่ซ่อนอยู่ในโค้ด: หน้าจอบอกก่อนพาไปพร้อมลิงก์ "เข้าสู่ระบบที่หน้านี้แทน"
 * และเด้งได้รอบเดียวต่อ BOUNCE_COOLDOWN — วันที่ SchoolOS ล่มทั้งระบบ บัญชี admin
 * local จึงยังเข้าได้ ซึ่งเป็นวันที่ต้องการมันที่สุด
 *
 * ⚠️ ตัวนี้ **ไม่**ผูกกับ shouldSkipSso() — "ไม่พา SSO เข้าให้อัตโนมัติ" กับ "ปล่อยให้
 * ยืนอยู่ที่ฟอร์มได้" เป็นคนละเรื่องกัน คนที่ติดตัวจับลูปอยู่ก็ยังต้องไปเข้าระบบที่ SchoolOS
 * เหมือนกัน แค่ตอนกลับเข้ามาต้องผ่านมือ ไม่ใช่ถูกพาเข้าเงียบ ๆ (ดู mustLoginManually)
 *
 * ห้ามพาออกไปสามกรณี:
 *   · เพิ่งกดออกจากระบบ (isSilentLoginBlocked) — ตอนนั้น leaveToPortal() กำลังพาไป
 *     /users/api/auth/logout อยู่ ถ้าชิงเด้งไป portal ตัดหน้า จะกลายเป็นไม่ได้ออกจาก
 *     SchoolOS จริง แล้วรอบหน้า SSO ก็พากลับเข้ามาเอง = ล็อกเอาต์ไม่ได้บนเครื่องส่วนกลาง
 *   · เพิ่งเด้งไป/เพิ่งเลือกที่จะอยู่ต่อ (bouncedToSchoolOSRecently) — ตัวกันเดินวน
 *   · ขอฟอร์มมาเอง (?local=1)
 */
const schoolosTarget = async () => {
  if (wantsLocalForm() || isSilentLoginBlocked() || bouncedToSchoolOSRecently()) return null;
  return portalTarget();
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // เหตุผลที่หลุด ถูก AuthContext เก็บไว้ตอนเคลียร์ session — อ่านตรงนี้เพื่อบอกผู้ใช้
  // ว่าไม่ได้เด้งออกเพราะระบบพัง (ค่าถูกล้างตอนล็อกอินสำเร็จ/กดออกเอง ไม่ใช่ตอนอ่าน)
  // เตือนเฉพาะตอนที่เพิ่งโดนเตะจริง ๆ — ค้างข้ามวันแล้วยังขึ้น "หมดเวลาใช้งาน"
  // ให้คนที่เพิ่งเปิดเว็บมาเฉย ๆ คือข้อความที่ผิดบริบท
  // ข้อความจาก server (403) ตรงประเด็นกว่าข้อความกลาง ๆ ที่เตรียมไว้ — ขึ้นทีเดียวพอ
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const notice =
    noticeDismissed || error || !wasRecentlyLoggedOut()
      ? ''
      : TIMEOUT_NOTICES[getLogoutReason()] || '';

  // ── silent SSO: ล็อกอิน SchoolOS ไว้แล้วก็เข้าได้เลย (ดู shouldSkipSso) ──────
  const [checkingSso, setCheckingSso] = useState(() => !shouldSkipSso());
  const ssoBusy = useRef(false);    // กำลังลองอยู่ ห้ามยิงซ้อน
  const ssoLastTry = useRef(0);     // กันยิงรัวตอนสลับแท็บถี่ ๆ
  const mountAttempted = useRef(false); // ยิงรอบแรกไปแล้ว — กัน effect ที่รันซ้ำยิงซ้อน
  const mounted = useRef(true);
  // ผู้ใช้เริ่มพิมพ์/กดเข้าสู่ระบบแล้ว = ตั้งใจใช้บัญชีที่กรอกเอง ห้าม SSO แย่งพาเข้า
  const formTouched = useRef(false);

  // ── กำลังจะออกไปเข้าระบบที่ SchoolOS ─────────────────────────────────────────
  // เก็บปลายทางไว้ใน state ด้วย เพราะปุ่มบนหน้าจอต้องพาไปที่เดียวกับตัวนับถอยหลัง
  const [leavingTo, setLeavingTo] = useState('');
  // กด "เข้าสู่ระบบที่หน้านี้แทน" แล้ว = ตั้งใจใช้ฟอร์มนี้ ห้ามพาออกไปอีกในหน้านี้
  const [staying, setStaying] = useState(false);

  useEffect(() => {
    formTouched.current = staying || loading || form.username !== '' || form.password !== '';
  });

  useEffect(() => {
    mounted.current = true;

    /**
     * @param background true = ลองเงียบ ๆ โดยไม่ซ่อนฟอร์ม (ใช้ตอนกลับมาที่แท็บ)
     *                   ไม่งั้นฟอร์มจะกระพริบหายทุกครั้งที่สลับแท็บ
     */
    const attempt = async (background) => {
      if (ssoBusy.current) return;
      // ธงกันอาจหมดอายุไปแล้วตั้งแต่ตอนเปิดหน้า จึงต้องอ่านใหม่ทุกครั้ง ไม่ใช้ค่าที่คิดไว้
      //
      // ⚠️ skipSso กันแค่ "การพาเข้าเงียบ ๆ" ห้าม return ทิ้งทั้งฟังก์ชัน — ด่านเด้งกลับ
      // SchoolOS ข้างล่างต้องได้ทำงานทุกครั้งที่เปิดหน้านี้ ไม่งั้นคนที่เพิ่งโดน 401
      // จะยืนอยู่ที่ฟอร์มได้ ทั้งที่ไม่มี session ฝั่ง SchoolOS ให้ใช้
      const skipSso = shouldSkipSso();
      if (background) {
        if (skipSso) return;
        if (formTouched.current) return;
        if (Date.now() - ssoLastTry.current < SSO_RETRY_GAP_MS) return;
      }

      ssoBusy.current = true;
      ssoLastTry.current = Date.now();
      try {
        if (!skipSso) {
          const data = await trySilentLogin();
          if (mounted.current && data?.token) {
            login(data.user, data.token);
            navigate(data.user.role === 'student' ? '/student' : '/dashboard', { replace: true });
            return; // ออกจากหน้านี้แล้ว ไม่ต้องปิดสถานะกำลังตรวจสอบ
          }
        }

        // ยังไม่มี session ที่ใช้ได้ → ฟอร์มนี้ไม่ใช่ที่ที่ควรยืนอยู่ ส่งไปล็อกอินที่ SchoolOS
        //
        // ทำทั้งรอบแรกและตอนกลับมาที่แท็บ (background) — แท็บที่เปิดค้างไว้ที่ฟอร์มนี้
        // โดยไม่มี session ก็คือคนที่ยังไม่ได้เข้าระบบอยู่ดี ไม่ได้ต่างจากรอบแรกตรงไหน
        // คนที่กำลังกรอกฟอร์มอยู่จริงถูกกันไว้แล้วด้วย formTouched ข้างบน
        const target = await schoolosTarget();
        if (mounted.current && target) {
          // ประทับธงตั้งแต่ตอนตัดสินใจ ไม่ใช่ตอนเปลี่ยนหน้าจริง — refresh ระหว่างนับ
          // ถอยหลังอยู่ต้องไม่ถูกนับเป็นการตัดสินใจใหม่
          markBouncedToSchoolOS();
          setLeavingTo(target);
          return; // กำลังออกจากหน้านี้ — คงสถานะ "กำลังตรวจสอบ" ไว้ ไม่ให้ฟอร์มกะพริบ
        }
      } catch (err) {
        // 403 = ล็อกอิน SchoolOS อยู่จริงแต่ไม่มีสิทธิ์ใช้ GradTrack (ไม่อยู่ในรายชื่อ /
        // รุ่นปิดไปแล้ว) — ต้องบอกเหตุผล ไม่งั้นผู้ใช้จะกรอกรหัสซ้ำอยู่นั่นแล้วงงว่าทำไมไม่เข้า
        if (mounted.current && err.response?.status === 403) {
          setError(err.response.data?.message || 'บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้ระบบ');
        }
      } finally {
        ssoBusy.current = false;
      }
      if (mounted.current) setCheckingSso(false);
    };

    // รอบแรกตอนเปิดหน้าต้องยิงเสมอ ไม่ผูกกับ checkingSso (ซึ่งเป็นแค่ธงโชว์สปินเนอร์
    // ของ silent SSO) — คนที่ข้าม SSO ก็ยังต้องผ่านด่านเด้งกลับ SchoolOS เหมือนกัน
    if (!mountAttempted.current) {
      mountAttempted.current = true;
      attempt(false);
    }

    // กลับมาที่แท็บ/หน้าต่างนี้อีกครั้ง → ลองใหม่
    //
    // เคสจริงที่เจอ: กดออกจากระบบ → SPA พามาหน้านี้ทันทีโดยไม่ได้โหลดหน้าใหม่
    // (ตอนนั้นยังติดธงกัน 30 วินาทีอยู่) → ผู้ใช้สลับไปล็อกอิน SchoolOS อีกแท็บ
    // → กลับมาแท็บนี้ซึ่ง mount ค้างอยู่ ถ้าไม่ลองใหม่ก็จะเห็นแต่ฟอร์มไปตลอดจนกว่าจะกด F5
    const onWake = () => {
      if (document.visibilityState === 'visible') attempt(true);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [checkingSso, login, navigate]);

  // ── พาออกไป SchoolOS หลังให้อ่านข้อความทัน ──────────────────────────────────
  //
  // หน่วงไว้ ไม่ได้เปลี่ยนหน้าทันทีที่รู้ผล เพราะการถูกโยนไปอีกเว็บโดยไม่มีใครบอกอะไร
  // เลยคือสิ่งที่ทำให้ผู้ใช้คิดว่าระบบพัง — และช่วงนี้เองที่เป็นทางถอยของผู้ดูแล local
  useEffect(() => {
    if (!leavingTo) return;
    const timer = setTimeout(() => window.location.assign(leavingTo), LEAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [leavingTo]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (countdown > 0) return;
    setLoading(true);
    setError('');
    setNoticeDismissed(true);

    const rawUsername = form.username.trim();

    // 401 = รหัสไม่ถูกเฉย ๆ → ค่อยไปลองอีกทางหนึ่งได้
    // 403 (บัญชีถูกปิด) / 503 (API key ของระบบมีปัญหา) = คนละเรื่องกับรหัสผิด
    // ต้องแสดงข้อความจาก server ตรง ๆ ไม่งั้นผู้ใช้เห็นแค่ "รหัสผ่านไม่ถูกต้อง" แล้วงง
    const handleFatal = (err) => {
      const status = err.response?.status;
      if (status === 429) {
        setCountdown(err.response.data?.retryAfterSeconds || 900);
        setLoading(false);
        return true;
      }
      if (status === 403 || status === 503) {
        setError(err.response.data?.message || 'เข้าสู่ระบบไม่สำเร็จ');
        setLoading(false);
        return true;
      }
      return false;
    };

    try {
      // ลองเป็นครู/ผู้ดูแลก่อน
      const res = await api.post('/auth/login', {
        username: rawUsername,
        password: form.password,
      });
      login(res.data.user, res.data.token);
      navigate('/dashboard');
      return;
    } catch (adminErr) {
      if (handleFatal(adminErr)) return;
      // ไม่ผ่านฝั่งครู → ลองเป็นนักเรียน (รหัสนักเรียน pad 5 หลัก)
    }

    try {
      const res = await api.post('/student/login', {
        username: rawUsername.padStart(5, '0'),
        password: form.password,
      });
      login(res.data.user, res.data.token);
      navigate('/student');
    } catch (studentErr) {
      if (handleFatal(studentErr)) return;
      setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      setLoading(false);
    }
  };

  const mmss = `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* ── ฝั่งแบรนด์ (จอใหญ่) ─────────────────────────────── */}
      <div className="gt-aurora relative hidden flex-col justify-between p-12 lg:flex">
        <span className="gt-aurora-blob gt-aurora-1" />
        <span className="gt-aurora-blob gt-aurora-2" />
        <span className="gt-aurora-blob gt-aurora-3" />

        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[#F5C518] text-[#241b04]">
            <Icon name="graduation" size={24} strokeWidth={1.9} />
          </span>
          <div className="leading-tight">
            <p className="text-base font-bold tracking-tight text-white">GradTrack</p>
            <p className="text-xs text-white/60">โรงเรียนสุคนธีรวิทย์</p>
          </div>
        </div>

        <div className="relative anim-fade-up">
          <span className="mb-5 block h-0.5 w-12 rounded-full bg-[#F5C518]" />
          <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight text-white">
            ระบบติดตามผล
            <br />
            การศึกษาต่อ
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            บันทึกและติดตามผลสอบเข้ามหาวิทยาลัยของนักเรียนชั้น ม.6
            ตั้งแต่ยื่นสมัครจนถึงยืนยันสิทธิ์
          </p>
        </div>

        <div className="relative flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/45">
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={14} />
            เข้าสู่ระบบด้วยบัญชี SchoolOS
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="graduation" size={14} />
            นักเรียนใช้รหัสนักเรียนได้เลย
          </span>
        </div>
      </div>

      {/* ── ฟอร์ม ───────────────────────────────────────────── */}
      <div className="flex items-center justify-center bg-base-100 p-6 sm:p-10">
        <div className="w-full max-w-sm anim-fade-up">
          {/* แบรนด์ย่อสำหรับมือถือ */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-content">
              <Icon name="graduation" size={24} strokeWidth={1.9} />
            </span>
            <div className="leading-tight">
              <p className="text-base font-bold tracking-tight">GradTrack</p>
              <p className="text-xs text-base-content/55">ระบบติดตามผลการศึกษาต่อ</p>
            </div>
          </div>

          {/* กำลังพาไปเข้าระบบที่ SchoolOS — บอกก่อนเสมอว่ากำลังจะไปไหนและทำไม
              พร้อมทางถอยสำหรับคนที่ไม่มีบัญชี SchoolOS ให้ใช้ (ดู schoolosTarget) */}
          {leavingTo ? (
            <div className="flex flex-col gap-4 anim-fade-up">
              <div role="status" className="alert alert-info items-start py-3">
                <Icon name="shield" size={18} className="mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">{LEAVING_NOTICE.title}</p>
                  <p className="mt-1 text-sm opacity-80">{LEAVING_NOTICE.body}</p>
                </div>
              </div>
              <a href={leavingTo} className="btn btn-primary h-11 w-full">
                ไปหน้าเข้าสู่ระบบ SchoolOS
                <Icon name="arrowRight" size={17} />
              </a>
              <button
                type="button"
                onClick={() => {
                  // เลือกอยู่ต่อ = ตั้งใจใช้ฟอร์มนี้ ต้องไม่ถูกพาออกไปอีกทั้งในหน้านี้
                  // (staying → formTouched) และในรอบถัดไปที่เปิดหน้านี้ภายใน
                  // BOUNCE_COOLDOWN ซึ่งธงที่ประทับไว้ตอนตัดสินใจคุมอยู่แล้ว
                  setStaying(true);
                  setLeavingTo('');
                  setCheckingSso(false);
                }}
                className="text-center text-xs text-base-content/50 underline-offset-4 hover:underline"
              >
                เข้าสู่ระบบที่หน้านี้แทน
              </button>
            </div>
          ) : /* กำลังถาม SchoolOS ว่าล็อกอินอยู่แล้วหรือยัง — ยังไม่ต้องโชว์ฟอร์ม
                 ไม่งั้นคนที่ล็อกอินอยู่แล้วจะเห็นฟอร์มแวบหนึ่งก่อนถูกพาเข้าระบบ */
          checkingSso ? (
            <div
              role="status"
              className="flex flex-col items-center gap-4 py-20 text-center anim-fade-up"
            >
              <span className="loading loading-spinner loading-lg text-primary" />
              <p className="text-sm text-base-content/55">
                กำลังตรวจสอบการเข้าสู่ระบบจาก SchoolOS…
              </p>
            </div>
          ) : (
          <>
            <h2 className="text-2xl font-semibold tracking-tight">เข้าสู่ระบบ</h2>
            <p className="mt-1.5 text-sm text-base-content/55">
              ใช้บัญชีครู/ผู้ดูแล หรือรหัสนักเรียนของโรงเรียน
            </p>

            {notice && (
              <div role="status" className="alert alert-warning anim-scale-in mt-5 py-2.5">
                <Icon name="clock" size={17} className="mt-px" />
                <span className="text-sm">{notice}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
              <div>
                <label htmlFor="username" className="label">
                  ชื่อผู้ใช้ / รหัสนักเรียน
                </label>
                <div className="relative">
                  <Icon
                    name="user"
                    size={17}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base-content/40"
                  />
                  <input
                    id="username"
                    type="text"
                    name="username"
                    value={form.username}
                    onChange={handleChange}
                    placeholder="เช่น teacher01 หรือ 12345"
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck="false"
                    className="input h-11 w-full pl-11"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="label">
                  รหัสผ่าน
                </label>
                <div className="relative">
                  <Icon
                    name="lock"
                    size={17}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base-content/40"
                  />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    placeholder="กรอกรหัสผ่าน"
                    required
                    autoComplete="current-password"
                    className="input h-11 w-full pl-11 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-base-content/50 transition-colors hover:bg-secondary hover:text-primary"
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={17} />
                  </button>
                </div>
              </div>

              {/* ข้อความผิดพลาด — ประกาศให้ screen reader ด้วย */}
              <div aria-live="polite">
                {error && (
                  <div role="alert" className="alert alert-error anim-scale-in py-2.5">
                    <Icon name="alert" size={17} className="mt-px" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                {countdown > 0 && (
                  <div role="alert" className="alert alert-warning anim-scale-in py-2.5">
                    <Icon name="clock" size={17} className="mt-px" />
                    <span className="text-sm">
                      พยายามเข้าสู่ระบบผิดหลายครั้ง — ลองใหม่ได้ในอีก{' '}
                      <span className="font-semibold tabular-nums">{mmss}</span> นาที
                    </span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || countdown > 0}
                className="btn btn-primary mt-1 h-11 w-full"
              >
                {loading && <span className="loading loading-spinner loading-xs" />}
                {countdown > 0
                  ? `รอ ${mmss} นาที`
                  : loading
                    ? 'กำลังเข้าสู่ระบบ...'
                    : 'เข้าสู่ระบบ'}
                {!loading && countdown === 0 && <Icon name="arrowRight" size={17} />}
              </button>
            </form>

            <p className="mt-8 text-center text-xs text-base-content/45">
              ลืมรหัสผ่าน? ติดต่อฝ่ายทะเบียนหรือครูที่ปรึกษาของห้อง
            </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
