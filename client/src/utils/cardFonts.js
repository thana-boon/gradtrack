// ─── ฟอนต์ของการ์ดรายงาน ─────────────────────────────────────────────────────
// ทุกตัวในลิสต์ต้องมี glyph ไทยครบบน Google Fonts — ตัวที่ไม่มีจะ fallback เงียบ ๆ
// เป็นฟอนต์ระบบโดยไม่มีอะไรฟ้อง (การ์ดเพี้ยนทั้งรุ่นโดยไม่รู้ตัว) ห้ามเพิ่มชื่อโดยไม่เช็คก่อน
//
// ลิสต์นี้ทำหน้าที่เป็น whitelist ด้วย: ชื่อฟอนต์ถูกเอาไปต่อเป็น URL และแปะลง <style>
// ของแท็บพิมพ์ ค่านอกลิสต์ต้องตกเป็นค่า default เสมอ
// server/routes/reportSettings.js เก็บลิสต์ชื่อชุดเดียวกันไว้ตรวจซ้ำอีกชั้น — แก้ที่นี่แล้วแก้ที่นั่นด้วย
//
// weights = น้ำหนักที่ฟอนต์นั้นมีจริง (Charm/Charmonman/Srisakdi มีแค่ 400/700)
// ถ้าขอน้ำหนักที่ไม่มี เบราว์เซอร์จะสังเคราะห์ตัวหนาเอง ซึ่งออกมาไม่เหมือนกันในแต่ละเครื่อง
export const CARD_FONTS = [
  { id: 'Prompt',             note: 'เรียบ ทันสมัย (ค่าเริ่มต้น)', weights: [300, 400, 500, 600, 700] },
  { id: 'Kanit',              note: 'หนา อ่านเด่น',                weights: [300, 400, 500, 600, 700] },
  { id: 'Sarabun',            note: 'ทางการ แนวหนังสือราชการ',     weights: [300, 400, 500, 600, 700] },
  { id: 'IBM Plex Sans Thai', note: 'ฟอนต์เดียวกับหน้าจอระบบ',     weights: [300, 400, 500, 600, 700] },
  { id: 'Noto Sans Thai',     note: 'กลาง ๆ ปลอดภัยที่สุด',        weights: [300, 400, 500, 600, 700] },
  { id: 'Mitr',               note: 'มนกลม เป็นมิตร',              weights: [300, 400, 500, 600, 700] },
  { id: 'Bai Jamjuree',       note: 'คมเหลี่ยม',                   weights: [300, 400, 500, 600, 700] },
  { id: 'Chakra Petch',       note: 'เหลี่ยม แนวสปอร์ต',           weights: [300, 400, 500, 600, 700] },
  { id: 'K2D',                note: 'โค้งมน อ่านง่าย',             weights: [300, 400, 500, 600, 700] },
  { id: 'Athiti',             note: 'บาง โปร่ง',                   weights: [300, 400, 500, 600, 700] },
  { id: 'Niramit',            note: 'บาง อ่านสบายตา',              weights: [300, 400, 500, 600, 700] },
  { id: 'Pridi',              note: 'มีหัว ดูเป็นทางการ',          weights: [300, 400, 500, 600, 700] },
  { id: 'Trirong',            note: 'มีหัว มีเชิง คลาสสิก',        weights: [300, 400, 500, 600, 700] },
  { id: 'Charm',              note: 'ลายมือ อ่อนช้อย',             weights: [400, 700] },
  { id: 'Charmonman',         note: 'ลายมือหวัด',                  weights: [400, 700] },
  { id: 'Srisakdi',           note: 'ประดิษฐ์ เหมาะกับหัวเรื่อง',  weights: [400, 700] },
];

export const DEFAULT_CARD_FONT = 'Prompt';
export const CARD_FONT_IDS = CARD_FONTS.map(f => f.id);

const BY_ID = new Map(CARD_FONTS.map(f => [f.id, f]));

export const isCardFont = (name) => BY_ID.has(name);

/** นิยามของฟอนต์ (ชื่อไม่รู้จัก → ค่าเริ่มต้น) */
export const cardFont = (name) => BY_ID.get(name) || BY_ID.get(DEFAULT_CARD_FONT);

/** font-family ที่ใช้ได้จริง — มีตัวสำรองไทยเสมอ เผื่อไฟล์ฟอนต์โหลดไม่ได้ */
export const fontStack = (name) => `'${cardFont(name).id}', 'Noto Sans Thai', sans-serif`;

/** น้ำหนักที่ใกล้เคียงที่สุดที่ฟอนต์นั้นมีจริง */
export const nearestWeight = (name, weight) => {
  const list = cardFont(name).weights;
  const w = Number(weight) || 400;
  return list.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), list[0]);
};

const uniqueValid = (names) => [...new Set((names || []).filter(isCardFont))];

