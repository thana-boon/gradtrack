import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { domToCanvas } from 'modern-screenshot';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import api from '../../utils/api';
import { absoluteBase } from '../../utils/withBase';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import SearchableSelect from '../../components/SearchableSelect';
import Icon from '../../components/ui/Icon';
import { PageHeader } from '../../components/ui';

// ─── Layout engine (left column only, 1 or 2 cols, up to 20 unis) ─────────────
// count = จำนวนกล่องมหาวิทยาลัย, rows = จำนวนบรรทัดคณะทั้งหมด (คนที่ยื่นหลายคณะในมหาวิทยาลัยเดียว
// กินที่แนวตั้งเพิ่มด้วย ถ้านับแต่ count ขนาดที่เลือกจะใหญ่เกินจนล้นกล่อง)
function getUniLayout(count, rows = count) {
  if (count === 0) return {};
  // แถวคณะที่เกินมาถูกกว่ากล่องใหม่ (ไม่มีตรา/ขอบ/padding) — ตีเป็น ~0.6 กล่อง
  const n = count + Math.max(0, rows - count) * 0.6;
  if (n <= 4)  return { cols: 1, logo: 80,  uni: 22, fac: 16, prog: 13, pad: '14px 18px', gap: 12 };
  if (n <= 6)  return { cols: 1, logo: 64,  uni: 18, fac: 14, prog: 11, pad: '10px 14px', gap: 9  };
  if (n <= 10) return { cols: 1, logo: 52,  uni: 15, fac: 12, prog: 10, pad: '8px 12px',  gap: 7  };
  // >10: switch to 2 columns to use vertical space efficiently
  if (n <= 14) return { cols: 2, logo: 44,  uni: 13, fac: 11, prog: 9,  pad: '7px 10px',  gap: 6  };
  return           { cols: 2, logo: 36,  uni: 11, fac: 10, prog: 8,  pad: '5px 8px',   gap: 5  };
}

// ─── Free-layout: ตำแหน่ง/ขนาดของแต่ละชิ้นบน canvas 1080×1080 (ลากวาง+ปรับขนาดได้เหมือน Word) ─
// แต่ละชิ้นเก็บ { x, y, w, scale }  (รูปใช้ w แล้วสูง = w×1.5)
export const LAYOUT_ELEMENTS = ['logo', 'school', 'congrats', 'photo', 'name'];
export const LAYOUT_LABELS = {
  logo: 'โลโก้โรงเรียน', school: 'ชื่อโรงเรียน', congrats: 'ข้อความยินดี',
  photo: 'รูปนักเรียน', name: 'ชื่อนักเรียน',
};
// ค่าเริ่มต้น — วางให้ใกล้เคียงเลย์เอาต์เดิม (โลโก้มุมบนซ้าย, ข้อความบนกลาง, รูป+ชื่อฝั่งขวา)
export const DEFAULT_LAYOUT = {
  logo:     { x: 28,  y: 24,  w: 96,  scale: 1 },
  school:   { x: 140, y: 30,  w: 800, scale: 1 },
  congrats: { x: 110, y: 86,  w: 860, scale: 1 },
  photo:    { x: 700, y: 355, w: 240, scale: 1 },
  name:     { x: 610, y: 735, w: 430, scale: 1 },
};
export const PHOTO_ASPECT = 1.5; // สูง = กว้าง × 1.5 (คงสัดส่วน 240×360 เดิม)
// กล่องรายชื่อมหาวิทยาลัยฝั่งซ้าย — คงระบบ auto-layout เดิม (ไม่ลากอิสระ)
export const UNI_BOX = { x: 56, y: 250, w: 560, h: 620 };

// layout_json จาก DB เป็น string → object (พังก็คืน {} = ใช้ default)
export function parseLayoutJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

// รวม DEFAULT ← ค่ากลาง ← ค่าเฉพาะคน (ทีละชิ้น)
export function mergeLayout(central, override) {
  const out = {};
  for (const k of LAYOUT_ELEMENTS) {
    out[k] = { ...DEFAULT_LAYOUT[k], ...(central?.[k] || {}), ...(override?.[k] || {}) };
  }
  return out;
}

// ─── การตั้งค่าที่แยกรายคนได้ (รูปนักเรียนแต่ละคนมาไม่เหมือนกัน) ────────────────
export const PER_STUDENT_KEYS = ['photo_scale', 'photo_offset_y', 'photo_overflow', 'info_offset_y'];

// รหัสนักเรียนบางที่ pad 0 นำหน้า บางที่ไม่ pad — normalize ให้ตรงกับฝั่ง server
export const normCode = (c) => {
  const n = parseInt(c, 10);
  return Number.isNaN(n) ? String(c ?? '') : String(n);
};

// รวมค่ากลาง + ค่าเฉพาะคน (null/undefined ใน override = ใช้ค่ากลาง)
export function mergeStudentSettings(settings, override) {
  // layout รวมเสมอ (DEFAULT ← กลาง ← เฉพาะคน) เพื่อให้ StudentCard ได้พิกัดครบทุกชิ้น
  const out = { ...settings, layout: mergeLayout(settings.layout, override?.layout) };
  if (!override) return out;
  for (const k of PER_STUDENT_KEYS) {
    if (override[k] !== null && override[k] !== undefined) out[k] = override[k];
  }
  return out;
}

