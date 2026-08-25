-- =============================================================================
-- GradTrack — schema สำหรับ PostgreSQL  (database: graduate บน postgres-core)
-- =============================================================================
-- กฎเหล็ก: ไฟล์นี้ต้อง ADDITIVE เท่านั้น
--   * ห้ามมี DROP TABLE / DROP COLUMN / DROP INDEX / TRUNCATE / ALTER ... TYPE
--   * ใช้ IF NOT EXISTS ทุกที่ให้รันซ้ำได้ (idempotent)
-- เหตุผล: entrypoint รัน migration อัตโนมัติตอนคอนเทนเนอร์สตาร์ท และ deploy ผ่าน
-- Portainer เป็น push แบบไม่ถามใคร — ถ้ามี statement ที่ทำข้อมูลหาย มันจะหายเงียบ ๆ
--
-- boolean ในตารางเก็บเป็น SMALLINT (0/1) โดยตั้งใจ ไม่ใช่ BOOLEAN:
-- โค้ดเดิมเขียน `WHERE confirmed = 1` / `confirmed ? 1 : 0` อยู่ทั่วโปรเจกต์
-- =============================================================================

-- ─── trigger กลางสำหรับ updated_at ───────────────────────────────────────────
-- MySQL มี `ON UPDATE CURRENT_TIMESTAMP` ให้ในตัว แต่ Postgres ต้องทำเอง
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── users — บัญชีภายในของ GradTrack ─────────────────────────────────────────
-- ผู้ดูแลตัวจริงมาจาก role "teacher-admin" ของ SchoolOS (ไม่ต้อง seed)
-- ตารางนี้เหลือไว้สำหรับบัญชี local ที่สร้างเองในหน้า "จัดการบัญชี"
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(100) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,          -- bcrypt hash
  name        VARCHAR(200) NOT NULL DEFAULT '',
  role        VARCHAR(20)  NOT NULL DEFAULT 'student',
  email       VARCHAR(200) UNIQUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── settings — key/value ของระบบ (เช่น active_year_id) ──────────────────────