/** URL ของ Google Fonts สำหรับฟอนต์ชุดหนึ่ง (เรียงชื่อให้ URL คงที่ = แคชได้) */
export function googleFontsHref(names) {
  const list = uniqueValid(names);
  if (list.length === 0) return null;
  const families = [...list].sort().map(n => {
    const f = cardFont(n);
    return `family=${f.id.replace(/ /g, '+')}:wght@${f.weights.join(';')}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

// ฟอนต์ที่แปะ <link> ไปแล้ว → Promise ที่ resolve เมื่อ stylesheet นั้นโหลดเสร็จ
// ต้องรอจริง ๆ ไม่ใช่แค่ append: document.fonts.load('...Kanit') ที่ยิงก่อน @font-face ถูก register
// จะ resolve ทันทีด้วยลิสต์ว่าง (ไม่ใช่ error) แล้วภาพที่แคปได้กลายเป็นฟอนต์สำรองแบบเงียบ ๆ
const linkedFonts = new Map();

/**
 * แปะ <link> ของฟอนต์ที่ยังไม่มีในหน้า แล้วคืน Promise ที่รอจน stylesheet พร้อมใช้
 * ตัวที่ยังไม่เคยแปะจะถูกรวมเป็น <link> เดียว — เข้าหน้าครั้งแรกจึงยิงแค่รอบเดียว ไม่ใช่ 16 รอบ
 *
 * crossorigin="anonymous" จำเป็น: modern-screenshot ต้องอ่าน @font-face ใน stylesheet
 * เพื่อฝังฟอนต์ลงภาพ export — ถ้าเป็น opaque stylesheet มันอ่านไม่ได้ ภาพจะได้ฟอนต์ระบบแทน
 */
export function ensureFontLinks(names) {
  const list = uniqueValid(names);
  if (typeof document === 'undefined' || list.length === 0) return Promise.resolve();

  const missing = list.filter(n => !linkedFonts.has(n));
  if (missing.length > 0) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.crossOrigin = 'anonymous';
    link.href = googleFontsHref(missing);
    const ready = new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = () => {
        console.warn('โหลด stylesheet ฟอนต์ไม่สำเร็จ — การ์ดจะใช้ฟอนต์สำรอง:', missing.join(', '));
        resolve();
      };
      // กันแขวน: เน็ตโรงเรียนที่บล็อก fonts.googleapis.com จะไม่ยิง event ไหนเลย
      // ปล่อยให้เดินต่อด้วยฟอนต์สำรอง ดีกว่าค้างจนกดอะไรไม่ได้
      setTimeout(resolve, 8000);
    });
    for (const n of missing) linkedFonts.set(n, ready);
    document.head.appendChild(link);
  }

  return Promise.all(list.map(n => linkedFonts.get(n))).then(() => undefined);
}

/**
 * รอให้ฟอนต์พร้อมใช้จริงก่อนแคปภาพ / ก่อน print
 *
 * document.fonts.ready รอเฉพาะไฟล์ที่ "กำลังโหลดอยู่" — ถ้ายังไม่มีข้อความไหนบนจอใช้ฟอนต์นั้น
 * มันจะ resolve ทันทีแล้วภาพที่ได้เป็นฟอนต์ระบบ จึงต้อง fonts.load() สั่งโหลดตรง ๆ ก่อน
 * และต้องสั่งด้วยอักขระไทยด้วย เพราะ Google Fonts แยกไฟล์ตาม unicode-range
 * (ขอด้วย 'ABC' เฉย ๆ จะได้มาแต่ subset ละติน ตัวไทยยังหายอยู่ดี)
 */
export async function loadCardFonts(names) {
  const list = uniqueValid(names);
  if (list.length === 0) return;
  await ensureFontLinks(list);
  const jobs = [];
  for (const name of list) {
    for (const w of cardFont(name).weights) {
      jobs.push(
        document.fonts.load(`${w} 22px '${name}'`, 'กขคง ABC 123')
          .catch(err => console.warn(`โหลดฟอนต์ ${name} ${w} ไม่สำเร็จ — ภาพจะใช้ฟอนต์สำรอง`, err))
      );
    }
  }
  await Promise.all(jobs);
  await document.fonts.ready;
}

/** ฟอนต์ทั้งหมดที่การ์ดใช้อยู่จริง = ฟอนต์หลัก + ฟอนต์ที่ตั้งแยกรายชิ้น (ค่ากลาง + รายคน) */
export function fontsInUse(settings, overrides) {
  const set = new Set([settings?.font_family || DEFAULT_CARD_FONT]);
  const collect = (layout) => {
    for (const box of Object.values(layout || {})) if (box?.font) set.add(box.font);
  };
  collect(settings?.layout);
  for (const ov of Object.values(overrides || {})) collect(ov?.layout);
  return uniqueValid([...set]);
}
