const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, adminOnly, staffRead } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// report_settings / report_student_settings สร้างโดย migration ตอนสตาร์ท
// (database/postgres/001_init.sql) — รวมถึงแถวค่าเริ่มต้น id = 1

// รหัสนักเรียนบางที่ pad 0 นำหน้า บางที่ไม่ pad — normalize ให้ตรงกันเสมอ
const normCode = (c) => {
  const n = parseInt(c, 10);
  return Number.isNaN(n) ? String(c ?? '') : String(n);
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ─── ฟอนต์ที่อนุญาต ───────────────────────────────────────────────────────────
// ต้องตรงกับ client/src/utils/cardFonts.js — แก้ที่นั่นแล้วแก้ที่นี่ด้วย
//
// เป็น whitelist ไม่ใช่แค่ validation: ชื่อฟอนต์ถูกเอาไปต่อเป็น URL ของ Google Fonts
// และแปะลงใน <style> ของแท็บพิมพ์ฝั่ง client ค่าที่หลุด whitelist มาจะกลายเป็น CSS injection
const CARD_FONTS = [
  'Prompt', 'Kanit', 'Sarabun', 'IBM Plex Sans Thai', 'Noto Sans Thai', 'Mitr',
  'Bai Jamjuree', 'Chakra Petch', 'K2D', 'Athiti', 'Niramit', 'Pridi', 'Trirong',
  'Charm', 'Charmonman', 'Srisakdi',
];
const DEFAULT_FONT = 'Prompt';
const safeFont = (v) => (CARD_FONTS.includes(v) ? v : DEFAULT_FONT);

const HEX_COLOR = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
const TEXT_ALIGNS = ['left', 'center', 'right'];

// null/'' = ล้างค่า (กลับไปใช้ค่ากลาง), ตัวเลข = override
const nullableInt = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, min, max) : null;
};
const nullableBool = (v) => (v === null || v === undefined || v === '' ? null : (v ? 1 : 0));

// layout_json: รับได้ทั้ง string หรือ object → คืน JSON string ที่สะอาด หรือ null ถ้าว่าง/พัง
// กันค่าเพี้ยน: เก็บเฉพาะ x,y,w,h,scale ที่เป็นตัวเลขจำกัดช่วง canvas 1080
// และสไตล์ตัวอักษรรายชิ้น font/weight/color/align — คีย์ที่ไม่รู้จักถูกทิ้งทั้งหมด
const sanitizeLayoutJson = (v) => {
  if (v === null || v === undefined || v === '') return null;
  let obj = v;
  if (typeof v === 'string') {
    try { obj = JSON.parse(v); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const num = (n, min, max) => (Number.isFinite(Number(n)) ? clamp(Number(n), min, max) : undefined);
  const out = {};
  for (const [key, box] of Object.entries(obj)) {
    if (!box || typeof box !== 'object') continue;
    const b = {};
    if (box.x !== undefined)     b.x = num(box.x, -2000, 2000);
    if (box.y !== undefined)     b.y = num(box.y, -2000, 2000);
    if (box.w !== undefined)     b.w = num(box.w, 8, 2000);
    if (box.h !== undefined)     b.h = num(box.h, 8, 2000);
    if (box.scale !== undefined) b.scale = num(box.scale, 0.2, 6);
    // สไตล์ตัวอักษรรายชิ้น — ค่าที่ไม่ผ่านจะถูก "ทิ้ง" ไม่ใช่แทนด้วยค่า default
    // เพราะ "ไม่มีคีย์" แปลว่าสืบทอดจากค่ากลาง ซึ่งเป็นพฤติกรรมที่ถูกต้องกว่าการยัดค่าตายตัวลงไป
    if (CARD_FONTS.includes(box.font)) b.font = box.font;
    if (box.weight !== undefined) b.weight = num(box.weight, 100, 900);
    if (typeof box.color === 'string' && HEX_COLOR.test(box.color)) b.color = box.color;
    if (TEXT_ALIGNS.includes(box.align)) b.align = box.align;
    // ตัด undefined ออก
    for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
    if (Object.keys(b).length > 0) out[key] = b;
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
};

// ─── Multer: background image upload ──────────────────────────────────────────
const makeStorage = (subdir, prefix) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, `../uploads/${subdir}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${prefix}-${Date.now()}${ext}`);
  },
});
const imageFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
  cb(null, true);
};
const uploadBgMW  = multer({ storage: makeStorage('report-bg',   'bg'),   limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: imageFilter });
const uploadLogoMW = multer({ storage: makeStorage('report-logo', 'logo'), limits: { fileSize: 5  * 1024 * 1024 }, fileFilter: imageFilter });

