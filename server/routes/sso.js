// ─── Silent SSO — รับช่วง session ที่ล็อกอินไว้แล้วที่ SchoolOS ────────────────
//
// ผู้ใช้ที่ล็อกอิน SchoolOS อยู่แล้วเปิด GradTrack → เข้าได้เลยโดยไม่ต้องกรอกรหัสซ้ำ
// ถ้ายังไม่ได้ล็อกอิน ก็เห็นหน้า login ตามปกติ (หน้าเว็บถอยเองเมื่อได้ valid:false)
//
// ทำไมต้องมี route นี้: cookie `sso_session` ของ SchoolOS เป็น HttpOnly หน้าเว็บจึง
// อ่านไม่ได้และส่งต่อให้ server ของเราเองไม่ได้ ทางที่ SchoolOS เปิดให้คือ
//   เบราว์เซอร์ขอ "โค้ดใช้ครั้งเดียว" (อายุ 60 วิ) มาจาก /api/auth/handoff
//   → ส่งมาที่ตรงนี้ → เราเอาไปแลกด้วย API key ที่ไม่มีวันหลุดไปฝั่ง client
// รายละเอียดเต็มอยู่ใน API.md ของ SchoolOS Users ข้อ 4.11
//
// ตัวตนที่ได้จากการแลกโค้ด **ไม่มี** active/status และ role มีแค่ teacher|student
// (teacher-admin ไม่อยู่ใน session claims) → ต้องไปอ่านทะเบียนครู/นักเรียนเองทุกครั้ง
// ด่านที่เหลือ (รายชื่อครูที่ได้สิทธิ์ · รุ่นของนักเรียน) ใช้โค้ดชุดเดียวกับล็อกอินด้วยรหัสผ่าน
const express = require('express');
const router = express.Router();
const schoolos = require('../config/schoolos');
const logger = require('../config/logger');
const { VIA } = require('../config/identity');
const { ssoLimiter } = require('../middlewares/rateLimiter');
const { logActivity } = require('./activityLogs');
const { issueStaffSession } = require('./auth');
const { checkStudentAccess, buildStudentSession } = require('./studentAuth');

// ชื่อระบบปลายทางที่ผู้ดูแล SchoolOS ตั้งไว้ให้ API key ของเรา — ต้องตรงเป๊ะ
// ไม่ตรง = ได้ audience_mismatch (ตรวจของจริงได้ที่ GET /api/public/v1/me)
const AUDIENCE = (process.env.SCHOOLOS_HANDOFF_AUDIENCE || 'grad').trim();

// base ของ SchoolOS "ในสายตาเบราว์เซอร์" — คนละค่ากับ SCHOOLOS_API_BASE ที่ server ใช้
// prod อยู่โดเมนเดียวกัน (schoolos.sukhon.ac.th/users) จึงเป็น path ล้วน = same-origin
// ไม่ต้องพึ่ง CORS เลย · ใส่ URL เต็มได้ถ้าอยู่คนละโดเมน (ต้องอยู่ใน SSO_ALLOWED_ORIGINS)
const WEB_BASE = (process.env.SCHOOLOS_WEB_BASE ?? '/users').replace(/\/+$/, '');

// ที่ที่ผู้ใช้จะถูกส่งไปเมื่อไม่มี session — ค่าเริ่มต้นเป็น path ล้วน = หน้าแรกของ
// โดเมนเดียวกัน (portal ของ SchoolOS)
//
// ใช้ทั้งตอนกดปุ่ม "ออกจากระบบ" (ซึ่งออกจาก SchoolOS ทั้งแพลตฟอร์มด้วย) และตอนที่
// session จบเอง/เปิด /grad ตรง ๆ โดยไม่มี session ซึ่งแค่ส่งไปที่นี่เฉย ๆ ไม่ได้เตะออก
// จาก SchoolOS ด้วย (ดู utils/session.js ฝั่ง client)
//
// ต้องเป็น path เสมอถ้าเป็นไปได้ — ตอนล็อกเอาต์เราส่งค่านี้ไปเป็น ?next= ให้ Users
// ซึ่งรับเฉพาะ path ในโดเมนตัวเอง หรือ origin ที่อยู่ใน SSO_ALLOWED_ORIGINS
// (กัน open redirect) ใส่ URL เต็มที่ไม่ได้อยู่ในรายการจะโดนพากลับไปหน้า login ของ Users แทน
const PORTAL_URL = (process.env.SCHOOLOS_PORTAL_URL || '/').trim();

