import { useEffect, useRef, useState } from 'react';

/**
 * ทางกลับไปหน้าแรก SchoolOS สำหรับจอที่ไม่มี sidebar ให้วางลิงก์ — มือถือในบราวเซอร์
 * และ PWA ที่ติดตั้งลงเครื่องแล้ว (ซึ่งไม่มีแถบ URL ให้พิมพ์เองด้วย)
 * จอโน้ตบุ๊กที่เปิดในแท็บบราวเซอร์ปกติมีเมนูของแอปอยู่แล้ว CSS ข้างล่างจึงซ่อนปุ่มไว้
 * เช่นเดียวกับตอนสั่งพิมพ์ (หน้า print ของระบบนี้พึ่งกฎ @media print ข้อนั้น)
 *
 * ตำแหน่งที่ผู้ใช้ลากไปวางถูกจำเป็น ANCHOR (ชิดมุมไหน ห่างเท่าไร) ไม่ใช่ {x, y}
 * เพราะมือถือกว้าง 390px กับ iPad 834px ตีความ x=340 คนละแบบ
 * แต่ "ห่างจากขอบขวา 16px" ยังหมายถึงที่เดิมทั้งตอนหมุนจอ ย่อหน้าต่าง และเปลี่ยนเครื่อง
 */

// ที่อยู่ portal — ตั้ง VITE_SCHOOLOS_HOME ตอน build ถ้าจะย้าย
const SCHOOLOS_HOME_URL =
  import.meta.env.VITE_SCHOOLOS_HOME || 'https://schoolos.sukhon.ac.th/';

const STORAGE_KEY = 'schoolos-fab-anchor';
const SIZE = 64; // px — ต้องเท่ากับ width ใน CSS ข้างล่าง
const MARGIN = 16; // px — ระยะห่างขั้นต่ำจากขอบจอ
const BOTTOM_INSET = 60; // px — เผื่อแถบเมนูล่างบนมือถือ
const DRAG_THRESHOLD = 4; // px — เกินนี้ถึงนับว่า "ลาก" ไม่ใช่ "กด"

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ h: 'left'|'right', v: 'top'|'bottom', dx: number, dy: number }} Anchor */

/** @type {Anchor} */
const DEFAULT_ANCHOR = { h: 'right', v: 'bottom', dx: MARGIN, dy: MARGIN + BOTTOM_INSET };

/**
 * หน้าตาและเงื่อนไขการแสดงผลอยู่ใน CSS ไม่ใช่ JS — ไม่ต้องมี matchMedia
 * คอยเดินคู่กับ breakpoint
 *
 * กฎฝั่งเดสก์ท็อปเขียนแบบ "ซ่อนก่อนแล้วค่อยเปิดคืน" แทนที่จะใช้ (display-mode: browser)
 * คำถามเดียว เพราะบราวเซอร์ที่ไม่รู้จัก display-mode จะทิ้งทั้ง query — และผลที่อยากได้
 * ในกรณีนั้นคือ "ซ่อนบนจอกว้าง" ไม่ใช่ "โผล่ทุกที่"
 */
const CSS = `
.skdw-back-fab {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 64px;
  padding: 10px 6px;
  border-radius: 16px;
  background: #5b2d8e;
  color: #fff;
  box-shadow: 0 10px 15px -3px rgba(91, 45, 142, 0.35);
  text-decoration: none;
  opacity: 0.7;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.skdw-back-fab:active { transform: scale(0.95); }
.skdw-back-fab[data-dragging='true'] { opacity: 1; transition: none; }
.skdw-back-fab-label {
  font-size: 9px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: 0.02em;
  text-align: center;
}
@media print {
  .skdw-back-fab { display: none !important; }
}
@media (min-width: 1024px) {
  .skdw-back-fab { display: none; }
}
@media (min-width: 1024px) and (display-mode: standalone) {
  .skdw-back-fab { display: flex; }
}
@media (min-width: 1024px) and (display-mode: fullscreen) {
  .skdw-back-fab { display: flex; }
}
@media (min-width: 1024px) and (display-mode: minimal-ui) {
  .skdw-back-fab { display: flex; }
}
@media (min-width: 1024px) {
  /* iOS รองรับ display-mode ช้ากว่าเพื่อน — iPad ที่ add to home screen
     บอกผ่าน navigator.standalone แทน */
  .skdw-back-fab[data-standalone='true'] { display: flex; }
}
`;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** @param {Anchor} a @returns {Point} */
function resolveAnchor(a) {
  const maxX = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  return {
    x: clamp(a.h === 'left' ? a.dx : window.innerWidth - SIZE - a.dx, MARGIN, maxX),
    y: clamp(a.v === 'top' ? a.dy : window.innerHeight - SIZE - a.dy, MARGIN, maxY),
  };
}