// แปลง hex (#rgb / #rrggbb) → rgba ตามค่าความทึบ (0–100)
function hexToRgba(hex, opacityPct) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(100, Math.max(0, opacityPct)) / 100})`;
}

// ─── StudentCard ─────────────────────────────────────────────────────────────
export function StudentCard({ student, settings, yearName, quoteApproved = true }) {
  const confirmedUni = student.admissions?.find(a => a.confirmed);
  const allAdmissions = student.admissions || [];

  // Group admissions by university
  const grouped = Object.values(
    allAdmissions.reduce((acc, a) => {
      const key = `${a.university_id || a.university_name}_${a.campus || ''}`;
      if (!acc[key]) acc[key] = { ...a, entries: [] };
      acc[key].entries.push({ faculty_name: a.faculty_name, program_name: a.program_name, confirmed: a.confirmed });
      if (a.confirmed) acc[key].groupConfirmed = true;
      return acc;
    }, {})
  ).sort((a, b) => {
    if (a.groupConfirmed && !b.groupConfirmed) return -1;
    if (!a.groupConfirmed && b.groupConfirmed) return 1;
    return (a.university_name || '').localeCompare(b.university_name || '', 'th');
  });

  // จำนวนบรรทัดคณะทั้งหมด — ใช้เลือกขนาดเริ่มต้นให้ใกล้เคียงของจริงกว่าการนับแค่มหาวิทยาลัย
  const rowCount = grouped.reduce((n, g) => n + Math.max(1, g.entries.length), 0);
  const L = getUniLayout(grouped.length, rowCount);

  // ── กันล้น: วัดความสูงจริงหลังเรนเดอร์ แล้วย่อทั้งบล็อกให้พอดี UNI_BOX ──
  // ตารางขนาดด้านบนเป็นค่าประมาณ (ชื่อมหาวิทยาลัย/คณะยาวไม่เท่ากัน ตัดบรรทัดไม่เท่ากัน)
  // จึงต้องมีตัววัดจริงปิดท้าย ไม่งั้นหัว-ท้ายรายการโดน overflow:hidden เฉือน
  // เขียน transform ลง DOM ตรงๆ (ไม่ผ่าน state) — export เก็บภาพจาก DOM จริง จึงไม่ต้องรอ re-render
  const uniInnerRef = useRef(null);
  useLayoutEffect(() => {
    const el = uniInnerRef.current;
    if (!el) return;
    const measure = () => {
      // transform: scale ไม่กระทบ layout box → ค่าที่วัดได้เป็นความสูงเต็มเสมอ (ไม่ย่อซ้ำ)
      const h = el.scrollHeight;
      el.style.transform = h > UNI_BOX.h ? `scale(${UNI_BOX.h / h})` : '';
    };
    measure();
    // ฟอนต์ไทยโหลดช้ากว่า first paint → ความสูงเปลี่ยนทีหลัง ต้องวัดซ้ำ
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const textColor = settings.text_color || '#ffffff';
  const showFrame = settings.show_photo_frame === undefined ? true : !!settings.show_photo_frame;
  const photoZoom = (Number(settings.photo_scale) || 100) / 100;
  const allowOverflow = !!settings.photo_overflow;
  const photoOffsetY = Number(settings.photo_offset_y) || 0;
  const nameBgOpacity = Number(settings.name_bg_opacity) || 0;
  const nameBg = nameBgOpacity > 0 ? hexToRgba(settings.name_bg_color, nameBgOpacity) : 'transparent';
  const infoOffsetY = Number(settings.info_offset_y) || 0;
  const confirmColor = settings.confirm_color || '#22c55e';
  const confirmOpacity = Number.isFinite(Number(settings.confirm_opacity)) ? Number(settings.confirm_opacity) : 22;
  const confirmBg = hexToRgba(confirmColor, confirmOpacity);
  const confirmBorder = hexToRgba(confirmColor, 80);

  const fullName = `${student.title_prefix || ''}${student.first_name || ''} ${student.last_name || ''}`;
  const nameFontSize = fullName.length <= 18 ? 38
    : fullName.length <= 22 ? 32
    : fullName.length <= 27 ? 27
    : fullName.length <= 33 ? 23
    : fullName.length <= 40 ? 19
    : fullName.length <= 48 ? 16
    : 14;

  // ── พิกัด/ขนาดแต่ละชิ้น (เติม default ให้ครบเสมอ) ──
  const LO = mergeLayout(settings.layout, null);
  const photoW = LO.photo.w;
  const photoH = photoW * PHOTO_ASPECT;

  return (
    <div style={{
      width: 1080,
      height: 1080,
      position: 'relative',
      overflow: 'hidden',
      fontFamily: "'Prompt', 'Noto Sans Thai', sans-serif",
      background: '#0f0c29',
      color: textColor,
      boxSizing: 'border-box',
    }}>
      {/* Background image — background-image (cover) แทน object-fit กัน html2canvas ยืดภาพ */}
      {settings.background_image_url && (
        <div
          style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${resolveMediaUrl(settings.background_image_url)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            zIndex: 0,
          }}
        />
      )}

      {/* School Logo — ลากวาง/ปรับขนาดได้ */}
      {/* ใช้ background-image (contain) แทน <img object-fit> — html2canvas 1.4.1 ตี object-fit เป็น fill ทำให้ตรายืด */}
      {settings.school_logo_url && (
        <div
          style={{
            position: 'absolute', left: LO.logo.x, top: LO.logo.y,
            width: LO.logo.w, height: LO.logo.w,
            backgroundImage: `url(${resolveMediaUrl(settings.school_logo_url)})`,
            backgroundSize: 'contain',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            zIndex: 4,
          }}
        />
      )}

      {/* School Name — ลากวาง/ปรับขนาดได้ */}
      {settings.school_name && (
        <div style={{
          position: 'absolute', left: LO.school.x, top: LO.school.y, width: LO.school.w,
          fontSize: 30 * LO.school.scale, fontWeight: 700, textAlign: 'center',
          opacity: 0.97, lineHeight: 1.35, zIndex: 3,
        }}>
          {settings.school_name}
        </div>
      )}

      {/* Congrats text + divider — ลากวาง/ปรับขนาดได้ (ย้ายพร้อมกัน) */}
      {settings.congrats_text && (
        <div style={{
          position: 'absolute', left: LO.congrats.x, top: LO.congrats.y, width: LO.congrats.w,
          textAlign: 'center', zIndex: 3,
        }}>
          <div style={{ fontSize: 22 * LO.congrats.scale, opacity: 0.9, lineHeight: 1.55 }}>
            {settings.congrats_text}
          </div>
          <div style={{ width: '50%', height: 1, background: `${textColor}4d`, margin: '12px auto 0' }} />
        </div>
      )}

      {/* Photo — ลากวาง/ปรับขนาดได้ */}
      <div style={{
        position: 'absolute', left: LO.photo.x, top: LO.photo.y,
        width: photoW, height: photoH,
        borderRadius: showFrame ? 20 : 0,
        overflow: allowOverflow ? 'visible' : 'hidden',
        clipPath: allowOverflow ? undefined : `inset(0 round ${showFrame ? 20 : 0}px)`,
        border: showFrame ? `4px solid ${textColor}dd` : 'none',
        background: showFrame && !allowOverflow ? '#555' : 'transparent',
        boxSizing: 'border-box',
        zIndex: 1,
      }}>
        {student.photo_url
          ? allowOverflow
            ? <img
                src={resolveMediaUrl(student.photo_url)}
                crossOrigin="anonymous"
                alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', transform: `translateY(${photoOffsetY}px) scale(${photoZoom})`, transformOrigin: 'center top', zIndex: -1 }}
              />
            : <div
                style={{
                  position: 'absolute', inset: 0,
                  backgroundImage: `url(${resolveMediaUrl(student.photo_url)})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center top',
                  backgroundRepeat: 'no-repeat',
                  transform: `translateY(${photoOffsetY}px) scale(${photoZoom})`,
                  transformOrigin: 'center top',
                }}
              />
          : (
            // ไม่มีรูป → วาง silhouette เส้น (SVG) ไม่ใช้ emoji เพราะ emoji จะติดลงไปในภาพ export
            // แล้วหน้าตาไม่เหมือนกันในแต่ละเครื่อง
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="user" size={140} strokeWidth={1.2} style={{ color: 'rgba(255,255,255,0.28)' }} />
            </div>
          )
        }
      </div>

      {/* Name + Quote + กล่องยืนยัน — ลากวาง/ปรับขนาดได้ (info_offset_y = nudge ละเอียดเพิ่ม) */}
      <div style={{
        position: 'absolute', left: LO.name.x, top: LO.name.y + infoOffsetY, width: LO.name.w,
        textAlign: 'center', zIndex: 3,
        transform: `scale(${LO.name.scale})`, transformOrigin: 'top center',
      }}>
        {/* Name */}
        <div style={{
          display: 'inline-block',
          fontSize: nameFontSize, fontWeight: 700, textAlign: 'center', lineHeight: 1.3, color: textColor,
          background: nameBg,
          padding: nameBgOpacity > 0 ? '8px 22px' : 0,
          borderRadius: nameBgOpacity > 0 ? 14 : 0,
          maxWidth: '100%', boxSizing: 'border-box',
          whiteSpace: 'nowrap',
        }}>
          {fullName}
        </div>

        {/* Quote */}
        {!!settings.show_quote && !!student.quote && quoteApproved && (
          <div style={{
            fontSize: 18, fontStyle: 'italic', textAlign: 'center',
            opacity: 0.75, lineHeight: 1.6, maxWidth: 360, margin: '14px auto 0',
          }}>
            "{student.quote}"
          </div>
        )}

        {/* Confirmed badge */}
        {confirmedUni && (
          <div style={{
            background: confirmBg,
            border: `2px solid ${confirmBorder}`,
            borderRadius: 14, padding: '12px 16px',
            textAlign: 'center', width: '100%', boxSizing: 'border-box', marginTop: 14,
          }}>
            <div style={{
              fontSize: 13, opacity: 0.85, marginBottom: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              <Icon name="check" size={14} strokeWidth={2.6} />
              ยืนยันสิทธิ์
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
              {confirmedUni.university_name}
            </div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 3 }}>
              {confirmedUni.faculty_name}
            </div>
          </div>
        )}
      </div>

      {/* Universities — กล่องฝั่งซ้าย คงระบบ auto-layout เดิม (ไม่ลากอิสระ) */}
      <div style={{
        position: 'absolute', left: UNI_BOX.x, top: UNI_BOX.y, width: UNI_BOX.w, height: UNI_BOX.h,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        minHeight: 0, overflow: 'hidden', zIndex: 2,
      }}>
            {grouped.length > 0 && (
              <>
                <div ref={uniInnerRef} style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${L.cols}, 1fr)`,
                  gap: L.gap,
                  alignContent: 'center',
                  // transform ถูกเซ็ตโดย useLayoutEffect ด้านบนเมื่อเนื้อหาสูงเกินกล่อง
                  transformOrigin: 'center center',
                }}>
                  {grouped.map(g => {
                    const isOne      = grouped.length === 1;
                    const isVertical = grouped.length < 3;
                    const logoSize   = isOne ? 200 : isVertical ? 120 : L.logo;
                    const uniSize    = isOne ? L.uni + 12 : isVertical ? L.uni + 4 : L.uni;
                    const facSize    = isOne ? L.fac + 8  : isVertical ? L.fac + 2 : L.fac;
                    const progSize   = isOne ? L.prog + 6 : isVertical ? L.prog + 2 : L.prog;
                    const isConfirmed = !!g.groupConfirmed;
                    return (
                      <div key={g.university_id || g.university_name} style={{
                        background: isConfirmed ? confirmBg : 'rgba(255,255,255,0.1)',
                        border: isConfirmed ? `1.5px solid ${confirmBorder}` : '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 12,
                        padding: L.pad,
                        display: 'flex',
                        flexDirection: isVertical ? 'column' : 'row',
                        alignItems: isVertical ? 'center' : 'flex-start',
                        gap: isOne ? 20 : isVertical ? 14 : 10,
                        boxSizing: 'border-box',
                      }}>
                        {g.logo_url && (
                          <div
                            style={{
                              width: logoSize, height: logoSize, flexShrink: 0,
                              backgroundImage: `url(${resolveMediaUrl(g.logo_url)})`,
                              backgroundSize: 'contain',
                              backgroundPosition: 'center',
                              backgroundRepeat: 'no-repeat',
                            }}
                          />
                        )}
                        <div style={{ flex: isVertical ? undefined : 1, minWidth: 0, textAlign: isVertical ? 'center' : 'left' }}>
                          <div style={{ fontSize: uniSize, fontWeight: 700, lineHeight: 1.25, marginBottom: 6 }}>
                            {g.university_name}{g.campus ? ` (${g.campus})` : ''}
                          </div>
                          {g.entries.map((e, i) => (
                            <div key={i} style={{
                              marginTop: i > 0 ? 8 : 0,
                              paddingTop: i > 0 ? 8 : 0,
                              borderTop: i > 0 ? `1px solid ${textColor}22` : 'none',
                            }}>
                              <div style={{ fontSize: facSize, opacity: 0.85, lineHeight: 1.3, marginBottom: 1 }}>
                                {e.faculty_name}
                                {!!e.confirmed && <span style={{ marginLeft: 6, fontSize: facSize - 2, color: 'rgba(74,222,128,0.9)' }}>✓</span>}
                              </div>
                              <div style={{ fontSize: progSize, opacity: 0.62, lineHeight: 1.2 }}>
                                {e.program_name}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
      </div>
    </div>
  );
}

// ─── DragResizeBox: กล่องลากวาง+ปรับขนาด 1 ชิ้น (วางทับ preview) ───────────────
// พิกัดที่รับ/ส่งเป็น canvas px (1080 ฐาน) — คูณ scale เฉพาะตอนวาด/หารตอนคำนวณ delta
const round2 = (v) => Math.round(v * 100) / 100;
function DragResizeBox({ x, y, w, h, scale, curScale, label, selected, overridden, resizeMode, onSelect, onChange, onReset }) {
  const drag = useRef(null);

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.sx) / scale;
    const dy = (e.clientY - drag.current.sy) / scale;
    if (drag.current.type === 'move') {
      onChange({ x: Math.round(drag.current.ox + dx), y: Math.round(drag.current.oy + dy) });
    } else {
      const newW = Math.max(24, Math.round(drag.current.ow + dx));
      const patch = { w: newW };
      // text = ขยายกล่อง+ฟอนต์พร้อมกัน (เหมือนลากมุมกล่องข้อความใน Word)
      if (resizeMode === 'text') patch.scale = round2(drag.current.os * (newW / drag.current.ow));
      onChange(patch);
    }
  };
  const endDrag = (e) => {
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const startMove = (e) => {
    e.stopPropagation();
    onSelect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { type: 'move', sx: e.clientX, sy: e.clientY, ox: x, oy: y };
  };
  const startResize = (e) => {
    e.stopPropagation();
    onSelect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { type: 'resize', sx: e.clientX, sy: e.clientY, ow: w, os: curScale };
  };

  const handleSize = 14;
  return (
    <div
      onPointerDown={startMove}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        position: 'absolute',
        left: x * scale, top: y * scale,
        width: Math.max(w, 24) * scale, height: Math.max(h, 24) * scale,
        boxSizing: 'border-box',
        border: selected ? '2px solid #3b82f6' : '1.5px dashed rgba(59,130,246,0.55)',
        background: selected ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.03)',
        borderRadius: 4,
        cursor: 'move',
        touchAction: 'none',
        zIndex: selected ? 20 : 10,
      }}
    >
      {/* ป้ายชื่อชิ้น */}
      <div style={{
        position: 'absolute', top: -20, left: -2,
        fontSize: 10, lineHeight: '16px', whiteSpace: 'nowrap',
        padding: '0 6px', borderRadius: 4,
        background: selected ? '#5b2d8e' : 'rgba(91,45,142,0.78)', color: '#fff',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        {label}
        {overridden && <Icon name="star" size={9} strokeWidth={2.4} style={{ color: '#F5C518' }} />}
      </div>

      {selected && onReset && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onReset(); }}
          title="รีเซ็ตตำแหน่ง/ขนาดชิ้นนี้"
          aria-label="รีเซ็ตตำแหน่งและขนาดของชิ้นนี้"
          style={{
            position: 'absolute', top: -20, right: -2,
            lineHeight: 0, padding: '3px 5px', borderRadius: 4,
            background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer',
          }}
        >
          <Icon name="refresh" size={11} strokeWidth={2.2} />
        </button>
      )}

      {/* จุดปรับขนาด มุมล่างขวา */}
      <div
        onPointerDown={startResize}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'absolute', right: -handleSize / 2, bottom: -handleSize / 2,
          width: handleSize, height: handleSize,
          background: '#fff', border: '2px solid #3b82f6', borderRadius: 3,
          cursor: 'nwse-resize', touchAction: 'none',
          display: selected ? 'block' : 'none',
        }}
      />
    </div>
  );
}

// ─── ReportPage ───────────────────────────────────────────────────────────────
export default function ReportPage() {
  const [settings, setSettings] = useState({ congrats_text: '', show_quote: true, background_image_url: null, school_name: '', school_logo_url: null, text_color: '#ffffff', show_photo_frame: true, photo_scale: 100, photo_overflow: false, photo_offset_y: 0, name_bg_color: '#000000', name_bg_opacity: 0, info_offset_y: 0, confirm_color: '#22c55e', confirm_opacity: 22, layout: {} });
  const [editLayout, setEditLayout] = useState(false);   // เปิด modal จัดวางอิสระ
  const [selectedEl, setSelectedEl] = useState(null);    // ชิ้นที่เลือกอยู่ในโหมดลากวาง
  const [modalScale, setModalScale] = useState(0.55);    // สเกล preview ใน modal (คำนวณให้พอดีจอ)
  // ค่าเฉพาะรายคน: { [normCode]: { photo_scale, photo_offset_y, photo_overflow, info_offset_y } }
  const [overrides, setOverrides] = useState({});
  const [dirtyCodes, setDirtyCodes] = useState(new Set());
  const [perStudent, setPerStudent] = useState(false);
  const [students, setStudents] = useState([]);
  const [yearId, setYearId] = useState('');
  const [yearName, setYearName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [approvedQuotes, setApprovedQuotes] = useState(new Set());
  const [quoteSearch, setQuoteSearch] = useState('');
  const [bgUploading, setBgUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const bgInputRef = useRef(null);
  const logoInputRef = useRef(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load settings + year + students
  useEffect(() => {
    Promise.all([
      api.get('/report-settings'),
      api.get('/academic-years'),
      api.get('/academic-years/active').then(r => r.data || null).catch(() => null),
      api.get('/report-settings/students').then(r => r.data || {}).catch((err) => {
        // แยกแยะ: endpoint ไม่มีบน server (ยังไม่ deploy) vs ปัญหาอื่น
        console.error('โหลดค่าเฉพาะรายคนไม่สำเร็จ', err);
        showToast('โหลดค่าเฉพาะรายคนไม่สำเร็จ — server อาจยังไม่อัปเดต', 'error');
        return {};
      }),
    ]).then(([sRes, yRes, activeRes, ovRes]) => {
      const s = sRes.data || { congrats_text: '', show_quote: true, background_image_url: null };
      setSettings({ ...s, layout: parseLayoutJson(s.layout_json) });
      // แปลง layout_json ของแต่ละคน string → object
      const ov = {};
      for (const [code, row] of Object.entries(ovRes || {})) {
        ov[code] = { ...row, layout: parseLayoutJson(row.layout_json) };
      }
      setOverrides(ov);
      const years = yRes.data || [];
      if (activeRes?.active_year_id) {
        const active = years.find(y => String(y.id) === String(activeRes.active_year_id)) || activeRes.year;
        setYearId(String(activeRes.active_year_id));
        setYearName(String(active?.year_be || active?.title || active?.name || ''));
      } else if (years.length > 0) {
        setYearId(String(years[0].id));
        setYearName(String(years[0].year_be || years[0].title || years[0].name || ''));
      }
    });
  }, []);

  useEffect(() => {
    if (!yearId) return;
    setLoading(true);
    api.get('/student/admin/admission-overview', { params: { year_id: yearId } })
      .then(r => {
        const withAdmissions = (r.data || []).filter(s => s.admissions.length > 0);
        setStudents(withAdmissions);
        setApprovedQuotes(new Set(withAdmissions.map(s => s.student_code)));
        setPreviewIndex(0);
      })
      .finally(() => setLoading(false));
  }, [yearId]);

  const saveSettings = async () => {
    setSaving(true);
    const codes = [...dirtyCodes];
    try {
      await api.put('/report-settings', {
        congrats_text: settings.congrats_text,
        show_quote: settings.show_quote,
        school_name: settings.school_name,
        text_color: settings.text_color,
        show_photo_frame: settings.show_photo_frame,
        photo_scale: settings.photo_scale,
        photo_overflow: settings.photo_overflow,
        photo_offset_y: settings.photo_offset_y,
        name_bg_color: settings.name_bg_color,
        name_bg_opacity: settings.name_bg_opacity,
        info_offset_y: settings.info_offset_y,
        confirm_color: settings.confirm_color,
        confirm_opacity: settings.confirm_opacity,
        layout_json: JSON.stringify(settings.layout || {}),
      });
      // เซฟค่าเฉพาะรายคน — เก็บผลรายตัวเพื่อรู้ว่ามีอันไหน fail
      const results = await Promise.allSettled(
        codes.map(code => {
          const ov = overrides[code] || {};
          // แยก layout object → layout_json string (ไม่ส่ง field layout ดิบ)
          const { layout, ...rest } = ov;
          return api.put(`/report-settings/students/${code}`, {
            ...rest,
            layout_json: layout && Object.keys(layout).length > 0 ? JSON.stringify(layout) : null,
          });
        })
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.error('บันทึกค่าเฉพาะรายคนไม่สำเร็จ', failed.map(f => f.reason));
        // เอาเฉพาะที่ fail กลับเข้า dirty เพื่อให้กดเซฟซ้ำได้ ที่สำเร็จเอาออก
        const failedCodes = new Set(codes.filter((_, i) => results[i].status === 'rejected'));
        setDirtyCodes(failedCodes);
        showToast(`บันทึกค่ากลางแล้ว แต่ค่าเฉพาะรายคน ${failed.length} คนไม่สำเร็จ`, 'error');
      } else {
        setDirtyCodes(new Set());
        showToast(codes.length > 0 ? `บันทึกสำเร็จ (รวมเฉพาะคน ${codes.length} คน)` : 'บันทึกสำเร็จ');
      }
    } catch (err) {
      console.error('บันทึกการตั้งค่าไม่สำเร็จ', err);
      showToast('บันทึกไม่สำเร็จ — ตรวจสอบการเชื่อมต่อ / สิทธิ์ผู้ใช้', 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadBg = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgUploading(true);
    try {
      const form = new FormData();
      form.append('bg', file);
      const r = await api.post('/report-settings/background', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSettings(prev => ({ ...prev, background_image_url: r.data.url }));
    } finally {
      setBgUploading(false);
      e.target.value = '';
    }
  };

  const removeBg = async () => {
    await api.delete('/report-settings/background');
    setSettings(prev => ({ ...prev, background_image_url: null }));
  };

  const uploadSchoolLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const form = new FormData();
      form.append('logo', file);
      const r = await api.post('/report-settings/school-logo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSettings(prev => ({ ...prev, school_logo_url: r.data.url }));
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const removeSchoolLogo = async () => {
    await api.delete('/report-settings/school-logo');
    setSettings(prev => ({ ...prev, school_logo_url: null }));
  };

  // ── Export helpers ──
  // ── กัน export ค้างเมื่อจอดับ / แท็บถูกซ่อน ────────────────────────────────
  // เบราว์เซอร์หยุดยิง requestAnimationFrame และหน่วง setTimeout (แย่สุด 1 ครั้ง/นาที)
  // ทันทีที่แท็บไม่ได้อยู่หน้าจอ ลูป export ที่ "รอเฟรม" จึงค้างกลางคัน
  // แก้ 2 ทาง: ขอ wake lock กันจอดับ + ไม่ผูกลูปกับเฟรมอีกต่อไป (ดู renderCardCanvas)
  //
  // ถือ wake lock ไว้ตลอดช่วงที่ยัง export อยู่ แล้วปล่อยเองเมื่อจบ (ผูกกับ exporting ที่เดียว
  // จะได้ไม่ต้องไล่ปล่อยในทุก export ฟังก์ชัน) — ระบบปล่อย lock ทิ้งเองทุกครั้งที่แท็บถูกซ่อน
  // จึงต้องขอคืนเมื่อผู้ใช้กลับมาดู
  useEffect(() => {
    if (!exporting) return;
    let lock = null;
    let stopped = false;
    const acquire = async () => {
      // ขอได้เฉพาะตอนแท็บโชว์อยู่ (สเปกบังคับ) — เบราว์เซอร์ไม่รองรับ/ผู้ใช้ปฏิเสธก็ข้ามไป
      if (lock || document.visibilityState !== 'visible') return;
      try {
        const l = (await navigator.wakeLock?.request('screen')) || null;
        if (stopped) l?.release?.().catch(() => {});
        else lock = l;
      } catch { /* ไม่มี wake lock ก็ export ได้ แค่เสี่ยงจอดับ */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, [exporting]);

  // รอเฟรมเฉพาะตอนแท็บโชว์อยู่ (เผื่อ ResizeObserver วัดความสูงซ้ำ) — ถ้าถูกซ่อนก็ไม่มีเฟรมให้รอ ข้ามเลย
  const waitFrameIfVisible = () => new Promise(resolve => {
    if (document.visibilityState !== 'visible') return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 300); // กันเหนียวเผื่อผู้ใช้สลับแท็บระหว่างรอ
  });

  // ── แท็บพรีวิว PDF ────────────────────────────────────────────────────────
  // เปิดแท็บว่างพร้อมหน้ารอ ต้องเรียกทันทีที่กดปุ่ม (ก่อน await ตัวแรก)
  // ไม่งั้น popup blocker ตัดทิ้ง เพราะกว่า PDF จะสร้างเสร็จ user gesture ก็หมดอายุแล้ว
  const openPendingPdfTab = () => {
    const win = window.open('', '_blank');
    if (!win) return null;
    win.document.write(`<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8"><title>กำลังสร้าง PDF...</title>
<style>
  html,body{height:100%;margin:0;background:#1a102a;color:#fff;
    font-family:'Prompt','Noto Sans Thai',system-ui,sans-serif;}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;}
  .ring{width:46px;height:46px;border-radius:50%;border:4px solid rgba(255,255,255,.18);
    border-top-color:#F5C518;animation:spin 1s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{margin:0;font-size:16px}
  #pct{font-size:14px;opacity:.7;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="ring"></div><p>กำลังสร้าง PDF...</p><p id="pct">0%</p>
</body></html>`);
    win.document.close();
    return win;
  };

  const setPdfTabProgress = (win, pct) => {
    try {
      const el = win?.document?.getElementById('pct');
      if (el) el.textContent = `${pct}%`;
    } catch { /* แท็บถูกปิดไปแล้ว — ไม่ต้องทำอะไร */ }
  };

  // ส่ง PDF ที่สร้างเสร็จเข้าแท็บที่เปิดรอไว้ — ดูตัวอย่างก่อน แล้วค่อยกดเซฟ/พิมพ์จากตัวอ่าน PDF ของเบราว์เซอร์
  const showPdfInTab = (win, doc, filename) => {
    doc.setProperties({ title: filename.replace(/\.pdf$/i, '') });
    const blob = doc.output('blob');
    if (!win || win.closed) { // ผู้ใช้ปิดแท็บพรีวิวระหว่างรอ — เซฟเป็นไฟล์แทนดีกว่าทิ้งงานที่สร้างเสร็จแล้ว
      saveAs(blob, filename);
      showToast('แท็บพรีวิวถูกปิดไปแล้ว — บันทึกเป็นไฟล์แทน');
      return;
    }
    const url = URL.createObjectURL(blob);
    win.location.replace(url);
    // ปล่อย blob ทีหลัง — revoke เร็วกว่านี้แท็บพรีวิวจะโหลดไม่ทัน
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  };

  // รอฟอนต์การ์ดให้พร้อมจริงก่อนแคปภาพ
  // document.fonts.ready รอเฉพาะไฟล์ที่ "กำลังโหลดอยู่" — ถ้ายังไม่มีอะไรบนจอใช้ Prompt มันจะ resolve ทันที
  // แล้วภาพที่ได้จะเป็นฟอนต์ระบบ. อีกอย่าง Google Fonts แยกไฟล์ตาม unicode-range ต้องสั่งด้วยตัวอักษรไทย
  // ไม่งั้นได้มาแต่ subset ละติน
  const ensureCardFonts = async () => {
    try {
      await Promise.all([
        document.fonts.load('400 22px Prompt', 'กขค ABC'),
        document.fonts.load('700 22px Prompt', 'กขค ABC'),
      ]);
    } catch (err) {
      console.warn('โหลดฟอนต์ Prompt ไม่สำเร็จ — ภาพที่ได้จะใช้ฟอนต์สำรอง', err);
    }
    await document.fonts.ready;
  };

  // Preload all image URLs before html2canvas
  const preloadImages = async (urls) => {
    await Promise.all(
      urls.filter(Boolean).map(
        url => new Promise(resolve => {
          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.onload = resolve;
          img.onerror = resolve;
          img.src = url;
        })
      )
    );
  };

  // เรนเดอร์การ์ดนักเรียน 1 ใบ → <canvas> (ใช้ร่วมกันทั้ง ZIP และ PDF)
  // scale = ความละเอียด (2 = คมขึ้น 2 เท่า, ช่วยให้ตราไม่มัว)
  const renderCardCanvas = async (student, scale = 2) => {
    // preload รูปเฉพาะคนนี้ก่อน (ทีละคน กัน server โดนยิงรูปพร้อมกันทีเดียว)
    await preloadImages([
      resolveMediaUrl(student.photo_url),
      ...(student.admissions || []).map(a => resolveMediaUrl(a.logo_url)),
    ]);

    // วางที่มุมซ้ายบนให้ html2canvas เห็น — ถูก overlay ตอน export ทับไว้ (z 99999)
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:0;left:0;width:1080px;height:1080px;overflow:hidden;pointer-events:none;z-index:1000;';
    document.body.appendChild(container);

    const root = createRoot(container);
    // flushSync = commit + useLayoutEffect (ตัววัดความสูงย่อรายชื่อมหาวิทยาลัย) จบทันทีในบรรทัดนี้
    // เดิมรอ 2 เฟรม + 50ms ซึ่งค้างถาวรเมื่อแท็บถูกซ่อน/จอดับ (เบราว์เซอร์ไม่ยิงเฟรมให้แท็บที่ไม่ได้โชว์)
    flushSync(() => {
      root.render(
        <StudentCard
          student={student}
          settings={mergeStudentSettings(settings, overrides[normCode(student.student_code)])}
          yearName={yearName}
          quoteApproved={approvedQuotes.has(student.student_code)}
        />
      );
    });
    // บังคับให้เบราว์เซอร์คำนวณ layout จริง — modern-screenshot อ่านค่าจาก computed style ไม่ได้รอ paint
    void container.offsetHeight;
    // ถ้าแท็บยังโชว์อยู่ก็รอเฟรมเหมือนเดิม เผื่อ ResizeObserver วัดซ้ำ; ถ้าถูกซ่อนจะข้ามให้ทันที
    await waitFrameIfVisible();

    try {
      // modern-screenshot ใช้เทคนิค SVG foreignObject = เบราว์เซอร์เรนเดอร์เลย์เอาต์เองจริงๆ
      // ผลลัพธ์ตรงกับที่เห็นบนจอ 100% (ต่างจาก html2canvas ที่เลียนแบบการเรนเดอร์แล้วระยะ/สัดส่วนคลาด)
      return await domToCanvas(container, {
        width: 1080, height: 1080,
        scale,
        backgroundColor: '#0f0c29',
        fetch: { requestInit: { mode: 'cors' } },
      });
    } finally {
      root.unmount();
      document.body.removeChild(container);
    }
  };

  // วางภาพลง PDF แบบคงสัดส่วน (letterbox-fit) — ป้องกันภาพยืดถ้าขนาดหน้ากับ canvas ไม่ตรงกัน
  const addFittedImage = (doc, imgData, fmt, cw, ch) => {
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const fit = Math.min(pw / cw, ph / ch);
    const w = cw * fit;
    const h = ch * fit;
    doc.addImage(imgData, fmt, (pw - w) / 2, (ph - h) / 2, w, h);
  };

  // ── Export คนเดียว (คนที่กำลังพรีวิว) — ไว้เทสเร็ว ไม่ต้องรอทั้งชั้น ──
  const exportOne = async () => {
    if (!previewStudent) return;
    setExporting(true);
    setExportProgress(0);
    try {
      await preloadImages([
        resolveMediaUrl(settings.background_image_url),
        resolveMediaUrl(settings.school_logo_url),
      ]);
      await ensureCardFonts();
      // scale 4 = คมชัดสุด (4320×4320) สำหรับดาวน์โหลดคนเดียว
      const canvas = await renderCardCanvas(previewStudent, 4);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (blob) saveAs(blob, `${previewStudent.student_code}_${previewStudent.first_name}_${previewStudent.last_name}.png`);
      setExportProgress(100);
    } catch (err) {
      console.error('Export คนเดียวไม่สำเร็จ', err);
      showToast('ดาวน์โหลดรูปคนนี้ไม่สำเร็จ', 'error');
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  // ── พรีวิว PDF คนเดียว (คนที่พรีวิว) — จัตุรัส 1080×1080 ไม่ผ่าน print dialog / ไม่โดนย่อ A4 ──
  // เปิดในแท็บใหม่ให้ดูก่อน ยังไม่สร้างไฟล์ — จะเซฟหรือพิมพ์ค่อยกดจากตัวอ่าน PDF ของเบราว์เซอร์
  const exportOnePdf = async () => {
    if (!previewStudent) return;
    const win = openPendingPdfTab();
    if (!win) {
      showToast('เบราว์เซอร์บล็อกการเปิดแท็บใหม่ — อนุญาต popup ก่อน', 'error');
      return;
    }
    setExporting(true);
    setExportProgress(0);
    try {
      await preloadImages([
        resolveMediaUrl(settings.background_image_url),
        resolveMediaUrl(settings.school_logo_url),
      ]);
      await ensureCardFonts();
      const { jsPDF } = await import('jspdf');
      // scale 3 + PNG = คมชัด ไม่มี artifact สำหรับหน้าเดียว
      const canvas = await renderCardCanvas(previewStudent, 3);
      const img = canvas.toDataURL('image/png');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [1080, 1080], compress: true });
      addFittedImage(doc, img, 'PNG', canvas.width, canvas.height);
      setExportProgress(100);
      showPdfInTab(win, doc, `${previewStudent.student_code}_${previewStudent.first_name}_${previewStudent.last_name}.pdf`);
    } catch (err) {
      console.error('สร้างพรีวิว PDF คนนี้ไม่สำเร็จ', err);
      showToast('สร้างพรีวิว PDF คนนี้ไม่สำเร็จ', 'error');
      if (!win.closed) win.close(); // ไม่มีอะไรให้ดู อย่าทิ้งแท็บหมุนค้างไว้
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  // ── เปิดการ์ดในแท็บใหม่ (เรนเดอร์ด้วยเบราว์เซอร์จริง — สวยเป๊ะเท่าพรีวิว ไม่พึ่ง html2canvas) ──
  // list = อาเรย์นักเรียน (undefined = เฉพาะคนที่พรีวิวอยู่)
  const openInNewTab = async (list) => {
    const arr = Array.isArray(list) ? list : (previewStudent ? [previewStudent] : []);
    if (arr.length === 0) return;
    // สเกลย่อรายชื่อมหาวิทยาลัยถูกคำนวณจากความสูงที่วัดในหน้านี้ แล้วฝังติดไปกับ HTML
    // จึงต้องวัดตอนฟอนต์จริงพร้อมแล้ว ไม่งั้นได้ค่าจากฟอนต์สำรองซึ่งสูงกว่า
    await ensureCardFonts();
    // เรนเดอร์การ์ดทุกคนเป็น HTML จริงก่อน แล้วคัด innerHTML ไปเปิดแท็บใหม่
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-99999px;top:0;width:1080px;';
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(
      <>
        {arr.map(s => (
          <div key={s.student_code} className="slot"><div className="card-page">
            <StudentCard
              student={s}
              settings={mergeStudentSettings(settings, overrides[normCode(s.student_code)])}
              yearName={yearName}
              quoteApproved={approvedQuotes.has(s.student_code)}
            />
          </div></div>
        ))}
      </>
    );
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cardsHtml = container.innerHTML;
    root.unmount();
    document.body.removeChild(container);

    const win = window.open('', '_blank');
    if (!win) {
      showToast('เบราว์เซอร์บล็อกการเปิดแท็บใหม่ — อนุญาต popup ก่อน', 'error');
      return;
    }
    const title = arr.length === 1
      ? `${arr[0].title_prefix || ''}${arr[0].first_name} ${arr[0].last_name} (${arr[0].student_code})`
      : `รายงานผล ${yearName} — ${arr.length} คน`;
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${absoluteBase()}">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;700&family=Noto+Sans+Thai:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  /* บังคับพิมพ์ background (รูปนักเรียน/โลโก้/ตรา/พื้นหลัง เป็น background-image ทั้งหมด)
     ไม่งั้นเบราว์เซอร์จะไม่พิมพ์ background โดยดีฟอลต์ → เห็นแต่ตัวหนังสือ */
  *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;}
  html,body{margin:0;padding:0;background:#1a1a2e;font-family:'Prompt','Noto Sans Thai',sans-serif;}
  body{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px 0;box-sizing:border-box;}
  .slot{position:relative;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;}
  .card-page{width:1080px;height:1080px;}
  @media print{
    html,body{background:#fff;}
    body{display:block;gap:0;padding:0;}
    @page{size:1080px 1080px;margin:0;}
    .slot{box-shadow:none;width:1080px!important;height:1080px!important;overflow:visible;page-break-after:always;break-after:page;}
    .slot:last-child{page-break-after:auto;break-after:auto;}
    .card-page{transform:none!important;}
  }
</style>
</head>
<body>
  ${cardsHtml}
  <script>
    (function(){
      function layout(){
        var scale=Math.min(1,(window.innerWidth-40)/1080);
        var slots=document.querySelectorAll('.slot');
        for(var i=0;i<slots.length;i++){
          var card=slots[i].firstElementChild;
          card.style.transform='scale('+scale+')';
          card.style.transformOrigin='top left';
          slots[i].style.width=(1080*scale)+'px';
          slots[i].style.height=(1080*scale)+'px';
        }
      }
      window.addEventListener('resize',layout);layout();
    })();
  <\/script>
</body>
</html>`);
    win.document.close();
  };

  const exportZip = async () => {
    if (students.length === 0) return;
    setExporting(true);
    setExportProgress(0);
    try {
      const zip = new JSZip();
      await preloadImages([
        resolveMediaUrl(settings.background_image_url),
        resolveMediaUrl(settings.school_logo_url),
      ]);
      await ensureCardFonts();

      for (let i = 0; i < students.length; i++) {
        const student = students[i];
        try {
          const canvas = await renderCardCanvas(student);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          if (blob) zip.file(`${student.student_code}_${student.first_name}_${student.last_name}.png`, blob);
        } catch (err) {
          console.error('Capture failed:', student.student_code, err);
        }
        setExportProgress(Math.round(((i + 1) / students.length) * 100));
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `gradtrack-report-${yearName}.zip`);
    } catch (err) {
      console.error('Export ZIP failed', err);
      showToast('สร้าง ZIP ไม่สำเร็จ', 'error');
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  // ── พรีวิว PDF ทุกคน ──
  // สร้าง PDF ตรงๆ ฝั่ง client ทีละใบ — ไม่พึ่ง print dialog ของ browser ที่ค้างเมื่อมีนักเรียนหลักร้อยคน
  // เสร็จแล้วเปิดในแท็บใหม่ให้ตรวจก่อน ยังไม่สร้างไฟล์
  const exportPdf = async () => {
    if (students.length === 0) return;
    const win = openPendingPdfTab();
    if (!win) {
      showToast('เบราว์เซอร์บล็อกการเปิดแท็บใหม่ — อนุญาต popup ก่อน', 'error');
      return;
    }
    setExporting(true);
    setExportProgress(0);
    try {
      await preloadImages([
        resolveMediaUrl(settings.background_image_url),
        resolveMediaUrl(settings.school_logo_url),
      ]);
      await ensureCardFonts();

      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [1080, 1080], compress: true });

      let added = 0;
      for (let i = 0; i < students.length; i++) {
        const student = students[i];
        try {
          const canvas = await renderCardCanvas(student);
          // JPEG 0.92 เพื่อลดขนาดไฟล์ (หลายร้อยหน้าเป็น PNG จะใหญ่มาก)
          const img = canvas.toDataURL('image/jpeg', 0.92);
          if (added > 0) doc.addPage([1080, 1080], 'portrait');
          // วางแบบคงสัดส่วน (fit) — กันภาพยืด/หัวแบน ไม่ว่าขนาดหน้าจะเป็นเท่าไร
          addFittedImage(doc, img, 'JPEG', canvas.width, canvas.height);
          added++;
        } catch (err) {
          console.error('Capture failed:', student.student_code, err);
        }
        const pct = Math.round(((i + 1) / students.length) * 100);
        setExportProgress(pct);
        setPdfTabProgress(win, pct); // โชว์ความคืบหน้าในแท็บพรีวิวด้วย เพราะแท็บนั้นคือแท็บที่ผู้ใช้มองอยู่
      }

      if (added === 0) {
        showToast('ไม่สามารถสร้างหน้า PDF ได้', 'error');
        if (!win.closed) win.close();
        return;
      }
      showPdfInTab(win, doc, `gradtrack-report-${yearName}.pdf`);
    } catch (err) {
      console.error('Export PDF failed', err);
      showToast('สร้าง PDF ไม่สำเร็จ', 'error');
      if (!win.closed) win.close();
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const previewStudent = students[previewIndex];
  const SCALE = 0.35; // preview scale (ในหน้า) — โหมดจัดวางเปิด modal ใหญ่แยกต่างหาก

  // ── ค่าเฉพาะรายคน ──
  const previewCode = previewStudent ? normCode(previewStudent.student_code) : null;
  const activeOverride = previewCode ? overrides[previewCode] : null;
  // แก้ค่าเฉพาะคนได้ต่อเมื่อเปิดโหมด และมีนักเรียนที่กำลังพรีวิวอยู่
  const editingStudent = perStudent && !!previewCode;
  const hasLayoutOverride = !!activeOverride?.layout && Object.keys(activeOverride.layout).length > 0;
  const hasOverride = (!!activeOverride && PER_STUDENT_KEYS.some(k => activeOverride[k] !== null && activeOverride[k] !== undefined)) || hasLayoutOverride;

  // อ่านค่า: โหมดรายคนใช้ค่า override ถ้ามี ไม่มีก็ตกไปใช้ค่ากลาง
  const pv = (key) => {
    if (editingStudent && activeOverride && activeOverride[key] !== null && activeOverride[key] !== undefined) {
      return activeOverride[key];
    }
    return settings[key];
  };
  const isOverridden = (key) =>
    editingStudent && !!activeOverride && activeOverride[key] !== null && activeOverride[key] !== undefined;

  // เขียนค่า: null = กลับไปใช้ค่ากลาง
  const setPv = (key, value) => {
    if (editingStudent) {
      setOverrides(prev => ({ ...prev, [previewCode]: { ...(prev[previewCode] || {}), [key]: value } }));
      setDirtyCodes(prev => new Set(prev).add(previewCode));
    } else {
      setSettings(p => ({ ...p, [key]: value }));
    }
  };
  const resetPv = (key, def) => setPv(key, editingStudent ? null : def);

  // ── Free-layout: เขียน/รีเซ็ตตำแหน่ง+ขนาดของแต่ละชิ้น ──
  // patch = { x?, y?, w?, scale? } — merge ทับค่าที่แสดงอยู่ (ไม่ให้กระโดดตอนเริ่ม override)
  const setLayout = (elKey, patch) => {
    if (editingStudent) {
      setOverrides(prev => {
        const cur = prev[previewCode] || {};
        const curLayout = cur.layout || {};
        const base = { ...DEFAULT_LAYOUT[elKey], ...(settings.layout?.[elKey] || {}), ...(curLayout[elKey] || {}) };
        return { ...prev, [previewCode]: { ...cur, layout: { ...curLayout, [elKey]: { ...base, ...patch } } } };
      });
      setDirtyCodes(prev => new Set(prev).add(previewCode));
    } else {
      setSettings(p => {
        const base = { ...DEFAULT_LAYOUT[elKey], ...(p.layout?.[elKey] || {}) };
        return { ...p, layout: { ...(p.layout || {}), [elKey]: { ...base, ...patch } } };
      });
    }
  };
  // รีเซ็ตชิ้นเดียว: โหมดรายคน = ลบ override ชิ้นนั้น (กลับไปใช้ค่ากลาง), โหมดกลาง = กลับ default
  const resetLayoutEl = (elKey) => {
    if (editingStudent) {
      setOverrides(prev => {
        const cur = prev[previewCode];
        if (!cur?.layout) return prev;
        const nl = { ...cur.layout }; delete nl[elKey];
        return { ...prev, [previewCode]: { ...cur, layout: nl } };
      });
      setDirtyCodes(prev => new Set(prev).add(previewCode));
    } else {
      setSettings(p => {
        const nl = { ...(p.layout || {}) }; delete nl[elKey];
        return { ...p, layout: nl };
      });
    }
  };
  const isLayoutOverridden = (elKey) => editingStudent && !!activeOverride?.layout?.[elKey];

  // ล้าง override ทั้งหมดของคนนี้
  const clearOverride = async () => {
    if (!previewCode) return;
    await api.delete(`/report-settings/students/${previewCode}`);
    setOverrides(prev => {
      const next = { ...prev };
      delete next[previewCode];
      return next;
    });
    setDirtyCodes(prev => {
      const next = new Set(prev);
      next.delete(previewCode);
      return next;
    });
  };

  const previewSettings = mergeStudentSettings(settings, activeOverride);

  // ── Free-layout overlay: นิยามชิ้น + ความสูงประมาณ (สำหรับ hit-area) ──
  const layoutBoxDefs = [
    settings.school_logo_url && { key: 'logo', mode: 'w' },
    settings.school_name && { key: 'school', mode: 'text' },
    settings.congrats_text && { key: 'congrats', mode: 'text' },
    { key: 'photo', mode: 'wh' },
    { key: 'name', mode: 'text' },
  ].filter(Boolean);
  const elBoxHeight = (key, b) => {
    if (key === 'logo') return b.w;
    if (key === 'photo') return b.w * PHOTO_ASPECT;
    if (key === 'school') return 44 * (b.scale || 1);
    if (key === 'congrats') return 92 * (b.scale || 1);
    return 150 * (b.scale || 1); // name
  };
  // overlay กล่องลากวาง วางทับ card ที่สเกลใด ๆ (ใช้ทั้งใน modal)
  const renderDragOverlay = (scale) => (
    <div onPointerDown={() => setSelectedEl(null)} style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
      {layoutBoxDefs.map(({ key, mode }) => {
        const b = previewSettings.layout[key];
        return (
          <DragResizeBox
            key={key}
            x={b.x} y={b.y} w={b.w} h={elBoxHeight(key, b)}
            curScale={b.scale || 1}
            scale={scale}
            label={LAYOUT_LABELS[key]}
            resizeMode={mode}
            selected={selectedEl === key}
            overridden={isLayoutOverridden(key)}
            onSelect={() => setSelectedEl(key)}
            onChange={(patch) => setLayout(key, patch)}
            onReset={() => resetLayoutEl(key)}
          />
        );
      })}
    </div>
  );

  // คำนวณสเกล modal ให้พอดีจอเมื่อเปิด (ตามความกว้าง/สูงหน้าต่าง)
  useEffect(() => {
    if (!editLayout) return;
    const calc = () => {
      const s = Math.min((window.innerWidth - 140) / 1080, (window.innerHeight - 260) / 1080);
      setModalScale(Math.max(0.32, Math.min(0.74, s)));
    };
    const onKey = (e) => { if (e.key === 'Escape') { setEditLayout(false); setSelectedEl(null); } };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', calc); window.removeEventListener('keydown', onKey); };
  }, [editLayout]);

  return (
    <div className="flex flex-col">
      {/* Toast */}
      {toast && (
        <div className="toast toast-top toast-end z-[100000]" role="status" aria-live="polite">
          <div
            className={`alert ${toast.type === 'error' ? 'alert-error' : 'alert-success'} anim-scale-in py-2.5 text-sm shadow-lg`}
          >
            <Icon name={toast.type === 'error' ? 'alert' : 'checkCircle'} size={16} />
            <span>{toast.msg}</span>
          </div>
        </div>
      )}

      <PageHeader
        icon="chart"
        title="รายงานผลการสอบ"
        subtitle="ออกแบบการ์ดรายงานรายคน แล้วส่งออกเป็นรูปภาพหรือ PDF"
      />

      {/* Full-screen overlay during export — hides the card rendered at top-left for html2canvas */}
      {exporting && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(26,16,42,0.82)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18,
            color: 'white',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="loading loading-spinner loading-lg text-[#F5C518]" />
          <p style={{ fontSize: 18, fontWeight: 500 }}>
            กำลังสร้างไฟล์... <span className="tabular-nums">{exportProgress}%</span>
          </p>
          <div className="h-1.5 w-64 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-[#F5C518] transition-[width] duration-200"
              style={{ width: `${exportProgress}%` }}
            />
          </div>
          <p style={{ fontSize: 12, opacity: 0.6 }}>
            สลับไปทำอย่างอื่นได้ ระบบสร้างต่อจนเสร็จ — แค่อย่าปิดหน้านี้
          </p>
        </div>
      )}

      {/* ── Modal จัดวางอิสระ (ลากย้าย/ปรับขนาดชิ้นบนการ์ด) ── */}
      {editLayout && previewStudent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90000, background: 'rgba(26,16,42,0.7)', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div className="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2.5">
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">
              <Icon name="settings" size={15} className="text-primary" />
              จัดวางอิสระ
            </span>
            {editingStudent && (
              <span className="badge badge-gold badge-xs shrink-0 gap-1">
                <Icon name="star" size={10} strokeWidth={2.4} />
                {previewStudent.first_name}
              </span>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              <button
                className="btn btn-outline btn-xs btn-square shrink-0"
                onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
                disabled={previewIndex <= 0}
                aria-label="คนก่อนหน้า"
              >
                <Icon name="chevronLeft" size={13} />
              </button>
              <SearchableSelect
                className="w-40 min-w-0 sm:w-56"
                value={previewIndex}
                onChange={setPreviewIndex}
                placeholder="เลือกนักเรียน..."
                options={students.map((s, i) => {
                  const ov = overrides[normCode(s.student_code)];
                  const tuned = ov && (PER_STUDENT_KEYS.some(k => ov[k] !== null && ov[k] !== undefined) || (ov.layout && Object.keys(ov.layout).length > 0));
                  return {
                    value: i,
                    label: `${tuned ? '★ ' : ''}${s.title_prefix || ''}${s.first_name} ${s.last_name} (${s.student_code})`,
                  };
                })}
              />
              <button
                className="btn btn-outline btn-xs btn-square shrink-0"
                onClick={() => setPreviewIndex(i => Math.min(students.length - 1, i + 1))}
                disabled={previewIndex >= students.length - 1}
                aria-label="คนถัดไป"
              >
                <Icon name="chevronRight" size={13} />
              </button>
              <span className="text-xs text-base-content/50 tabular-nums whitespace-nowrap shrink-0">
                {previewIndex + 1}/{students.length}
              </span>
            </div>
          </div>

          {/* Body — การ์ดใหญ่ + overlay ลากวาง */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-10">
            <div style={{ position: 'relative', width: 1080 * modalScale, height: 1080 * modalScale, flexShrink: 0 }}>
              <div style={{
                width: 1080 * modalScale, height: 1080 * modalScale,
                overflow: 'hidden', borderRadius: 12, boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
              }}>
                <div style={{ transform: `scale(${modalScale})`, transformOrigin: 'top left', width: 1080, height: 1080 }}>
                  <StudentCard student={previewStudent} settings={previewSettings} yearName={yearName} quoteApproved={approvedQuotes.has(previewStudent.student_code)} />
                </div>
              </div>
              {renderDragOverlay(modalScale)}
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-2 border-t border-base-300 bg-base-100 px-4 py-2.5">
            <span className="min-w-0 text-xs text-base-content/60">
              ลากกลาง = ย้าย • ลากมุมขวาล่าง = ปรับขนาด • คลิกที่ว่าง = ยกเลิกเลือก • ปุ่มรีเซ็ตบนกล่อง = คืนค่าชิ้นนั้น
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* ขอบเขตของค่าที่กำลังแก้ — อยู่ติดปุ่มบันทึก จะได้เห็นว่ากำลังบันทึกให้ใคร */}
              <div className="join shrink-0">
                <button
                  className={`btn btn-sm join-item ${!perStudent ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setPerStudent(false)}
                  aria-pressed={!perStudent}
                  title="แก้ค่ากลางที่ใช้กับนักเรียนทุกคน"
                >ทุกคน</button>
                <button
                  className={`btn btn-sm join-item ${perStudent ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setPerStudent(true)}
                  disabled={!previewCode}
                  aria-pressed={perStudent}
                  title="แก้ค่าเฉพาะนักเรียนคนที่กำลังดูอยู่"
                >เฉพาะคนนี้</button>
              </div>
              <button
                className="btn btn-primary btn-sm gap-1.5"
                onClick={saveSettings}
                disabled={saving}
                title="บันทึกตำแหน่ง/ขนาดทั้งหมด"
              >
                {saving ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Icon name="save" size={15} />
                )}
                บันทึก{dirtyCodes.size > 0 ? ` (+เฉพาะคน ${dirtyCodes.size})` : ''}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setEditLayout(false); setSelectedEl(null); }}
              >เสร็จ</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* ── Settings Panel ── */}
        <div className="card h-fit overflow-hidden bg-base-100">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-base-300 bg-base-200/50 px-4 py-3">
            <span className="gt-chip size-8">
              <Icon name="settings" size={16} />
            </span>
            <h2 className="text-sm font-semibold">ตั้งค่ารายงาน</h2>
          </div>

          <div className="flex flex-col gap-5 p-4">

            {/* ── Section: โรงเรียน ── */}
            <section className="flex flex-col gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
                <Icon name="building" size={13} />
                โรงเรียน
              </p>

              {/* School logo — compact row */}
              <div className="flex items-center gap-3">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-base-300 bg-base-200">
                  {settings.school_logo_url ? (
                    <img
                      src={resolveMediaUrl(settings.school_logo_url)}
                      alt="โลโก้โรงเรียน"
                      className="h-full w-full object-contain p-1"
                    />
                  ) : (
                    <Icon name="building" size={22} className="text-base-content/25" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-xs text-base-content/60">โลโก้โรงเรียน</span>
                  <div className="flex gap-1">
                    <button
                      className="btn btn-outline btn-xs gap-1"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                    >
                      {logoUploading ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <Icon name="upload" size={12} />
                      )}
                      {settings.school_logo_url ? 'เปลี่ยน' : 'อัปโหลด'}
                    </button>
                    {settings.school_logo_url && (
                      <button className="btn btn-ghost btn-xs gap-1 text-error" onClick={removeSchoolLogo}>
                        <Icon name="trash" size={12} />
                        ลบ
                      </button>
                    )}
                  </div>
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={uploadSchoolLogo} />
              </div>

              {/* School name */}
              <div>
                <label htmlFor="rp-school" className="label">ชื่อโรงเรียน</label>
                <input
                  id="rp-school"
                  type="text"
                  className="input input-sm w-full"
                  value={settings.school_name || ''}
                  onChange={e => setSettings(p => ({ ...p, school_name: e.target.value }))}
                  placeholder="โรงเรียน..."
                />
              </div>
            </section>

            <div className="divider my-0" />

            {/* ── Section: เนื้อหาบนการ์ด ── */}
            <section className="flex flex-col gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
                <Icon name="file" size={13} />
                เนื้อหาบนการ์ด
              </p>

              {/* Congrats text */}
              <div className="form-control gap-1">
                <label className="label py-0"><span className="label-text text-xs">ข้อความแสดงความยินดี</span></label>
                <textarea
                  className="textarea textarea-bordered textarea-sm text-sm"
                  rows={3}
                  value={settings.congrats_text || ''}
                  onChange={e => setSettings(p => ({ ...p, congrats_text: e.target.value }))}
                  placeholder="ขอแสดงความยินดี..."
                />
              </div>

              {/* Toggles group */}
              <div className="flex flex-col gap-2">
                {[
                  { key: 'show_quote', label: 'แสดงคำคม' },
                  { key: 'show_photo_frame', label: 'แสดงกรอบรูปนักเรียน' },
                ].map(({ key, label }) => {
                  const on = !!settings[key];
                  return (
                    <label
                      key={key}
                      className={`flex items-center justify-between gap-3 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                        on
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-base-300 bg-base-200/40 hover:border-base-content/20'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <span className={`text-xs font-bold w-9 text-center rounded px-1 py-0.5 ${on ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content/50'}`}>
                          {on ? 'เปิด' : 'ปิด'}
                        </span>
                        <span className={on ? 'font-semibold' : 'text-base-content/70'}>{label}</span>
                      </span>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm"
                        checked={on}
                        onChange={e => setSettings(p => ({ ...p, [key]: e.target.checked }))}
                      />
                    </label>
                  );
                })}
              </div>

              {/* ── กลุ่มค่าที่แยกรายคนได้ ── */}
              <div className={`flex flex-col gap-3 rounded-lg border p-3 transition-colors ${
                editingStudent ? 'border-secondary/60 bg-secondary/5' : 'border-base-300'
              }`}>
                {/* Mode switch: ค่ากลาง ↔ เฉพาะคนที่พรีวิวอยู่ */}
                <div className="flex flex-col gap-1.5">
                  <div className="join w-full">
                    <button
                      className={`btn btn-xs join-item flex-1 ${!perStudent ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setPerStudent(false)}
                    >ทุกคน</button>
                    <button
                      className={`btn btn-xs join-item flex-1 ${perStudent ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setPerStudent(true)}
                      disabled={!previewCode}
                      aria-pressed={perStudent}
                    >เฉพาะคนนี้</button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-base-content/50">
                    {editingStudent ? (
                      <>ปรับให้ <span className="font-semibold text-base-content/80">{previewStudent.first_name} {previewStudent.last_name}</span> คนเดียว — คนอื่นยังใช้ค่ากลาง</>
                    ) : perStudent
                      ? 'เลือกนักเรียนในช่องพรีวิวก่อน จึงจะปรับเฉพาะคนได้'
                      : 'ค่าเหล่านี้ใช้กับนักเรียนทุกคน ยกเว้นคนที่ตั้งค่าเฉพาะไว้'}
                  </p>
                  {editingStudent && hasOverride && (
                    <button className="btn btn-ghost btn-xs gap-1 self-start text-error" onClick={clearOverride}>
                      <Icon name="refresh" size={12} />
                      ล้างค่าเฉพาะคนนี้ (กลับไปใช้ค่ากลาง)
                    </button>
                  )}
                </div>

                {/* Photo overflow */}
                {(() => {
                  const on = !!pv('photo_overflow');
                  return (
                    <label className={`flex items-center justify-between gap-3 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                      on ? 'border-primary/60 bg-primary/10' : 'border-base-300 bg-base-200/40 hover:border-base-content/20'
                    }`}>
                      <span className="flex items-center gap-2 text-sm">
                        <span className={`text-xs font-bold w-9 text-center rounded px-1 py-0.5 ${on ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content/50'}`}>
                          {on ? 'เปิด' : 'ปิด'}
                        </span>
                        <span className={on ? 'font-semibold' : 'text-base-content/70'}>ให้รูปล้นกรอบได้ (อยู่ชั้นหลังสุด)</span>
                        {isOverridden('photo_overflow') && <span className="badge badge-secondary badge-xs">เฉพาะคน</span>}
                      </span>
                      <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm"
                        checked={on}
                        onChange={e => setPv('photo_overflow', e.target.checked)}
                      />
                    </label>
                  );
                })()}

                {/* Photo zoom */}
                <div className="form-control gap-1 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="label-text text-xs flex items-center gap-1.5">
                      ขนาดรูปนักเรียน (zoom)
                      {isOverridden('photo_scale') && <span className="badge badge-secondary badge-xs">เฉพาะคน</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums">{pv('photo_scale') ?? 100}%</span>
                      <button className="btn btn-ghost btn-xs" onClick={() => resetPv('photo_scale', 100)}>รีเซ็ต</button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={300}
                    step={5}
                    value={pv('photo_scale') ?? 100}
                    onChange={e => setPv('photo_scale', Number(e.target.value))}
                    className="range range-primary range-xs"
                  />
                  <div className="flex justify-between text-[10px] text-base-content/40 px-0.5">
                    <span>ย่อ 50%</span>
                    <span>ปกติ 100%</span>
                    <span>ขยาย 300%</span>
                  </div>
                </div>

                {/* Photo offset Y — เลื่อนรูปขึ้น/ลง */}
                <div className="form-control gap-1 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="label-text text-xs flex items-center gap-1.5">
                      เลื่อนรูปขึ้น/ลง
                      {isOverridden('photo_offset_y') && <span className="badge badge-secondary badge-xs">เฉพาะคน</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums">{pv('photo_offset_y') ?? 0}px</span>
                      <button className="btn btn-ghost btn-xs" onClick={() => resetPv('photo_offset_y', 0)}>รีเซ็ต</button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={-300}
                    max={300}
                    step={5}
                    value={pv('photo_offset_y') ?? 0}
                    onChange={e => setPv('photo_offset_y', Number(e.target.value))}
                    className="range range-primary range-xs"
                  />
                  <div className="flex justify-between text-[10px] text-base-content/40 px-0.5">
                    <span>ขึ้น</span>
                    <span>กลาง</span>
                    <span>ลง</span>
                  </div>
                </div>

                {/* Info offset Y — เลื่อนชื่อ + กล่องมหาลัยที่ยืนยัน ขึ้น/ลงพร้อมกัน */}
                <div className="form-control gap-1 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="label-text text-xs flex items-center gap-1.5">
                      เลื่อนชื่อ + มหาลัยที่ยืนยัน ขึ้น/ลง
                      {isOverridden('info_offset_y') && <span className="badge badge-secondary badge-xs">เฉพาะคน</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums">{pv('info_offset_y') ?? 0}px</span>
                      <button className="btn btn-ghost btn-xs" onClick={() => resetPv('info_offset_y', 0)}>รีเซ็ต</button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={-300}
                    max={300}
                    step={5}
                    value={pv('info_offset_y') ?? 0}
                    onChange={e => setPv('info_offset_y', Number(e.target.value))}
                    className="range range-primary range-xs"
                  />
                  <div className="flex justify-between text-[10px] text-base-content/40 px-0.5">
                    <span>ขึ้น</span>
                    <span>กลาง</span>
                    <span>ลง</span>
                  </div>
                </div>
              </div>
            </section>

            <div className="divider my-0" />

            {/* ── Section: รูปแบบ & ดีไซน์ ── */}
            <section className="flex flex-col gap-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/45">
                <Icon name="image" size={13} />
                รูปแบบ & ดีไซน์
              </p>

              {/* Text color */}
              <div className="flex items-center justify-between gap-2">
                <span className="label-text text-xs">สีตัวอักษร</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-50">{settings.text_color || '#ffffff'}</span>
                  <input
                    type="color"
                    value={settings.text_color || '#ffffff'}
                    onChange={e => setSettings(p => ({ ...p, text_color: e.target.value }))}
                    className="w-9 h-9 rounded cursor-pointer border border-base-300"
                    style={{ padding: 2 }}
                  />
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => setSettings(p => ({ ...p, text_color: '#ffffff' }))}
                  >รีเซ็ต</button>
                </div>
              </div>

              {/* Name background — สี + ความทึบ (ช่วยให้ชื่ออ่านง่ายเวลามีรูปอยู่ข้างหลัง) */}
              <div className="form-control gap-2 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="label-text text-xs">พื้นหลังชื่อนักเรียน</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.name_bg_color || '#000000'}
                      onChange={e => setSettings(p => ({ ...p, name_bg_color: e.target.value }))}
                      className="w-9 h-9 rounded cursor-pointer border border-base-300"
                      style={{ padding: 2 }}
                    />
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => setSettings(p => ({ ...p, name_bg_color: '#000000', name_bg_opacity: 0 }))}
                    >รีเซ็ต</button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="label-text text-xs">ความทึบ</span>
                  <span className="text-xs font-semibold tabular-nums">{settings.name_bg_opacity ?? 0}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.name_bg_opacity ?? 0}
                  onChange={e => setSettings(p => ({ ...p, name_bg_opacity: Number(e.target.value) }))}
                  className="range range-primary range-xs"
                />
                <div className="flex justify-between text-[10px] text-base-content/40 px-0.5">
                  <span>โปร่งใส 0%</span>
                  <span>ทึบ 100%</span>
                </div>
              </div>

              {/* Confirmed university background — สี + ความทึบ */}
              <div className="form-control gap-2 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="label-text text-xs">พื้นหลังมหาลัยที่ยืนยัน</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.confirm_color || '#22c55e'}
                      onChange={e => setSettings(p => ({ ...p, confirm_color: e.target.value }))}
                      className="w-9 h-9 rounded cursor-pointer border border-base-300"
                      style={{ padding: 2 }}
                    />
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => setSettings(p => ({ ...p, confirm_color: '#22c55e', confirm_opacity: 22 }))}
                    >รีเซ็ต</button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="label-text text-xs">ความทึบ</span>
                  <span className="text-xs font-semibold tabular-nums">{settings.confirm_opacity ?? 22}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.confirm_opacity ?? 22}
                  onChange={e => setSettings(p => ({ ...p, confirm_opacity: Number(e.target.value) }))}
                  className="range range-primary range-xs"
                />
                <div className="flex justify-between text-[10px] text-base-content/40 px-0.5">
                  <span>โปร่งใส 0%</span>
                  <span>ทึบ 100%</span>
                </div>
              </div>

              {/* Background image */}
              <div className="form-control gap-2">
                <label className="label py-0"><span className="label-text text-xs">ภาพพื้นหลัง</span></label>
                {settings.background_image_url ? (
                  <div className="relative group">
                    <img
                      src={resolveMediaUrl(settings.background_image_url)}
                      alt="background"
                      className="w-full h-28 object-cover rounded-lg border border-base-300"
                    />
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 group-hover:bg-black/40 transition rounded-lg opacity-0 group-hover:opacity-100">
                      <button className="btn btn-xs" onClick={() => bgInputRef.current?.click()} disabled={bgUploading}>
                        {bgUploading ? <span className="loading loading-spinner loading-xs" /> : 'เปลี่ยน'}
                      </button>
                      <button className="btn btn-error btn-xs" onClick={removeBg}>ลบ</button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => bgInputRef.current?.click()}
                    disabled={bgUploading}
                  >
                    {bgUploading ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <Icon name="image" size={15} />
                    )}
                    เลือกภาพพื้นหลัง
                  </button>
                )}
                <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={uploadBg} />
              </div>
            </section>
          </div>

          {/* Sticky save footer */}
          <div className="border-t border-base-300 bg-base-200/50 px-4 py-3">
            <button
              className="btn btn-primary btn-sm w-full gap-1.5"
              onClick={saveSettings}
              disabled={saving}
            >
              {saving ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <Icon name="save" size={15} />
              )}
              บันทึกการตั้งค่า{dirtyCodes.size > 0 ? ` (+ เฉพาะคน ${dirtyCodes.size} คน)` : ''}
            </button>
          </div>
        </div>

        {/* ── Preview Panel ── */}
        <div className="flex flex-col gap-3">
          <div className="card bg-base-100 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex shrink-0 items-center gap-2">
                <span className="gt-chip size-8">
                  <Icon name="eye" size={16} />
                </span>
                <h2 className="text-sm font-semibold sm:text-base">ตัวอย่างรายงาน</h2>
                <button
                  className="btn btn-primary btn-xs gap-1"
                  onClick={() => { setEditLayout(true); setSelectedEl(null); }}
                  disabled={!previewStudent}
                  title="เปิดหน้าต่างใหญ่สำหรับลากย้าย/ปรับขนาด โลโก้ ข้อความ รูป ชื่อ ได้อิสระ"
                >
                  <Icon name="settings" size={12} />
                  ลากวางอิสระ
                </button>
              </div>
              {students.length > 0 && (
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    className="btn btn-outline btn-sm btn-square shrink-0"
                    onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
                    disabled={previewIndex <= 0}
                    aria-label="คนก่อนหน้า"
                  >
                    <Icon name="chevronLeft" size={15} />
                  </button>
                  <SearchableSelect
                    className="w-40 min-w-0 sm:w-56"
                    value={previewIndex}
                    onChange={setPreviewIndex}
                    placeholder="เลือกนักเรียน..."
                    options={students.map((s, i) => {
                      const ov = overrides[normCode(s.student_code)];
                      const tuned = ov && PER_STUDENT_KEYS.some(k => ov[k] !== null && ov[k] !== undefined);
                      return {
                        value: i,
                        label: `${tuned ? '★ ' : ''}${s.title_prefix || ''}${s.first_name} ${s.last_name} (${s.student_code})`,
                      };
                    })}
                  />
                  <button
                    className="btn btn-outline btn-sm btn-square shrink-0"
                    onClick={() => setPreviewIndex(i => Math.min(students.length - 1, i + 1))}
                    disabled={previewIndex >= students.length - 1}
                    aria-label="คนถัดไป"
                  >
                    <Icon name="chevronRight" size={15} />
                  </button>
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-base-content/50">
                    {previewIndex + 1}/{students.length}
                  </span>
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <span className="gt-skeleton block aspect-square w-full max-w-md rounded-xl" />
              </div>
            ) : !previewStudent ? (
              <p className="py-20 text-center text-sm text-base-content/45">
                ไม่มีนักเรียนที่บันทึกผลในปีการศึกษานี้
              </p>
            ) : (
              <div className="flex justify-center overflow-hidden">
                {/* Scaled preview wrapper */}
                <div style={{
                  width: 1080 * SCALE,
                  height: 1080 * SCALE,
                  overflow: 'hidden',
                  borderRadius: 12,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                  flexShrink: 0,
                }}>
                  <div style={{ transform: `scale(${SCALE})`, transformOrigin: 'top left', width: 1080, height: 1080 }}>
                    <StudentCard student={previewStudent} settings={previewSettings} yearName={yearName} quoteApproved={approvedQuotes.has(previewStudent.student_code)} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Export Section ── */}
          <div className="card bg-base-100 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 py-1.5">
                  <span className="text-2xl font-semibold leading-none tabular-nums text-primary">
                    {students.length}
                  </span>
                  <span className="text-[10px] text-base-content/60">คน</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">นักเรียนที่บันทึกผล</p>
                  <p className="text-xs text-base-content/50">เฉพาะที่มีการบันทึกมหาวิทยาลัยแล้ว</p>
                </div>
              </div>

              {/* Progress */}
              {exporting && (
                <div className="flex items-center gap-2 text-sm text-base-content/60">
                  <span className="loading loading-spinner loading-xs" />
                  <span className="tabular-nums">{exportProgress}%</span>
                </div>
              )}

              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                {[
                  {
                    label: 'เปิดคนนี้', icon: 'link', variant: 'btn-outline',
                    onClick: () => openInNewTab(), disabled: !previewStudent,
                    title: 'เปิดการ์ดคนนี้ในแท็บใหม่ (เรนเดอร์ด้วยเบราว์เซอร์ — สวยเป๊ะ, กด Ctrl+P สั่งพิมพ์/เซฟ PDF ได้)',
                  },
                  {
                    label: 'เปิดทุกคน', icon: 'copy', variant: 'btn-outline',
                    onClick: () => openInNewTab(students), disabled: students.length === 0,
                    title: 'เปิดการ์ดทุกคนในแท็บใหม่ (สวยเป๊ะ, กด Ctrl+P แล้วเลือก Save as PDF ได้ทั้งชั้น)',
                  },
                  {
                    label: 'PDF คนนี้', icon: 'file', variant: 'btn-outline',
                    onClick: exportOnePdf, disabled: exporting || !previewStudent,
                    title: 'เปิดพรีวิว PDF ของคนนี้ในแท็บใหม่ (จัตุรัส 1080×1080 ไม่โดนย่อ A4) — ยังไม่สร้างไฟล์ ถูกใจแล้วค่อยกดเซฟจากตัวอ่าน PDF',
                  },
                  {
                    label: 'PNG คนนี้', icon: 'image', variant: 'btn-outline',
                    onClick: exportOne, disabled: exporting || !previewStudent,
                    title: 'ดาวน์โหลดเฉพาะคนที่พรีวิวอยู่ เป็นรูป PNG',
                  },
                  {
                    label: 'Export ZIP', icon: 'download', variant: 'btn-primary',
                    onClick: exportZip, disabled: exporting || students.length === 0,
                    title: 'ดาวน์โหลดการ์ดทุกคนเป็นไฟล์ ZIP',
                  },
                  {
                    label: 'PDF ทุกคน', icon: 'print', variant: 'btn-primary',
                    onClick: exportPdf, disabled: exporting || students.length === 0,
                    title: 'รวมการ์ดทุกคนเป็น PDF เดียว แล้วเปิดพรีวิวในแท็บใหม่ — ยังไม่สร้างไฟล์ ตรวจแล้วค่อยกดเซฟจากตัวอ่าน PDF',
                  },
                ].map((b) => (
                  <button
                    key={b.label}
                    className={`btn btn-sm flex-1 gap-1.5 sm:flex-none ${b.variant}`}
                    onClick={b.onClick}
                    disabled={b.disabled}
                    title={b.title}
                  >
                    <Icon name={b.icon} size={15} />
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Quote Approval ── */}
          {students.some(s => s.quote) && (
            <div className="card bg-base-100 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="gt-chip size-8">
                    <Icon name="sparkle" size={16} />
                  </span>
                  <h2 className="text-sm font-semibold sm:text-base">อนุมัติคำคม</h2>
                </div>
                <div className="flex gap-1">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => setApprovedQuotes(new Set(students.map(s => s.student_code)))}
                  >
                    เลือกทั้งหมด
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setApprovedQuotes(new Set())}>
                    ยกเลิกทั้งหมด
                  </button>
                </div>
              </div>
              <div className="relative mb-2">
                <Icon
                  name="search"
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40"
                />
                <input
                  className="input input-xs w-full pl-7"
                  placeholder="ค้นหาชื่อนักเรียน..."
                  value={quoteSearch}
                  onChange={e => setQuoteSearch(e.target.value)}
                  aria-label="ค้นหาชื่อนักเรียน"
                />
              </div>
              {(() => {
                const filtered = students.filter(s => s.quote && (
                  `${s.first_name} ${s.last_name}`.toLowerCase().includes(quoteSearch.toLowerCase()) ||
                  s.student_code.includes(quoteSearch)
                ));
                return (
                  <>
                    <p className="text-xs text-base-content/40 mb-1">{filtered.length} คน (อนุมัติแล้ว {filtered.filter(s => approvedQuotes.has(s.student_code)).length} คน)</p>
                    <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
                      {filtered.map(s => (
                        <label key={s.student_code} className="flex items-start gap-3 cursor-pointer hover:bg-base-200 rounded-lg px-2 py-1.5">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm checkbox-primary mt-0.5 shrink-0"
                            checked={approvedQuotes.has(s.student_code)}
                            onChange={e => {
                              setApprovedQuotes(prev => {
                                const next = new Set(prev);
                                e.target.checked ? next.add(s.student_code) : next.delete(s.student_code);
                                return next;
                              });
                            }}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold">{s.title_prefix}{s.first_name} {s.last_name} <span className="opacity-40">{s.student_code}</span></p>
                            <p className="text-xs text-base-content/60 italic line-clamp-2">{s.quote}</p>
                          </div>
                        </label>
                      ))}
                      {filtered.length === 0 && <p className="text-xs text-center opacity-40 py-4">ไม่พบนักเรียน</p>}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
