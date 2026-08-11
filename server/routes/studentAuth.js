const express = require('express');
const router = express.Router();
const { signToken } = require('../config/jwt');
const { VIA } = require('../config/identity');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const schoolos = require('../config/schoolos');
const { verifyToken, adminOnly, staffRead } = require('../middlewares/authMiddleware');
const { loginLimiter } = require('../middlewares/rateLimiter');
const logger = require('../config/logger');
const { logActivity } = require('./activityLogs');

// รหัสนักเรียน: ตัด 0 นำหน้าเพื่อใช้เทียบข้ามแหล่งข้อมูล
// (Student API ส่งรหัสแบบ pad 0 เช่น "02809" แต่ข้อมูลเก่าใน DB เก็บแบบ "2809")
const normCode = (c) => {
  const n = parseInt(c, 10);
  return Number.isNaN(n) ? String(c ?? '') : String(n);
};

// student_profiles / student_admissions สร้างโดย migration ตอนสตาร์ท
// (database/postgres/001_init.sql) — ไม่มี ensureTable() ที่ยิง DDL จาก request path แล้ว

// Postgres คืน SQLSTATE 23505 เมื่อชน unique constraint (เทียบเท่า ER_DUP_ENTRY ของ MySQL)
const isDuplicate = (err) => err.code === '23505';

// ─── Multer: Excel import (memory storage) ──────────────────────────────────
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname) ||
        file.mimetype.includes('spreadsheet') ||
        file.mimetype.includes('excel')) {
      cb(null, true);
    } else {
      cb(new Error('ไฟล์ต้องเป็น Excel (.xlsx, .xls) เท่านั้น'));
    }
  },
}).single('file');

// ─── Multer: อัปโหลดรูปนักเรียน ──────────────────────────────────────────────
const PHOTO_DIR = path.join(__dirname, '..', 'uploads', 'student-photos');
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

// เบราว์เซอร์ย่อรูปให้ก่อนส่งแล้ว (ดู PhotoUploadDialog) ลิมิตนี้เป็นแค่กันเหนียว
// เผื่อกรณีที่ย่อไม่ได้ เช่น รูปแปลกๆ ที่ canvas อ่านไม่ออก
const PHOTO_MAX_MB = 20;

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `student-${req.user.student_code}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: PHOTO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น'));
  },
}).single('photo');

const adminPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const code = String(req.params.student_code || 'student').replace(/[^0-9A-Za-z_-]/g, '');
      cb(null, `student-${code}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: PHOTO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น'));
  },
}).single('photo');

// multer คืนข้อความอังกฤษ ("File too large") — แปลงเป็นข้อความที่ผู้ใช้อ่านรู้เรื่อง
const photoUploadError = (err) =>
  err.code === 'LIMIT_FILE_SIZE'
    ? `ไฟล์รูปใหญ่เกิน ${PHOTO_MAX_MB} MB — ลองย่อรูปก่อนอัปโหลด`
    : err.message;

// ─── Middleware: ตรวจว่าเป็น student role ────────────────────────────────────
function studentOnly(req, res, next) {
  if (req.user?.role !== 'student') {
    return res.status(403).json({ message: 'เฉพาะนักเรียนเท่านั้น' });
  }
  next();
}