const ENABLED = process.env.SSO_SILENT_LOGIN !== '0';

/**
 * อายุ token ของเราต้องไม่ยาวเกิน session ของ SchoolOS
 * ไม่งั้นผู้ใช้จะ "ยังอยู่ใน GradTrack" ทั้งที่ต้นทางหมดอายุไปแล้ว
 * คืนวินาที หรือ undefined = ใช้ JWT_EXPIRES_IN ตามปกติ
 */
function cappedExpiry(absoluteEndsAt) {
  const seconds = Math.floor((Number(absoluteEndsAt) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

// ─── GET /api/auth/sso/config ────────────────────────────────────────────────
// ค่าที่หน้า login ต้องรู้ก่อนไปขอโค้ดจาก SchoolOS — ตั้งที่ .env ฝั่ง server
// ที่เดียว ไม่ต้อง build client ใหม่เวลาย้ายโดเมน (ค่าพวกนี้ไม่ใช่ความลับ)
router.get('/config', (req, res) => {
  res.json({ enabled: ENABLED, usersBase: WEB_BASE, audience: AUDIENCE, portalUrl: PORTAL_URL });
});

// ─── POST /api/auth/sso ──────────────────────────────────────────────────────
// body { code } = โค้ด handoff ที่เบราว์เซอร์เพิ่งขอมาจาก SchoolOS
router.post('/', ssoLimiter, async (req, res) => {
  if (!ENABLED) return res.status(404).json({ message: 'ระบบปิด silent SSO ไว้' });

  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ message: 'ไม่พบโค้ดสำหรับเข้าสู่ระบบ' });

  try {
    const { user: session, absoluteEndsAt } = await schoolos.redeemHandoff(code);
    const expiresIn = cappedExpiry(absoluteEndsAt);
    const identity = String(session.code || session.sub || '').trim();

    // ─── ผูก session ของเราเข้ากับ session ของ SchoolOS ───────────────────────
    // เก็บ sub ที่ SchoolOS ให้มา **ดิบ ๆ ไม่แปลง** เพราะหน้าเว็บต้องเอาไปเทียบกับ
    // GET /api/auth/session ของ SchoolOS ตรง ๆ (ดู SessionGuard ฝั่ง client)
    //
    // ถ้าไม่เก็บไว้ session ของเรากับของ SchoolOS จะเป็นคนละใบที่ไม่รู้จักกันเลย
    // พอมีคนล็อกอินใหม่ที่ portal cookie ของเราก็ยังชี้ไปที่คนเก่าและยัง valid อยู่
    // → คนใหม่เห็นข้อมูลของคนเก่า ซึ่งบนเครื่องส่วนกลางคือปัญหาใหญ่
    const ssoSub = String(session.sub || session.code || '').trim();

    if (!identity) {
      logger.warn('SSO: handoff ไม่มีรหัสผู้ใช้', { role: session.role });
      return res.status(403).json({ message: 'ข้อมูลผู้ใช้จาก SchoolOS ไม่ครบ' });
    }

    // ── นักเรียน ──────────────────────────────────────────────────────────────
    if (session.role === 'student') {
      const gate = await checkStudentAccess({ code: identity });
      if (gate.denied) {
        logger.warn(`SSO blocked (student): ${gate.denied.reason}`, {
          student_code: identity, year_id: gate.denied.yearId,
          class_level: gate.denied.classLevel,
        });
        return res.status(gate.denied.status).json({ message: gate.denied.message });
      }
      if (!gate.student) {
        return res.status(403).json({ message: 'ไม่พบข้อมูลนักเรียนของคุณในระบบ กรุณาติดต่อครูแนะแนว' });
      }

      const audit = gate.graduated ? 'sso-alumni' : 'sso';
      const result = await buildStudentSession(gate.student, {
        username: gate.student.student_code,
        via: VIA.SSO,
        audit,
        ssoSub,
        expiresIn,
      });

      logger.info('SSO login success (student)', {
        student_code: gate.student.student_code, via: audit, ip: req.ip,
      });
      return res.json(result);
    }

    // ── ครู/ผู้ดูแล ───────────────────────────────────────────────────────────
    // session ไม่บอกว่ายังทำงานอยู่ไหม และไม่บอก role จริง (teacher-admin)
    // → ต้องอ่านจากทะเบียนครูเอง ซึ่งได้รูปโปรไฟล์ติดมาด้วยในคำขอเดียว
    const teacher = await schoolos.findTeacher(identity);
    if (!teacher) {
      // แยกให้ออกระหว่าง "ลาออกแล้ว" กับ "ไม่มีรหัสนี้" — ข้อความคนละเรื่องกัน
      const resigned = await schoolos.findTeacher(identity, { status: 'all' });
      logger.warn('SSO blocked (teacher): not active', { teacher_code: identity, resigned: !!resigned });
      return res.status(403).json({
        message: resigned
          ? 'บัญชีนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ'
          : 'ไม่พบบัญชีครูนี้ใน SchoolOS',
      });
    }

    const sosUser = {
      id: teacher.id,
      code: teacher.teacher_code,
      name: teacher.full_name || session.name || '',
      role: teacher.role,
      active: true,
      status: teacher.employment_status,
    };

    const { denied, access, token, user } = await issueStaffSession(sosUser, {
      teacher,
      expiresIn,
      via: VIA.SSO,
      ssoSub,
    });
    if (denied) {
      logger.warn(`SSO blocked (teacher): ${denied.reason}`, {
        teacher_code: identity, sosRole: teacher.role,
      });
      return res.status(denied.status).json({ message: denied.message });
    }

    logger.info('SSO login success (schoolos)', {
      username: sosUser.code, sosRole: teacher.role, role: user.role, access: access.via, ip: req.ip,
    });
    logActivity({
      username: sosUser.code, name: sosUser.name, role: user.role, action: 'login', target: 'sso',
    });

    return res.json({ token, user });
  } catch (err) {
    // โค้ดหมดอายุ/ถูกใช้ไปแล้ว = เรื่องปกติของ handoff ไม่ใช่ระบบพัง
    // หน้าเว็บเห็น 401 แล้วถอยไปแสดงฟอร์มตามปกติ **ห้ามยิงโค้ดเดิมซ้ำ**
    if (err instanceof schoolos.SosHandoffError) {
      // used_code = ฝั่งเรายิงซ้ำเอง ซึ่งเป็นบั๊ก ไม่ใช่ความผิดผู้ใช้ → ดังกว่าตัวอื่น
      const level = err.code === 'used_code' ? 'error' : 'info';
      logger[level]('SSO handoff ใช้ไม่ได้', { code: err.code, ip: req.ip });
      return res.status(401).json({ message: 'เซสชัน SchoolOS ใช้ไม่ได้แล้ว', reason: err.code });
    }
    if (err instanceof schoolos.SosKeyError) {
      logger.error('SchoolOS API key ใช้ไม่ได้ (sso)', { code: err.code });
      return res.status(503).json({
        message: 'ระบบเชื่อมต่อ SchoolOS ไม่ได้ (API key มีปัญหา) กรุณาแจ้งผู้ดูแลระบบ',
      });
    }

    logger.error('SSO error', { error: err.message });
    res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

module.exports = router;