// ─── GET /api/report-settings ──────────────────────────────────────────────────
router.get('/', verifyToken, staffRead, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM report_settings WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT /api/report-settings ─────────────────────────────────────────────────
router.put('/', verifyToken, adminOnly, async (req, res) => {
  const { congrats_text, show_quote, school_name, text_color, show_photo_frame, photo_scale, photo_overflow, photo_offset_y, name_bg_color, name_bg_opacity, info_offset_y, confirm_color, confirm_opacity, font_family, layout_json } = req.body;
  // จำกัดช่วงค่ากันเพี้ยน
  const scale     = Math.min(300, Math.max(50, Number(photo_scale) || 100));
  const offsetY   = Math.min(300, Math.max(-300, Number(photo_offset_y) || 0));
  const nameOp    = Math.min(100, Math.max(0, Number(name_bg_opacity) || 0));
  const infoY     = Math.min(300, Math.max(-300, Number(info_offset_y) || 0));
  const _co       = Number(confirm_opacity);
  const confirmOp = Math.min(100, Math.max(0, Number.isFinite(_co) ? _co : 22));
  const layout    = sanitizeLayoutJson(layout_json);
  const font      = safeFont(font_family);
  try {
    await db.query(
      'UPDATE report_settings SET congrats_text = ?, show_quote = ?, school_name = ?, text_color = ?, show_photo_frame = ?, photo_scale = ?, photo_overflow = ?, photo_offset_y = ?, name_bg_color = ?, name_bg_opacity = ?, info_offset_y = ?, confirm_color = ?, confirm_opacity = ?, font_family = ?, layout_json = ? WHERE id = 1',
      [congrats_text ?? '', show_quote ? 1 : 0, school_name ?? '', text_color ?? '#ffffff', show_photo_frame ? 1 : 0, scale, photo_overflow ? 1 : 0, offsetY, name_bg_color ?? '#000000', nameOp, infoY, confirm_color ?? '#22c55e', confirmOp, font, layout]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/report-settings/students ────────────────────────────────────────
// คืน object: { [student_code]: { photo_scale, photo_offset_y, ... } }
router.get('/students', verifyToken, staffRead, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM report_student_settings');
    const map = {};
    for (const r of rows) {
      const { student_code, ...rest } = r;
      map[student_code] = rest;
    }
    res.json(map);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── PUT /api/report-settings/students/:code ──────────────────────────────────
router.put('/students/:code', verifyToken, adminOnly, async (req, res) => {
  const code = normCode(req.params.code);
  if (!code) return res.status(400).json({ message: 'student_code required' });

  const scale   = nullableInt(req.body.photo_scale, 50, 300);
  const offsetY = nullableInt(req.body.photo_offset_y, -300, 300);
  const infoY   = nullableInt(req.body.info_offset_y, -300, 300);
  const overflow = nullableBool(req.body.photo_overflow);
  const layout  = sanitizeLayoutJson(req.body.layout_json);

  try {
    await db.query(
      `INSERT INTO report_student_settings (student_code, photo_scale, photo_offset_y, photo_overflow, info_offset_y, layout_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (student_code) DO UPDATE
         SET photo_scale    = EXCLUDED.photo_scale,
             photo_offset_y = EXCLUDED.photo_offset_y,
             photo_overflow = EXCLUDED.photo_overflow,
             info_offset_y  = EXCLUDED.info_offset_y,
             layout_json    = EXCLUDED.layout_json`,
      [code, scale, offsetY, overflow, infoY, layout]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE /api/report-settings/students/:code ───────────────────────────────
// ลบ override → นักเรียนคนนี้กลับไปใช้ค่ากลาง
router.delete('/students/:code', verifyToken, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM report_student_settings WHERE student_code = ?', [normCode(req.params.code)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/report-settings/background ─────────────────────────────────────
router.post('/background', verifyToken, adminOnly, uploadBgMW.single('bg'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/report-bg/${req.file.filename}`;
  try {
    await db.query('UPDATE report_settings SET background_image_url = ? WHERE id = 1', [url]);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE /api/report-settings/background ───────────────────────────────────
router.delete('/background', verifyToken, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT background_image_url FROM report_settings WHERE id = 1');
    const oldUrl = rows[0]?.background_image_url;
    if (oldUrl) {
      const filePath = path.join(__dirname, '../uploads', oldUrl.replace('/uploads/', ''));
      fs.unlink(filePath, () => {});
    }
    await db.query('UPDATE report_settings SET background_image_url = NULL WHERE id = 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/report-settings/school-logo ────────────────────────────────────
router.post('/school-logo', verifyToken, adminOnly, uploadLogoMW.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/report-logo/${req.file.filename}`;
  try {
    await db.query('UPDATE report_settings SET school_logo_url = ? WHERE id = 1', [url]);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── DELETE /api/report-settings/school-logo ──────────────────────────────────
router.delete('/school-logo', verifyToken, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT school_logo_url FROM report_settings WHERE id = 1');
    const oldUrl = rows[0]?.school_logo_url;
    if (oldUrl) {
      const filePath = path.join(__dirname, '../uploads', oldUrl.replace('/uploads/', ''));
      fs.unlink(filePath, () => {});
    }
    await db.query('UPDATE report_settings SET school_logo_url = NULL WHERE id = 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