-- "key" และ "value" เป็นคำสงวนของ Postgres → ต้อง quote เสมอ
CREATE TABLE IF NOT EXISTS settings (
  "key"      VARCHAR(100) PRIMARY KEY,
  "value"    TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER trg_settings_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── academic_years — แคชปีการศึกษาที่เคยเห็นจาก SchoolOS ────────────────────
-- SchoolOS Public API ไม่มี endpoint ให้ list ปีการศึกษา (มีแต่ field academicYear
-- ที่ติดมากับ /students) → เก็บสะสมไว้เองเพื่อให้หน้า "ปีการศึกษา" ยังเลือกย้อนหลังได้
CREATE TABLE IF NOT EXISTS academic_years (
  id         INTEGER PRIMARY KEY,             -- id เดียวกับฝั่ง SchoolOS
  year_be    VARCHAR(10)  NOT NULL,
  title      VARCHAR(100) NOT NULL DEFAULT '',
  is_current SMALLINT     NOT NULL DEFAULT 0,
  seen_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── activity_logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id             SERIAL PRIMARY KEY,
  actor_username VARCHAR(100) NOT NULL,
  actor_name     VARCHAR(200) DEFAULT '',
  actor_role     VARCHAR(20)  DEFAULT '',
  action         VARCHAR(100) NOT NULL,
  target         VARCHAR(200) DEFAULT '',
  detail         TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);

-- ─── universities ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS universities (
  id              SERIAL PRIMARY KEY,
  name_th         VARCHAR(255) NOT NULL,
  name_en         VARCHAR(255),
  short_name      VARCHAR(50),
  university_type VARCHAR(50),
  logo_url        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_universities_name_th UNIQUE (name_th)
);

CREATE OR REPLACE TRIGGER trg_universities_updated_at BEFORE UPDATE ON universities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── faculties ───────────────────────────────────────────────────────────────
-- ปัจจุบัน programs เก็บ faculty_name เป็นข้อความตรง ๆ แล้ว ตารางนี้ใช้โดย
-- หน้า sync คณะจาก Wikipedia เท่านั้น — เก็บไว้เพื่อไม่ให้ feature เดิมหาย
CREATE TABLE IF NOT EXISTS faculties (
  id            SERIAL PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  name_th       VARCHAR(255) NOT NULL,
  name_en       VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_faculties_uni_name UNIQUE (university_id, name_th)
);

-- ─── programs ────────────────────────────────────────────────────────────────
-- ไม่มี unique key บนชื่อหลักสูตรโดยตั้งใจ: หลักสูตรชื่อเดียวกันมีได้หลายวิทยาเขต
-- และหลายประเภท (ปกติ/นานาชาติ) ซึ่งต้องแยกเป็นคนละแถว
CREATE TABLE IF NOT EXISTS programs (
  id              SERIAL PRIMARY KEY,
  university_id   INTEGER REFERENCES universities(id) ON DELETE CASCADE,
  faculty_id      INTEGER REFERENCES faculties(id) ON DELETE SET NULL,
  campus          VARCHAR(255),
  faculty_name    VARCHAR(255),
  group_field     VARCHAR(255),
  field_name_th   VARCHAR(255),
  field_name_en   VARCHAR(255),
  program_name_th VARCHAR(500) NOT NULL,
  program_name_en VARCHAR(500),
  program_type    VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_programs_university ON programs (university_id);
CREATE INDEX IF NOT EXISTS idx_programs_lookup     ON programs (university_id, program_name_th);

-- ─── student_profiles — ข้อมูลที่ GradTrack เก็บเอง (รูป/คำคม) ────────────────
-- ชื่อ/ชั้น/ห้อง ไม่เก็บที่นี่ เพราะตารางนี้เป็น 1 แถวต่อคน (ข้ามปี)
-- ส่วนชื่อ/ชั้น/ห้องเปลี่ยนทุกปี → เก็บแยกรายปีที่ student_snapshots (003_*.sql)
CREATE TABLE IF NOT EXISTS student_profiles (
  id           SERIAL PRIMARY KEY,
  student_code VARCHAR(20) NOT NULL UNIQUE,
  year_id      INTEGER NOT NULL DEFAULT 0,
  quote        TEXT,
  photo_url    VARCHAR(500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER trg_student_profiles_updated_at BEFORE UPDATE ON student_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── student_admissions — ผลสอบติดที่นักเรียนบันทึก ──────────────────────────
CREATE TABLE IF NOT EXISTS student_admissions (
  id            SERIAL PRIMARY KEY,
  student_code  VARCHAR(20) NOT NULL,
  university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  program_id    INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  confirmed     SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_student_program UNIQUE (student_code, program_id)
);
CREATE INDEX IF NOT EXISTS idx_admissions_student ON student_admissions (student_code);
CREATE INDEX IF NOT EXISTS idx_admissions_uni     ON student_admissions (university_id);

CREATE OR REPLACE TRIGGER trg_student_admissions_updated_at BEFORE UPDATE ON student_admissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── report_settings — ค่ากลางของการ์ดรายงาน (แถวเดียว id = 1) ───────────────
CREATE TABLE IF NOT EXISTS report_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  congrats_text        TEXT,
  show_quote           SMALLINT NOT NULL DEFAULT 1,
  background_image_url VARCHAR(500),
  school_name          VARCHAR(255),
  school_logo_url      VARCHAR(500),
  text_color           VARCHAR(20) DEFAULT '#ffffff',
  show_photo_frame     SMALLINT NOT NULL DEFAULT 1,
  photo_scale          INTEGER  NOT NULL DEFAULT 100,
  photo_overflow       SMALLINT NOT NULL DEFAULT 0,
  photo_offset_y       INTEGER  NOT NULL DEFAULT 0,
  name_bg_color        VARCHAR(20) DEFAULT '#000000',
  name_bg_opacity      INTEGER  NOT NULL DEFAULT 0,
  info_offset_y        INTEGER  NOT NULL DEFAULT 0,
  confirm_color        VARCHAR(20) DEFAULT '#22c55e',
  confirm_opacity      INTEGER  NOT NULL DEFAULT 22,
  -- พิกัด/ขนาดของแต่ละชิ้นบนการ์ด (ลากวางอิสระ) เก็บเป็น JSON string
  layout_json          TEXT
);

-- ฟอนต์หลักของการ์ด — เพิ่มทีหลัง เขียนแบบ IF NOT EXISTS ลงไฟล์เดิมได้
-- เพราะ migration รันซ้ำทุกครั้งที่สตาร์ท (ดูหัวไฟล์ database/migrate.js)
-- ค่าที่ยอมรับถูกจำกัดด้วย whitelist ฝั่ง server อีกชั้น (routes/reportSettings.js)
ALTER TABLE report_settings ADD COLUMN IF NOT EXISTS font_family VARCHAR(80) DEFAULT 'Prompt';

INSERT INTO report_settings (id, congrats_text, show_quote)
VALUES (1, 'ขอแสดงความยินดีกับความสำเร็จของน้องๆ ทุกคน', 1)
ON CONFLICT (id) DO NOTHING;

-- ─── report_student_settings — override รายคน (NULL = ใช้ค่ากลาง) ────────────
CREATE TABLE IF NOT EXISTS report_student_settings (
  student_code   VARCHAR(50) PRIMARY KEY,
  photo_scale    INTEGER,
  photo_offset_y INTEGER,
  photo_overflow SMALLINT,
  info_offset_y  INTEGER,
  layout_json    TEXT
);