// ─── GET /api/student/admin/admission-overview ────────────────────────────────
// สรุปสถานะ admission ของนักเรียนทั้งหมด (admin only)
// query: year_id (required)
router.get('/admin/admission-overview', verifyToken, staffRead, async (req, res) => {
  const { year_id } = req.query;
  if (!year_id) return res.status(400).json({ message: 'year_id required' });

  try {
    // ดึงนักเรียน ม.6 ทั้งหมดในปีนั้นจาก Student API (กรองชั้นฝั่ง API)
    const { data: apiStudents } = await schoolos.listAllStudents({ year_id, class_level: 'ม.6' });
    const m6 = (apiStudents || [])
      .filter((s) => /^ม\.?\s?6/.test(String(s.class_level || '').trim()))
      .sort((a, b) => (a.class_room - b.class_room) || (a.number_in_room - b.number_in_room));

    // ดึง photo_url / quote จาก student_profiles (local) แล้ว merge (เทียบแบบตัด 0 นำหน้า)
    const [profileRows] = await db.query('SELECT student_code, photo_url, quote FROM student_profiles');
    const profileMap = {};
    for (const p of profileRows) profileMap[normCode(p.student_code)] = p;

    const students = m6.map((s) => ({
      student_code: s.student_code,
      title_prefix: s.title_prefix,
      first_name: s.first_name,
      last_name: s.last_name,
      class_level: s.class_level,
      class_room: s.class_room,
      number_in_room: s.number_in_room,
      photo_url: profileMap[normCode(s.student_code)]?.photo_url || null,
      quote: profileMap[normCode(s.student_code)]?.quote || null,
    }));

    // ดึง admissions ทั้งหมดของนักเรียนเหล่านี้ พร้อมชื่อ มหาลัย/คณะ/สาขา
    // ใส่ทั้งรหัสแบบ pad และแบบตัด 0 เพื่อให้ match ข้อมูลเก่าที่ไม่ได้ pad
    const codeSet = new Set();
    for (const s of students) { codeSet.add(s.student_code); codeSet.add(normCode(s.student_code)); }
    const codes = [...codeSet];
    let admissionMap = {};
    if (codes.length > 0) {
      // MySQL กาง `IN (?)` จาก array ให้เอง แต่ Postgres ไม่ทำ —
      // ใช้ `= ANY(?)` ซึ่งรับ array ทั้งก้อนเป็นพารามิเตอร์เดียวได้ตรง ๆ
      const [admissions] = await db.query(
        `SELECT sa.student_code, sa.id, sa.university_id, sa.program_id, sa.confirmed, sa.created_at,
                u.name_th AS university_name, u.logo_url,
                p.campus, p.faculty_name, p.group_field,
                p.program_name_th AS program_name
         FROM student_admissions sa
         JOIN universities u ON u.id = sa.university_id
         JOIN programs p ON p.id = sa.program_id
         WHERE sa.student_code = ANY(?)
         ORDER BY sa.confirmed DESC, sa.created_at ASC`,
        [codes]
      );
      for (const row of admissions) {
        const key = normCode(row.student_code);
        if (!admissionMap[key]) admissionMap[key] = [];
        admissionMap[key].push(row);
      }
    }

    // รวมข้อมูล + จัดกลุ่มสถานะ
    const result = students.map(s => {
      const list = admissionMap[normCode(s.student_code)] || [];
      const hasConfirmed = list.some(a => a.confirmed);
      const status = list.length === 0 ? 'none' : hasConfirmed ? 'confirmed' : 'pending';
      return { ...s, admissions: list, status };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/login ─────────────────────────────────────────────────
// username = รหัสนักเรียน (pad 5 หลัก)
//
// ตรวจรหัสผ่าน 2 ทาง เรียงตามลำดับ:
//   1. SchoolOS /auth/verify — รหัสผ่าน SchoolOS ของนักเรียนเอง (ทางหลัก)
//   2. legacy "Skdw" + เลขบัตรประชาชน — ของเดิมก่อนย้ายมา SchoolOS
//
// ทาง legacy ต้องใช้ scope students:pii และรหัสผ่านที่เดาได้จากเลขบัตร ปชช.
// (ใครรู้เลขบัตรของนักเรียนก็ล็อกอินแทนได้) จึงปิดได้ด้วย STUDENT_LEGACY_LOGIN=0
// เมื่อนักเรียนย้ายไปใช้รหัสผ่าน SchoolOS กันครบแล้ว
const LEGACY_LOGIN_ENABLED = process.env.STUDENT_LEGACY_LOGIN !== '0';

// ชั้นเรียนจาก SchoolOS มาเป็นข้อความ ("ม.6" / "ม. 6" / "ม.6/1" แล้วแต่ที่คีย์กันมา)
// จึงเทียบแบบยืดหยุ่นเหมือนหน้ารายชื่อ ม.6 ของ admin ไม่ใช่ === 'ม.6'
const isM6 = (level) => /^ม\.?\s*6/.test(String(level ?? '').trim());

/**
 * นักเรียนคนนี้เข้าใช้ระบบได้ไหม + หาระเบียนของเขาให้ด้วย
 * ใช้ร่วมกันทุกทางเข้า: รหัสผ่าน SchoolOS · legacy (/student/login) · silent SSO (/auth/sso)
 *
 * @param code    รหัสนักเรียน
 * @param active  รู้สถานะมาก่อนไหม (จาก /auth/verify) · null = ไม่รู้ ให้ดูจากระเบียนที่เจอ
 * @param status  สถานะจาก SchoolOS ('studying' | 'graduated' | ...) · null = ไม่รู้
 * @param found   ผลจาก findStudentWithYear() ที่ผู้เรียกหามาแล้ว · null = ให้หาเอง
 *                (ทาง legacy ต้องหาเองก่อนเพื่อเอา citizen_id มาเทียบรหัสผ่าน — ส่งต่อมาที่นี่
 *                 จะได้ไม่ยิง API ค้นคนเดิมซ้ำอีกรอบ)
 * @returns { student } (student เป็น null ได้ = หาไม่เจอ ผู้เรียกตัดสินต่อเอง)
 *          หรือ { denied: { status, reason, message } }
 */
async function checkStudentAccess({ code, active = null, status = null, found = null }) {
  // SchoolOS ตอบ valid:true ให้เด็กที่จบ/ลาออก/พักการเรียนด้วย (API.md §4.9)
  // ระบบปลายทางต้องตัดสินเองว่าใครเข้าได้ — ที่นี่ใช้เกณฑ์ "รุ่นที่เพิ่งจบ"
  //
  // เปิดเฉพาะ "จบการศึกษา" เท่านั้น — ลาออก/พ้นสภาพระหว่างทางตัดทิ้งตั้งแต่ตรงนี้
  // ก่อนไปค้นรายชื่อ จะได้ไม่เปลืองโควตา API ให้คนที่ยังไงก็เข้าไม่ได้
  const notStudying = {
    status: 403,
    reason: 'inactive',
    message: 'บัญชีนี้ไม่ได้อยู่ในสถานะกำลังศึกษา',
  };
  const isGraduated = (s) => String(s || '') === 'graduated';
  if (active === false && !isGraduated(status)) return { denied: notStudying };

  const record = found ?? (await schoolos.findStudentWithYear(code));
  const student = record.student;

  // ทาง SSO ไม่มี active/status ติดมากับ session (API.md §4.11) → อ่านจากระเบียนที่เจอแทน
  const effStatus = status ?? student?.status ?? null;
  const effActive = active ?? (String(effStatus || '') === 'studying');

  if (!effActive) {
    if (!isGraduated(effStatus)) {
      // ทาง SSO ไม่มีสถานะมาให้เลย "หาไม่เจอ" จึงแปลว่าไม่มีระเบียนให้ตัดสิน
      // ไม่ใช่ "ไม่ได้กำลังศึกษา" — ต้องบอกให้ตรงเหตุ ไม่งั้นไล่หาสาเหตุกันคนละทาง
      if (!student) {
        return {
          denied: {
            status: 403,
            reason: 'not_found',
            message: 'ไม่พบข้อมูลนักเรียนของคุณในระบบ กรุณาติดต่อครูแนะแนว',
          },
        };
      }
      return { denied: notStudying };
    }

    // โรงเรียนทำจบราวเดือน มี.ค. แต่ผล TCAS รอบ 3/4 ออก พ.ค.–มิ.ย.
    // ถ้าปิดตอนจบทันที เด็กจะกรอกผลรอบท้าย ๆ ไม่ได้เลย จึงเปิดต่อให้อีกรุ่นหนึ่ง
    // แล้วปิดเองเมื่อรุ่นถัดไปจบ (isRecentYear) — ไม่ต้องตั้งวันหมดอายุทุกปี
    if (!(record.yearId && (await schoolos.isRecentYear(record.yearId)))) {
      return {
        denied: {
          status: 403,
          reason: 'old_cohort',
          yearId: record.yearId,
          message: 'รุ่นของคุณปิดการเข้าใช้งานแล้ว หากต้องการแก้ไขข้อมูล กรุณาติดต่อครูแนะแนว',
        },
      };
    }
  }

  // ─── ชั้น ม.6 เท่านั้น ─────────────────────────────────────────────────────
  // ระบบนี้เก็บผลสอบเข้ามหาวิทยาลัย ม.1–ม.5 จึงยังไม่มีอะไรให้ทำ และไม่ควรเห็นข้อมูลรุ่นพี่
  //
  // ต้องเช็กคนที่จบไปแล้วด้วย ไม่ใช่เฉพาะคนที่กำลังเรียน — เด็กที่จบ ม.3 แล้วออกไป
  // ก็ได้ status 'graduated' เหมือนกัน ถ้าเช็กแค่คนที่กำลังเรียนก็หลุดเข้ามาทางนั้นได้
  // (ระเบียนของคนที่จบมาจากปีที่เขายังอยู่ ชั้นจึงเป็นชั้นสุดท้ายที่เรียน)
  //
  // ชั้นว่าง/อ่านไม่ออก = ตัดสินไม่ได้ → ปิดไว้ก่อน แล้วส่ง classLevel ให้ผู้เรียก log
  // จะได้เห็นทันทีว่าเป็นเพราะข้อมูลไม่ครบ ไม่ใช่เด็กชั้นอื่นจริง ๆ
  if (student && !isM6(student.class_level)) {
    return {
      denied: {
        status: 403,
        reason: 'not_m6',
        classLevel: student.class_level || null,
        message: 'ระบบนี้เปิดให้เฉพาะนักเรียนชั้น ม.6 เท่านั้น',
      },
    };
  }

  return { student, graduated: !effActive };
}

/**
 * ออก session ของนักเรียนหลังผ่านด่านของ checkStudentAccess() แล้ว
 *
 * @param via    ทางที่เข้ามา สำหรับเก็บลง token (ดู VIA ใน config/identity.js)
 * @param audit  ป้ายละเอียดสำหรับ activity log ('schoolos' | 'legacy' | 'sso-alumni' …)
 *               แยกจาก via เพราะ log อยากรู้ละเอียดกว่าที่ token ต้องใช้ตัดสิน
 * @param ssoSub sub ของ session SchoolOS ที่รับช่วงมา — มีเฉพาะทาง silent SSO
 * @returns { token, user } — โครงเดียวกับที่ /student/login เคยตอบ
 */
async function buildStudentSession(
  student,
  { username, via = VIA.PASSWORD, audit, ssoSub = null, expiresIn } = {}
) {
  const code = student.student_code;

  // สร้าง profile ถ้ายังไม่มี (ON CONFLICT กันกรณีล็อกอินซ้อนกันสองแท็บ)
  await db.query(
    `INSERT INTO student_profiles (student_code, year_id) VALUES (?, 0)
     ON CONFLICT (student_code) DO NOTHING`,
    [code]
  );
  const [[profile]] = await db.query(
    'SELECT quote, photo_url FROM student_profiles WHERE student_code = ?',
    [code]
  );

  const token = signToken(
    { student_code: code, username: username || code, role: 'student', via, ssoSub },
    { expiresIn }
  );

  // รูปจาก SchoolOS ใช้เป็นรูปสำรองของ avatar เมื่อยังไม่ได้อัปโหลดรูปในระบบนี้
  // (photo_url ที่นักเรียนอัปเองยังเป็นตัวหลักเสมอ — ใช้ในหน้า "ของฉัน"/รายงาน)
  const avatar = await schoolos.fetchPhotoDataUrl(student.photo_path);

  logActivity({
    username: username || code,
    name: `${student.first_name} ${student.last_name}`,
    role: 'student',
    action: 'login',
    target: audit || via,
  });

  return {
    token,
    user: {
      student_code: code,
      username: username || code,
      title_prefix: student.title_prefix,
      first_name: student.first_name,
      last_name: student.last_name,
      class_level: student.class_level,
      class_room: student.class_room,
      role: 'student',
      quote: profile?.quote || '',
      photo_url: profile?.photo_url || null,
      avatar,
    },
  };
}

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'กรุณากรอก username และ password' });
  }

  const paddedCode = String(username).trim();

  try {
    let student = null;
    // ป้ายสำหรับ activity log เท่านั้น — ทาง /student/login ทุกเส้นคือการกรอกรหัสผ่านเอง
    // token ที่ออกจึงเป็น VIA.PASSWORD เสมอ (ไม่มี session ของ SchoolOS ให้ผูก)
    let audit = null;

    // ── 1) รหัสผ่าน SchoolOS ──────────────────────────────────────────────────
    const sosUser = await schoolos.verify('student', paddedCode, password);
    if (sosUser) {
      const gate = await checkStudentAccess({
        code: sosUser.code || paddedCode,
        active: sosUser.active,
        status: sosUser.status,
      });
      if (gate.denied) {
        logger.warn(`Student login blocked: ${gate.denied.reason}`, {
          username: paddedCode, status: sosUser.status,
          year_id: gate.denied.yearId, class_level: gate.denied.classLevel,
        });
        return res.status(gate.denied.status).json({ message: gate.denied.message });
      }

      student = gate.student;
      // แยกไว้ให้ audit log อ่านออกว่าเป็นการเข้าใช้ของศิษย์เก่า ไม่ใช่เด็กปัจจุบัน
      audit = sosUser.active ? 'schoolos' : 'schoolos-alumni';
    }

    // ── 2) legacy: Skdw + เลขบัตรประชาชน ─────────────────────────────────────
    if (!student && LEGACY_LOGIN_ENABLED) {
      const found = await schoolos.findStudentWithYear(paddedCode);
      // ต้องมี citizen_id จริง (key มี scope students:pii) ถึงจะเทียบได้
      // ถ้า scope ปิดอยู่ citizen_id เป็น undefined → ห้ามยอมให้ผ่านด้วยคำว่า "Skdw" เปล่า ๆ
      if (found.student?.citizen_id && password === `Skdw${found.student.citizen_id}`) {
        // ทางนี้ก็ต้องผ่านด่านเดียวกับทางอื่น (ชั้น ม.6 · รุ่นที่ยังเปิด) — รหัสผ่านถูก
        // ไม่ได้แปลว่ามีสิทธิ์ใช้ระบบ ถ้าปล่อยผ่านตรงนี้ กติกาจะหลุดกันคนละทางทันที
        const gate = await checkStudentAccess({ code: paddedCode, found });
        if (gate.denied) {
          logger.warn(`Student login blocked: ${gate.denied.reason}`, {
            username: paddedCode, via: 'legacy',
            year_id: gate.denied.yearId, class_level: gate.denied.classLevel,
          });
          return res.status(gate.denied.status).json({ message: gate.denied.message });
        }
        student = gate.student;
        audit = 'legacy';
      }
    }

    if (!student) {
      logger.warn('Student login failed', { username: paddedCode, ip: req.ip });
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const session = await buildStudentSession(student, {
      username: paddedCode,
      via: VIA.PASSWORD,
      audit,
    });

    logger.info('Student login success', {
      student_code: student.student_code, via: audit, ip: req.ip,
    });
    res.json(session);
  } catch (err) {
    // key มีปัญหา ≠ ผู้ใช้กรอกผิด — ต้องแยกให้ชัด ไม่งั้นไล่หาสาเหตุไม่เจอ
    if (err instanceof schoolos.SosKeyError) {
      logger.error('SchoolOS API key ใช้ไม่ได้ (student login)', { code: err.code });
      return res.status(503).json({
        message: 'ระบบเชื่อมต่อ SchoolOS ไม่ได้ (API key มีปัญหา) กรุณาแจ้งผู้ดูแลระบบ',
      });
    }
    if (err instanceof schoolos.SosRateLimitError) {
      return res.status(429).json({
        message: 'พยายามเข้าสู่ระบบเกินกำหนด กรุณารอสักครู่แล้วลองใหม่',
        retryAfterSeconds: err.retryAfterSeconds,
      });
    }

    logger.error('Student login error', { error: err.message });
    res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// ─── GET /api/student/profile ─────────────────────────────────────────────────
router.get('/profile', verifyToken, studentOnly, async (req, res) => {
  try {
    const code = req.user.student_code;

    const student = await schoolos.getStudentByCode(code);
    if (!student) return res.status(404).json({ message: 'ไม่พบข้อมูลนักเรียน' });

    const [[profile]] = await db.query(
      'SELECT quote, photo_url FROM student_profiles WHERE student_code = ?',
      [code]
    );

    res.json({
      student_code: student.student_code,
      title_prefix: student.title_prefix,
      first_name: student.first_name,
      last_name: student.last_name,
      class_level: student.class_level,
      class_room: student.class_room,
      number_in_room: student.number_in_room,
      quote: profile?.quote || '',
      photo_url: profile?.photo_url || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT /api/student/profile/quote ──────────────────────────────────────────
router.put('/profile/quote', verifyToken, studentOnly, async (req, res) => {
  try {
    const { quote } = req.body;
    const code = req.user.student_code;
    await db.query(
      `INSERT INTO student_profiles (student_code, year_id, quote) VALUES (?, 0, ?)
       ON CONFLICT (student_code) DO UPDATE SET quote = EXCLUDED.quote`,
      [code, quote || '']
    );
    res.json({ quote: quote || '' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/profile/photo ─────────────────────────────────────────
router.post('/profile/photo', verifyToken, studentOnly, (req, res) => {
  photoUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ message: photoUploadError(err) });
    if (!req.file) return res.status(400).json({ message: 'ไม่พบไฟล์รูปภาพ' });

    try {
      const code = req.user.student_code;
      const photoUrl = `/uploads/student-photos/${req.file.filename}`;

      // ลบรูปเก่า
      const [[old]] = await db.query(
        'SELECT photo_url FROM student_profiles WHERE student_code = ?', [code]
      );
      if (old?.photo_url?.startsWith('/uploads/')) {
        const oldPath = path.join(__dirname, '..', old.photo_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      await db.query(
        `INSERT INTO student_profiles (student_code, year_id, photo_url) VALUES (?, 0, ?)
         ON CONFLICT (student_code) DO UPDATE SET photo_url = EXCLUDED.photo_url`,
        [code, photoUrl]
      );
      res.json({ photo_url: photoUrl });
    } catch (err2) {
      res.status(500).json({ message: err2.message });
    }
  });
});

// ─── DELETE /api/student/profile/photo ───────────────────────────────────────
// นักเรียนลบรูปของตัวเอง
router.delete('/profile/photo', verifyToken, studentOnly, async (req, res) => {
  try {
    const code = req.user.student_code;
    const [[old]] = await db.query(
      'SELECT photo_url FROM student_profiles WHERE student_code = ?', [code]
    );
    if (old?.photo_url?.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', old.photo_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    await db.query(
      'UPDATE student_profiles SET photo_url = NULL WHERE student_code = ?', [code]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/admin/students/:student_code/photo ───────────────────
// Admin: อัปโหลดรูปให้นักเรียน
router.post('/admin/students/:student_code/photo', verifyToken, adminOnly, (req, res) => {
  adminPhotoUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ message: photoUploadError(err) });
    if (!req.file) return res.status(400).json({ message: 'ไม่พบไฟล์รูปภาพ' });

    try {
      const code = String(req.params.student_code || '').trim();
      if (!code) return res.status(400).json({ message: 'ไม่พบรหัสนักเรียน' });

      let yearId = Number(req.body.year_id || 0) || 0;
      if (!yearId) {
        // Student API ไม่คืน year_id ราย student → ใช้ปี active ของ GradTrack แทน
        const [[setting]] = await db.query(
          "SELECT `value` FROM `settings` WHERE `key` = 'active_year_id'"
        ).catch(() => [[null]]);
        yearId = Number(setting?.value || 0) || 0;
      }

      const photoUrl = `/uploads/student-photos/${req.file.filename}`;
      const [[old]] = await db.query(
        'SELECT photo_url FROM student_profiles WHERE student_code = ?', [code]
      );
      if (old?.photo_url?.startsWith('/uploads/student-photos/')) {
        const oldPath = path.join(__dirname, '..', old.photo_url.replace(/^\//, ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      await db.query(
        `INSERT INTO student_profiles (student_code, year_id, photo_url)
         VALUES (?, ?, ?)
         ON CONFLICT (student_code) DO UPDATE
           SET year_id = EXCLUDED.year_id, photo_url = EXCLUDED.photo_url`,
        [code, yearId, photoUrl]
      );

      res.json({ photo_url: photoUrl, message: 'อัปโหลดรูปสำเร็จ' });
    } catch (err2) {
      res.status(500).json({ message: err2.message });
    }
  });
});

// ─── DELETE /api/student/admin/students/:student_code/photo ──────────────────
// Admin: ลบรูปนักเรียน
router.delete('/admin/students/:student_code/photo', verifyToken, adminOnly, async (req, res) => {
  try {
    const code = String(req.params.student_code || '').trim();
    if (!code) return res.status(400).json({ message: 'ไม่พบรหัสนักเรียน' });

    const [[old]] = await db.query(
      'SELECT photo_url FROM student_profiles WHERE student_code = ?', [code]
    );
    if (old?.photo_url?.startsWith('/uploads/student-photos/')) {
      const oldPath = path.join(__dirname, '..', old.photo_url.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    await db.query(
      'UPDATE student_profiles SET photo_url = NULL, updated_at = NOW() WHERE student_code = ?', [code]
    );
    res.json({ ok: true, message: 'ลบรูปแล้ว' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/student/admissions ─────────────────────────────────────────────
// ดึงรายการสอบติดทั้งหมดของนักเรียน
router.get('/admissions', verifyToken, studentOnly, async (req, res) => {
  try {
    const code = req.user.student_code;
    // เทียบทั้งรหัสแบบ pad และแบบตัด 0 เพื่อให้เห็นข้อมูลเก่าที่เก็บแบบไม่ pad
    const [rows] = await db.query(
      `SELECT sa.id, sa.confirmed,
              u.id AS university_id, u.name_th AS university_name, u.logo_url,
              p.id AS program_id,
              p.campus, p.faculty_name, p.group_field,
              p.field_name_th, p.program_name_th, p.program_type
       FROM student_admissions sa
       JOIN universities u ON u.id = sa.university_id
       JOIN programs p ON p.id = sa.program_id
       WHERE sa.student_code IN (?, ?)
       ORDER BY sa.confirmed DESC, sa.created_at ASC`,
      [code, normCode(code)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/admissions ────────────────────────────────────────────
// เพิ่มมหาวิทยาลัยที่สอบติด
router.post('/admissions', verifyToken, studentOnly, async (req, res) => {
  try {
    const code = req.user.student_code;
    const { program_id } = req.body;
    if (!program_id) {
      return res.status(400).json({ message: 'กรุณาเลือกหลักสูตรให้ครบ' });
    }
    // ดึง university_id จาก program
    const [[prog]] = await db.query('SELECT university_id FROM programs WHERE id = ? LIMIT 1', [program_id]);
    if (!prog) return res.status(404).json({ message: 'ไม่พบหลักสูตรนี้' });
    const university_id = prog.university_id;

    // ถ้ายืนยันสิทธิ์แล้ว ห้ามเพิ่ม (เช็กทั้งรหัสแบบ pad และไม่ pad)
    const [[confirmed]] = await db.query(
      'SELECT id FROM student_admissions WHERE student_code IN (?, ?) AND confirmed = 1 LIMIT 1', [code, normCode(code)]
    );
    if (confirmed) return res.status(400).json({ message: 'ยืนยันสิทธิ์แล้ว ไม่สามารถเพิ่มได้' });

    await db.query(
      `INSERT INTO student_admissions (student_code, university_id, program_id)
       VALUES (?, ?, ?)`,
      [code, university_id, program_id]
    );
    // log
    const [[uniRow]] = await db.query('SELECT name_th AS name FROM universities WHERE id = ? LIMIT 1', [university_id]).catch(() => [[null]]);
    logActivity({ username: code, name: '', role: 'student', action: 'add_admission', target: uniRow?.name || String(university_id), detail: { university_id, program_id } });
    res.json({ message: 'เพิ่มแล้ว' });
  } catch (err) {
    if (isDuplicate(err)) {
      return res.status(400).json({ message: 'มีรายการนี้อยู่แล้ว' });
    }
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE /api/student/admissions/:id ──────────────────────────────────────
// ลบรายการสอบติด (ยังไม่ได้ยืนยันเท่านั้น)
router.delete('/admissions/:id', verifyToken, studentOnly, async (req, res) => {
  try {
    const code = req.user.student_code;
    const { id } = req.params;
    const [[row]] = await db.query(
      'SELECT id, confirmed FROM student_admissions WHERE id = ? AND student_code = ?', [id, code]
    );
    if (!row) return res.status(404).json({ message: 'ไม่พบรายการ' });
    if (row.confirmed) return res.status(400).json({ message: 'ยืนยันสิทธิ์แล้ว ไม่สามารถลบได้' });

    await db.query('DELETE FROM student_admissions WHERE id = ?', [id]);
    res.json({ message: 'ลบแล้ว' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/admissions/:id/confirm ─────────────────────────────────
// ยืนยันสิทธิ์รายการนี้
router.post('/admissions/:id/confirm', verifyToken, studentOnly, async (req, res) => {
  try {
    const code = req.user.student_code;
    const { id } = req.params;
    const [[row]] = await db.query(
      'SELECT id, confirmed FROM student_admissions WHERE id = ? AND student_code = ?', [id, code]
    );
    if (!row) return res.status(404).json({ message: 'ไม่พบรายการ' });
    if (row.confirmed) return res.status(400).json({ message: 'ยืนยันสิทธิ์แล้ว' });

    await db.query('UPDATE student_admissions SET confirmed = 1 WHERE id = ?', [id]);
    logActivity({ username: code, name: '', role: 'student', action: 'confirm_admission', target: `admission#${id}`, detail: null });
    res.json({ message: 'ยืนยันสิทธิ์เรียบร้อยแล้ว 🎉' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/admissions/:id/unconfirm ───────────────────────────────
// ยกเลิกการยืนยันสิทธิ์
router.post('/admissions/:id/unconfirm', verifyToken, studentOnly, async (req, res) => {
  try {
    const code = req.user.student_code;
    const { id } = req.params;
    const [[row]] = await db.query(
      'SELECT id, confirmed FROM student_admissions WHERE id = ? AND student_code = ?', [id, code]
    );
    if (!row) return res.status(404).json({ message: 'ไม่พบรายการ' });
    if (!row.confirmed) return res.status(400).json({ message: 'ยังไม่ได้ยืนยัน' });

    await db.query('UPDATE student_admissions SET confirmed = 0 WHERE id = ?', [id]);
    logActivity({ username: code, name: '', role: 'student', action: 'unconfirm_admission', target: `admission#${id}`, detail: null });
    res.json({ message: 'ยกเลิกการยืนยันแล้ว' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/student/admin/students-by-university ───────────────────────────
// แสดงรายชื่อนักเรียนที่บันทึกผลสอบติดในมหาวิทยาลัยนี้ (กรองตามคณะได้)
// query: university_id (required), faculty (optional), year_id (optional — ใช้ resolve ชื่อ)
router.get('/admin/students-by-university', verifyToken, staffRead, async (req, res) => {
  const { university_id, faculty, year_id } = req.query;
  if (!university_id) return res.status(400).json({ message: 'ต้องระบุ university_id' });

  try {

    const params = [Number(university_id)];
    let facClause = '';
    if (faculty !== undefined && faculty !== '') {
      facClause = ' AND p.faculty_name = ?';
      params.push(faculty);
    }

    const [rows] = await db.query(
      `SELECT sa.id, sa.student_code, sa.confirmed, sa.created_at,
              u.name_th AS university_name, u.logo_url,
              p.campus, p.faculty_name, p.group_field, p.field_name_th,
              p.program_name_th, p.program_type
       FROM student_admissions sa
       JOIN universities u ON u.id = sa.university_id
       JOIN programs p ON p.id = sa.program_id
       WHERE sa.university_id = ?${facClause}
       ORDER BY p.faculty_name, p.program_name_th, sa.confirmed DESC, sa.created_at ASC`,
      params
    );

    // ── resolve ชื่อนักเรียน ──
    // หน้านี้เป็นรายงานข้ามรุ่น: รหัสส่วนใหญ่เป็นของเด็กที่จบไปแล้ว ซึ่ง SchoolOS
    // จะหาไม่เจอเมื่อขึ้นปีใหม่ (API.md §5.3) และหายถาวรถ้าถูกย้ายเข้ากรุ (§5.4)
    // จึงอ่านจาก snapshot ของเราเองก่อนเสมอ แล้วค่อยพึ่ง API เท่าที่ยังขาด —
    // ช่วยเลี่ยงการยิงรายคนทั้งรุ่นซึ่งชนเพดาน 600 req/ชม. ได้ง่ายมาก
    const nameMap = new Map();
    const setInfo = (s) => {
      const info = {
        title_prefix: s.title_prefix,
        first_name: s.first_name,
        last_name: s.last_name,
        class_level: s.class_level,
        class_room: s.class_room,
        number_in_room: s.number_in_room,
      };
      nameMap.set(String(s.student_code), info);
      nameMap.set(normCode(s.student_code), info);
    };

    // 1) snapshot ในฐานข้อมูลเรา
    const snapshots = await schoolos.lookupSnapshots(rows.map((r) => r.student_code));
    for (const info of new Set(snapshots.values())) setInfo(info);

    const stillMissing = () =>
      [...new Set(
        rows
          .filter((r) => !nameMap.has(String(r.student_code)) && !nameMap.has(normCode(r.student_code)))
          .map((r) => r.student_code)
      )];

    // 2) ยังขาด → ดึงทั้งปีจาก API (ปีที่ระบุ → ปี active ของ GradTrack)
    //    เผื่อกรณีรุ่นปัจจุบันที่ยังไม่เคยมีใครเปิดดูรายชื่อ จึงยังไม่มี snapshot
    //    การดึงรอบนี้จะเขียน snapshot ให้เองด้วย รอบหน้าจึงไม่ต้องยิงซ้ำ
    if (stillMissing().length) {
      let activeYearId = Number(year_id) || null;
      if (!activeYearId) {
        const [[setting]] = await db.query(
          "SELECT `value` FROM `settings` WHERE `key` = 'active_year_id'"
        ).catch(() => [[null]]);
        activeYearId = Number(setting?.value || 0) || null;
      }
      if (activeYearId) {
        try {
          const { data } = await schoolos.listAllStudents({ year_id: activeYearId });
          for (const s of (data || [])) setInfo(s);
        } catch { /* API ล่ม → แสดงเฉพาะรหัส */ }
      }
    }

    // 3) ที่เหลือจริง ๆ → ดึงรายคน ปกติเหลือไม่กี่รหัสเพราะสองขั้นบนกวาดไปเกือบหมด
    //
    //    ตรงนี้คูณกันได้เร็วมาก: รหัส × รูปแบบรหัส × ปีที่ไล่ย้อนหลัง จึงจำกัดทั้ง
    //    จำนวนรหัสต่อครั้งและความลึกของการไล่ปี ให้เพดานอยู่ราว 50 requests
    //    ไม่ใช่ 400 — ชน 600/ชม. ครั้งเดียวคือทั้งระบบใช้ไม่ได้ยกชั่วโมง
    //    (รหัสที่ยังไม่ขึ้นชื่อรอบนี้จะได้ชื่อเองเมื่อ snapshot ของรุ่นนั้นถูกเก็บ)
    const MAX_PER_REQUEST_LOOKUPS = 25;
    const missing = stillMissing().slice(0, MAX_PER_REQUEST_LOOKUPS);
    if (missing.length) {
      const CONCURRENCY = 5;
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        await Promise.all(missing.slice(i, i + CONCURRENCY).map(async (code) => {
          try {
            const s = await schoolos.getStudentByCode(code, { yearDepth: 1 });
            if (s) setInfo(s);
          } catch { /* ข้าม */ }
        }));
      }
    }

    const result = rows.map(r => ({
      ...r,
      student: nameMap.get(String(r.student_code)) || nameMap.get(normCode(r.student_code)) || null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/admin/import-admissions ───────────────────────────────
// Import admission data from Excel (admin only)
router.post('/admin/import-admissions', verifyToken, adminOnly, (req, res) => {
  excelUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: 'ไม่พบไฟล์ Excel' });

    try {

      // Get active year from settings first, fallback to ปี current ของ Student API
      let activeYearId = null;
      const [[setting]] = await db.query(
        "SELECT `value` FROM `settings` WHERE `key` = 'active_year_id'"
      );
      if (setting?.value) activeYearId = Number(setting.value);
      if (!activeYearId) {
        const { current } = await schoolos.getAcademicYears();
        if (current) activeYearId = Number(current.id);
      }
      if (!activeYearId) {
        return res.status(400).json({ message: 'ยังไม่ได้ตั้งปีการศึกษา active' });
      }

      // ดึงนักเรียนทั้งปีจาก Student API ครั้งเดียว แล้วทำ Map ไว้ตรวจสอบ (เลี่ยงยิง API รายแถว)
      const { data: yearStudents } = await schoolos.listAllStudents({ year_id: activeYearId });
      const studentMap = new Map();
      for (const s of (yearStudents || [])) {
        studentMap.set(String(s.student_code), s);
        studentMap.set(String(parseInt(s.student_code, 10)), s);
      }

      // Parse Excel
      const XLSX = require('xlsx');
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);

      let imported = 0;
      let skipped = 0;
      const errors = [];
      const warnings = [];

      // หัวตารางจากระบบต้นทางเปลี่ยนรูปได้เรื่อย ๆ (stu_id · stuID · Stu ID)
      // เทียบแบบตัดตัวพิมพ์และตัวคั่นทิ้ง จะได้ไม่ต้องไล่เติม alias ทุกครั้งที่เขาเปลี่ยน
      // — ครั้งก่อนคอลัมน์ชื่อ stu_id พอกลายเป็น stuID ทั้งไฟล์ถูกข้ามเงียบ ๆ ทั้ง 396 แถว
      const normKey = (k) => String(k).toLowerCase().replace(/[\s_\-.]/g, '');

      const normalizeRow = (row) => {
        const out = {};
        for (const [k, v] of Object.entries(row)) out[normKey(k)] = v;
        return out;
      };

      const pick = (obj, keys) => {
        for (const key of keys) {
          const k = normKey(key);
          if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && String(obj[k]).trim() !== '') {
            return obj[k];
          }
        }
        return null;
      };

      const parseConfirmed = (value) => {
        if (value === true || value === 1) return 1;
        const s = String(value || '').trim().toLowerCase();
        return ['true', 'yes', 'y', '1', 'ยืนยัน', 'confirmed'].includes(s) ? 1 : 0;
      };

      const parseExcelDateTime = (value, XLSXRef) => {
        if (value == null || value === '') return null;
        if (typeof value === 'number') {
          const dt = XLSXRef.SSF.parse_date_code(value);
          if (!dt) return null;
          const yyyy = String(dt.y).padStart(4, '0');
          const mm = String(dt.m).padStart(2, '0');
          const dd = String(dt.d).padStart(2, '0');
          const hh = String(dt.H || 0).padStart(2, '0');
          const mi = String(dt.M || 0).padStart(2, '0');
          const ss = String(Math.floor(dt.S || 0)).padStart(2, '0');
          return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
        }
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          return d.toISOString().slice(0, 19).replace('T', ' ');
        }
        return null;
      };

      // แถวที่ 1 คือหัวตาราง — ผู้ใช้เปิดไฟล์แล้วนับตามนี้ได้เลย
      const rowLabel = (i) => `แถวที่ ${i + 2}`;

      for (const [rowIndex, rawRow] of rows.entries()) {
        const row = normalizeRow(rawRow);
        try {
          // student code - supports many column aliases
          const rawCode = String(
            pick(row, ['stu_id', 'student_id', 'student_code', 'เลขประจำตัว', 'รหัสนักเรียน']) || ''
          ).trim();
          if (!rawCode) {
            skipped++;
            errors.push(`${rowLabel(rowIndex)}: ไม่มีรหัสนักเรียน`);
            continue;
          }
          const paddedCode = rawCode.padStart(5, '0');

          // Verify student exists in active year (จาก Map ที่ดึงจาก Student API)
          const matched = studentMap.get(paddedCode) || studentMap.get(rawCode);
          if (!matched) {
            skipped++;
            errors.push(`ไม่พบนักเรียนรหัส ${rawCode}`);
            continue;
          }
          const studentCode = matched.student_code;
          const displayName = `${matched.first_name || ''} ${matched.last_name || ''}`.trim();

          // Extract all row fields early (needed for warnings too)
          const uniName = String(
            pick(row, ['university_name_th', 'university_name', 'university', 'มหาวิทยาลัย']) || ''
          ).trim();
          const facName = String(
            pick(row, ['faculty_name_th', 'faculty_name', 'faculty', 'คณะ']) || ''
          ).trim();
          const progName = String(
            pick(row, ['program_name_th', 'program_name', 'program', 'สาขา']) || ''
          ).trim();
          const campusName = String(
            pick(row, ['campus_name_th', 'campus', 'วิทยาเขต']) || ''
          ).trim();
          const groupField = String(
            pick(row, ['group_field_th', 'group_field', 'สาขา/กลุ่มวิชา', 'กลุ่มวิชา']) || ''
          ).trim();
          const fieldName = String(
            pick(row, ['field_name_th', 'field_name', 'วิชาเอก']) || ''
          ).trim();

          // confirmed flag
          const confirmed = parseConfirmed(
            pick(row, ['confirmation', 'confirmed', 'ยืนยันสิทธิ์', 'ยืนยัน'])
          );

          // created_at from Excel 'Created' column
          const createdAt = parseExcelDateTime(
            pick(row, ['Created', 'created_at', 'created', 'วันที่บันทึก']),
            XLSX
          );

          if (!uniName) {
            skipped++;
            errors.push(`รหัส ${rawCode}: ไม่มีชื่อมหาวิทยาลัย`);
            continue;
          }
          if (!progName) {
            skipped++;
            errors.push(`รหัส ${rawCode}: ไม่มีชื่อหลักสูตร/สาขา`);
            continue;
          }

          // Find university
          const [unis] = await db.query(
            'SELECT id FROM universities WHERE name_th = ? LIMIT 1',
            [uniName]
          );
          if (!unis.length) {
            skipped++;
            warnings.push({
              student_code: studentCode,
              display_name: displayName,
              university_name: uniName,
              faculty_name: facName || null,
              program_name: progName,
              confirmed,
              created_at: createdAt,
              reason: `ไม่พบมหาวิทยาลัย "${uniName}" ในระบบ`,
            });
            continue;
          }
          const universityId = unis[0].id;

          // Find program — try progressively less specific until found
          let progs;
          if (campusName && facName && groupField) {
            [progs] = await db.query(
              'SELECT id FROM programs WHERE university_id=? AND program_name_th=? AND campus=? AND faculty_name=? AND group_field=? LIMIT 1',
              [universityId, progName, campusName, facName, groupField]
            );
          }
          if (!progs?.length && campusName && facName) {
            [progs] = await db.query(
              'SELECT id FROM programs WHERE university_id=? AND program_name_th=? AND campus=? AND faculty_name=? LIMIT 1',
              [universityId, progName, campusName, facName]
            );
          }
          if (!progs?.length && campusName) {
            [progs] = await db.query(
              'SELECT id FROM programs WHERE university_id=? AND program_name_th=? AND campus=? LIMIT 1',
              [universityId, progName, campusName]
            );
          }
          if (!progs?.length) {
            [progs] = await db.query(
              'SELECT id FROM programs WHERE university_id=? AND program_name_th=? LIMIT 1',
              [universityId, progName]
            );
          }
          // ถ้าพบ program แต่ยังไม่มี group_field ให้ update จากข้อมูล Excel
          //
          // ค่าว่างต้องเป็น '' (single quote) เท่านั้น — Postgres อ่าน "" เป็น
          // "ชื่อคอลัมน์ความยาวศูนย์" แล้วโยน zero-length delimited identifier
          // ทิ้งทั้งแถวเข้า catch ด้านล่าง → ไฟล์ถูกข้ามเกลี้ยงโดยไม่มีใครเห็นว่าเป็น SQL พัง
          if (progs?.length && groupField) {
            await db.query(
              "UPDATE programs SET group_field=? WHERE id=? AND (group_field IS NULL OR group_field='')",
              [groupField, progs[0].id]
            );
          }
          if (!progs?.length) {
            skipped++;
            warnings.push({
              student_code: studentCode,
              display_name: displayName,
              university_name: uniName,
              faculty_name: facName || null,
              program_name: progName,
              confirmed,
              created_at: createdAt,
              reason: `ไม่พบหลักสูตร "${progName}" ของ "${uniName}" ในระบบ`,
            });
            continue;
          }
          const programId = progs[0].id;

          // Upsert
          if (createdAt) {
            await db.query(
              `INSERT INTO student_admissions (student_code, university_id, program_id, confirmed, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (student_code, program_id) DO UPDATE SET confirmed = EXCLUDED.confirmed`,
              [studentCode, universityId, programId, confirmed, createdAt]
            );
          } else {
            await db.query(
              `INSERT INTO student_admissions (student_code, university_id, program_id, confirmed)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (student_code, program_id) DO UPDATE SET confirmed = EXCLUDED.confirmed`,
              [studentCode, universityId, programId, confirmed]
            );
          }

          imported++;
        } catch (rowErr) {
          skipped++;
          const fallbackCode = pick(row, ['stu_id', 'student_id', 'student_code', 'เลขประจำตัว', 'รหัสนักเรียน']) || '-';
          errors.push(`รหัส ${fallbackCode}: ${rowErr.message}`);
        }
      }

      // ไม่ได้อะไรเลยสักแถว = มักเป็นเพราะหัวตารางคนละชุดกับที่รองรับ ไม่ใช่ข้อมูลผิดรายแถว
      // บอกหัวตารางที่อ่านได้ไปด้วย จะได้เทียบเองได้ทันทีโดยไม่ต้องเปิด log ฝั่งเซิร์ฟเวอร์
      if (imported === 0 && rows.length > 0) {
        errors.unshift(`หัวตารางที่อ่านได้จากไฟล์: ${Object.keys(rows[0]).join(', ')}`);
      }

      logger.info('Import admissions', { total: rows.length, imported, skipped, warnings: warnings.length });
      res.json({ ok: true, total: rows.length, imported, skipped, errors: errors.slice(0, 50), warnings: warnings.slice(0, 100) });
    } catch (err) {
      logger.error('Import admissions error', { error: err.message });
      res.status(500).json({ message: err.message });
    }
  });
});

// ─── POST /api/student/admin/force-import-admissions ─────────────────────────
// Admin: force-save rows ที่ไม่พบ university/program — auto-create ถ้าจำเป็น
router.post('/admin/force-import-admissions', verifyToken, adminOnly, async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'ไม่มีรายการให้บันทึก' });
  }
  try {
    let saved = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const { student_code, university_name, faculty_name, program_name, confirmed, created_at } = row;
        if (!student_code || !university_name || !program_name) {
          errors.push(`ข้อมูลไม่ครบ: ${student_code || '-'}`);
          continue;
        }

        // Find or create university
        let [[uni]] = await db.query('SELECT id FROM universities WHERE name_th = ? LIMIT 1', [university_name]);
        let universityId;
        if (uni) {
          universityId = uni.id;
        } else {
          const [result] = await db.query('INSERT INTO universities (name_th) VALUES (?) RETURNING id', [university_name]);
          universityId = result.insertId;
        }

        // Find or create program
        let [[prog]] = await db.query(
          'SELECT id FROM programs WHERE university_id = ? AND program_name_th = ? LIMIT 1',
          [universityId, program_name]
        );
        let programId;
        if (prog) {
          programId = prog.id;
        } else {
          const [result] = await db.query(
            'INSERT INTO `programs` (university_id, faculty_name, program_name_th) VALUES (?, ?, ?) RETURNING id',
            [universityId, faculty_name || null, program_name]
          );
          programId = result.insertId;
        }

        // Upsert admission
        if (created_at) {
          await db.query(
            `INSERT INTO student_admissions (student_code, university_id, program_id, confirmed, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (student_code, program_id) DO UPDATE SET confirmed = EXCLUDED.confirmed`,
            [student_code, universityId, programId, confirmed ? 1 : 0, created_at]
          );
        } else {
          await db.query(
            `INSERT INTO student_admissions (student_code, university_id, program_id, confirmed)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (student_code, program_id) DO UPDATE SET confirmed = EXCLUDED.confirmed`,
            [student_code, universityId, programId, confirmed ? 1 : 0]
          );
        }
        saved++;
      } catch (rowErr) {
        errors.push(`รหัส ${row.student_code || '-'}: ${rowErr.message}`);
      }
    }

    res.json({ ok: true, saved, errors });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/student/admin/admissions ──────────────────────────────────────
// Admin: เพิ่ม admission ให้นักเรียน
router.post('/admin/admissions', verifyToken, adminOnly, async (req, res) => {
  const { student_code, program_id, confirmed = 0 } = req.body;
  if (!student_code || !program_id) {
    return res.status(400).json({ message: 'ต้องระบุ student_code และ program_id' });
  }
  try {
    const [progs] = await db.query('SELECT id, university_id FROM `programs` WHERE id = ?', [Number(program_id)]);
    if (!progs.length) return res.status(404).json({ message: 'ไม่พบหลักสูตรนี้' });
    const university_id = progs[0].university_id;
    const [result] = await db.query(
      `INSERT INTO student_admissions (student_code, university_id, program_id, confirmed)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (student_code, program_id) DO UPDATE SET confirmed = EXCLUDED.confirmed
       RETURNING id`,
      [student_code, university_id, Number(program_id), confirmed ? 1 : 0]
    );
    res.json({ id: result.insertId || null, message: 'เพิ่มข้อมูลสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PATCH /api/student/admin/admissions/:id/confirm ─────────────────────────
// Admin: อัปเดตสถานะยืนยัน
router.patch('/admin/admissions/:id/confirm', verifyToken, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { confirmed } = req.body;
  try {
    await db.query('UPDATE student_admissions SET confirmed = ?, updated_at = NOW() WHERE id = ?', [confirmed ? 1 : 0, Number(id)]);
    res.json({ message: 'อัปเดตสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE /api/student/admin/admissions/:id ─────────────────────────────────
// Admin: ลบ admission
router.delete('/admin/admissions/:id', verifyToken, adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM student_admissions WHERE id = ?', [Number(id)]);
    res.json({ message: 'ลบสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
// silent SSO ใช้กติกาเดียวกันกับล็อกอินด้วยรหัสผ่าน (ดู routes/sso.js)
module.exports.checkStudentAccess = checkStudentAccess;
module.exports.buildStudentSession = buildStudentSession;