/** มุมที่ใกล้ที่สุดชนะ ปล่อยกลางจอแล้วปุ่มจึงเลื่อนไปชิดขอบเอง */
function toAnchor(pos) {
  const h = pos.x + SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right';
  const v = pos.y + SIZE / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
  return {
    h,
    v,
    dx: Math.max(0, h === 'left' ? pos.x : window.innerWidth - SIZE - pos.x),
    dy: Math.max(0, v === 'top' ? pos.y : window.innerHeight - SIZE - pos.y),
  };
}

function readStoredAnchor() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_ANCHOR;
    const parsed = JSON.parse(stored);
    if (
      (parsed.h !== 'left' && parsed.h !== 'right') ||
      (parsed.v !== 'top' && parsed.v !== 'bottom') ||
      !Number.isFinite(parsed.dx) ||
      !Number.isFinite(parsed.dy)
    ) {
      return DEFAULT_ANCHOR;
    }
    return { h: parsed.h, v: parsed.v, dx: parsed.dx, dy: parsed.dy };
  } catch {
    // โหมดส่วนตัว หรือบล็อก site data — ปุ่มยังใช้ได้ แค่จำที่วางไม่ได้
    return DEFAULT_ANCHOR;
  }
}

export default function BackToSchoolOS() {
  const [pos, setPos] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [iosStandalone, setIosStandalone] = useState(false);
  const anchorRef = useRef(DEFAULT_ANCHOR);
  const dragRef = useRef(null);

  useEffect(() => {
    anchorRef.current = readStoredAnchor();
    setPos(resolveAnchor(anchorRef.current));
    setIosStandalone(window.navigator.standalone === true);
  }, []);

  useEffect(() => {
    // คำนวณใหม่จาก anchor ไม่ใช่ clamp พิกัดเดิม — iPad ที่หมุนจอแล้วโดนแค่ clamp
    // จะไปติดผิดขอบ
    function handleResize() {
      setPos((prev) => (prev ? resolveAnchor(anchorRef.current) : prev));
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  function handlePointerDown(e) {
    if (!pos) return;
    // capture ไว้ให้ pointermove ยังส่งมาแม้นิ้วจะวิ่งเลยตัวปุ่มไปแล้ว
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      dragged: false,
    };
    setDragging(true);
  }

  function handlePointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.dragged = true;
    setPos({
      x: clamp(drag.originX + dx, MARGIN, Math.max(MARGIN, window.innerWidth - SIZE - MARGIN)),
      y: clamp(drag.originY + dy, MARGIN, Math.max(MARGIN, window.innerHeight - SIZE - MARGIN)),
    });
  }

  function handlePointerUp() {
    if (!dragRef.current) return;
    setDragging(false);
    setPos((current) => {
      if (!current) return current;
      const anchor = toAnchor(current);
      anchorRef.current = anchor;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(anchor));
      } catch {
        // เหมือนข้างบน — จำไม่ได้ก็ยังกดได้
      }
      return resolveAnchor(anchor);
    });
    // เคลียร์ช้าไปหนึ่ง tick เพราะคลิกที่ตามหลัง pointerup ต้องยังอ่านได้ว่าเพิ่งลากมา
    setTimeout(() => {
      dragRef.current = null;
    }, 0);
  }

  function handleClick(e) {
    if (dragRef.current?.dragged) e.preventDefault();
  }

  if (!pos) return null;

  return (
    <>
      <style>{CSS}</style>
      <a
        className="skdw-back-fab"
        href={SCHOOLOS_HOME_URL}
        target="_self"
        aria-label="กลับไปหน้าแรก SchoolOS"
        draggable={false}
        data-dragging={dragging ? 'true' : 'false'}
        data-standalone={iosStandalone ? 'true' : 'false'}
        style={{ left: pos.x, top: pos.y }}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9 21v-6h6v6" />
        </svg>
        <span className="skdw-back-fab-label">Back to SchoolOS</span>
      </a>
    </>
  );
}
