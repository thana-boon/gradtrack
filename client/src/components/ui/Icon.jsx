/**
 * ชุดไอคอนเส้น (แนว lucide) ของ GradTrack
 *
 * ทำไมไม่ใช้ emoji: emoji เรนเดอร์ต่างกันทุก OS คุมสี/ขนาด/น้ำหนักเส้นไม่ได้
 * และไม่รับ currentColor — พอวางบนพื้นม่วงเข้มก็เละ ที่นี่ใช้ SVG stroke ล้วน
 * strokeWidth 1.7 เท่ากันทั้งระบบ และรับสีจาก text-* ของ Tailwind ได้ตรง ๆ
 *
 * ใช้: <Icon name="users" className="size-4 text-primary" />
 * ไอคอนเป็น decoration เสมอ (aria-hidden) — ปุ่มที่มีแต่ไอคอนต้องใส่ aria-label เอง
 */

const P = (d, key) => <path key={key} d={d} />;

const ICONS = {
  /* ── นำทาง ─────────────────────────────────────────────── */
  dashboard: () => [
    <rect key="a" x="3" y="3" width="7" height="9" rx="1.5" />,
    <rect key="b" x="14" y="3" width="7" height="5" rx="1.5" />,
    <rect key="c" x="14" y="12" width="7" height="9" rx="1.5" />,
    <rect key="d" x="3" y="16" width="7" height="5" rx="1.5" />,
  ],
  users: () => [
    P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'a'),
    <circle key="b" cx="9" cy="7" r="4" />,
    P('M22 21v-2a4 4 0 0 0-3-3.87', 'c'),
    P('M16 3.13a4 4 0 0 1 0 7.75', 'd'),
  ],
  calendar: () => [
    <rect key="a" x="3" y="4" width="18" height="18" rx="2" />,
    P('M16 2v4M8 2v4M3 10h18', 'b'),
    P('M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01', 'c'),
  ],
  graduation: () => [
    P('M22 10 12 5 2 10l10 5 10-5Z', 'a'),
    P('M6 12.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5', 'b'),
    P('M22 10v6', 'c'),
  ],
  university: () => [
    P('M12 2 3 7h18l-9-5Z', 'a'),
    P('M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7', 'b'),
  ],
  faculty: () => [
    <rect key="a" x="3" y="9" width="7" height="12" rx="1.5" />,
    <rect key="b" x="14" y="3" width="7" height="18" rx="1.5" />,
    P('M6.5 13h1M6.5 17h1M17.5 7h1M17.5 11h1M17.5 15h1', 'c'),
  ],
  clipboard: () => [
    <rect key="a" x="8" y="2" width="8" height="4" rx="1" />,
    P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'b'),
    P('M12 11h4M12 16h4M8 11h.01M8 16h.01', 'c'),
  ],
  chart: () => [P('M3 3v16a2 2 0 0 0 2 2h16', 'a'), P('M7 15l4-5 3 3 5-6', 'b')],
  pieChart: () => [
    P('M21 12A9 9 0 1 1 12 3v9h9Z', 'a'),
    P('M15.5 3.5A9 9 0 0 1 20.5 8.5L15.5 10.5V3.5Z', 'b'),
  ],
  /* แท่งนอน — สื่อว่าเป็นกราฟแท่งเรียงมาก→น้อย ไม่ใช่แท่งตั้งตามเวลา */
  barChart: () => [
    P('M4 4v16', 'a'),
    P('M7 7h11M7 12h7M7 17h9', 'b'),
  ],
  table: () => [
    <rect key="a" x="3" y="3" width="18" height="18" rx="2" />,
    P('M3 9h18M3 15h18M9 3v18', 'b'),
  ],
  log: () => [
    P('M19 17V5a2 2 0 0 0-2-2H5', 'a'),
    P('M8 21h11a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V6a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3', 'b'),
    P('M9 8h7M9 12h5', 'c'),
  ],
  search: () => [<circle key="a" cx="11" cy="11" r="7.5" />, P('m21 21-4.3-4.3', 'b')],
  home: () => [
    P('m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'a'),
    P('M9 21v-7h6v7', 'b'),
  ],

  /* ── การกระทำ ──────────────────────────────────────────── */
  plus: () => [P('M12 5v14M5 12h14', 'a')],
  minus: () => [P('M5 12h14', 'a')],
  x: () => [P('M18 6 6 18M6 6l12 12', 'a')],
  check: () => [P('M20 6 9 17l-5-5', 'a')],
  edit: () => [
    P('M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'a'),
    P('M18.4 2.6a2 2 0 0 1 2.8 2.8l-9 9-3.7 1 1-3.7z', 'b'),
  ],
  trash: () => [
    P('M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'a'),
    P('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6', 'b'),
  ],
  save: () => [
    P('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z', 'a'),
    P('M17 21v-8H7v8M7 3v5h7', 'b'),
  ],
  refresh: () => [
    P('M21 12a9 9 0 1 1-2.64-6.36L21 8', 'a'),
    P('M21 3v5h-5', 'b'),
  ],
  download: () => [
    P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'a'),
    P('m7 10 5 5 5-5M12 15V3', 'b'),
  ],
  upload: () => [
    P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'a'),
    P('m17 8-5-5-5 5M12 3v12', 'b'),
  ],
  print: () => [
    P('M6 9V3h12v6', 'a'),
    P('M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'b'),
    <rect key="c" x="6" y="14" width="12" height="8" rx="1" />,
  ],
  eye: () => [
    P('M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7Z', 'a'),
    <circle key="b" cx="12" cy="12" r="3" />,
  ],
  eyeOff: () => [
    P('M9.9 9.9a3 3 0 0 0 4.2 4.2', 'a'),
    P('M10.7 5.1A10.5 10.5 0 0 1 12 5c6.2 0 10 7 10 7a13.3 13.3 0 0 1-2.2 3.2', 'b'),
    P('M6.6 6.6A13.5 13.5 0 0 0 2 12s3.8 7 10 7a9.8 9.8 0 0 0 4.2-.9', 'c'),
    P('m2 2 20 20', 'd'),
  ],
  filter: () => [P('M22 4H2l8 9.2V21l4-2.2v-5.6L22 4Z', 'a')],
  copy: () => [
    <rect key="a" x="9" y="9" width="12" height="12" rx="2" />,
    P('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1', 'b'),
  ],
  link: () => [
    P('M15 3h6v6M10 14 21 3', 'a'),
    P('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'b'),
  ],
  logout: () => [
    P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'a'),
    P('m16 17 5-5-5-5M21 12H9', 'b'),
  ],
  login: () => [
    P('M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'a'),
    P('m10 17 5-5-5-5M15 12H3', 'b'),
  ],
  undo: () => [
    P('M9 14 4 9l5-5', 'a'),
    P('M4 9h10.5a5.5 5.5 0 0 1 0 11H11', 'b'),
  ],
  menu: () => [P('M4 6h16M4 12h16M4 18h16', 'a')],
  panelClose: () => [
    <rect key="a" x="3" y="3" width="18" height="18" rx="2" />,
    P('M9 3v18m7-3-3-3 3-3', 'b'),
  ],
  panelOpen: () => [
    <rect key="a" x="3" y="3" width="18" height="18" rx="2" />,
    P('M9 3v18m5-9 3 3-3 3', 'b'),
  ],

  /* ── ทิศทาง ────────────────────────────────────────────── */
  chevronDown: () => [P('m6 9 6 6 6-6', 'a')],
  chevronUp: () => [P('m18 15-6-6-6 6', 'a')],
  chevronLeft: () => [P('m15 18-6-6 6-6', 'a')],
  chevronRight: () => [P('m9 18 6-6-6-6', 'a')],
  arrowLeft: () => [P('M19 12H5m7-7-7 7 7 7', 'a')],
  arrowRight: () => [P('M5 12h14m-7-7 7 7-7 7', 'a')],
  arrowUpRight: () => [P('M7 17 17 7M8 7h9v9', 'a')],

  /* ── สถานะ ─────────────────────────────────────────────── */
  checkCircle: () => [<circle key="a" cx="12" cy="12" r="9.5" />, P('m8.5 12 2.5 2.5 5-5', 'b')],
  xCircle: () => [<circle key="a" cx="12" cy="12" r="9.5" />, P('m15 9-6 6m0-6 6 6', 'b')],
  alert: () => [<circle key="a" cx="12" cy="12" r="9.5" />, P('M12 7.5v5M12 16h.01', 'b')],
  warning: () => [
    P('m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z', 'a'),
    P('M12 9v4M12 17h.01', 'b'),
  ],
  info: () => [<circle key="a" cx="12" cy="12" r="9.5" />, P('M12 16v-4.5M12 8h.01', 'b')],
  clock: () => [<circle key="a" cx="12" cy="12" r="9.5" />, P('M12 6.5V12l3.5 2', 'b')],
  shield: () => [
    P('M20 12c0 5-3.5 7.6-7.7 9a1 1 0 0 1-.6 0C7.5 19.6 4 17 4 12V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.3-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z', 'a'),
    P('m9 12 2 2 4-4', 'b'),
  ],
  star: () => [P('m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z', 'a')],
  sparkle: () => [
    P('m12 3 1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4z', 'a'),
    P('M19 16.5 19.6 18l1.4.5-1.4.5L19 20.5l-.6-1.5L17 18.5l1.4-.5z', 'b'),
  ],
  inbox: () => [
    P('M22 12h-5l-2 3H9l-2-3H2', 'a'),
    P('M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z', 'b'),
  ],

  /* ── วัตถุ ─────────────────────────────────────────────── */
  user: () => [
    P('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'a'),
    <circle key="b" cx="12" cy="7" r="4" />,
  ],
  userPlus: () => [
    P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'a'),
    <circle key="b" cx="9" cy="7" r="4" />,
    P('M19 8v6M22 11h-6', 'c'),
  ],
  key: () => [
    <circle key="a" cx="15.5" cy="8.5" r="4.5" />,
    P('m12.3 11.7-9.3 9.3v-3h3v-3h3v-2', 'b'),
  ],
  lock: () => [
    <rect key="a" x="4" y="10" width="16" height="11" rx="2" />,
    P('M8 10V7a4 4 0 0 1 8 0v3', 'b'),
  ],
  idCard: () => [
    <rect key="a" x="2" y="5" width="20" height="14" rx="2" />,
    <circle key="b" cx="8.5" cy="11" r="2.2" />,
    P('M5 16.2c.6-1.3 2-2 3.5-2s2.9.7 3.5 2M15 10h4M15 14h3', 'c'),
  ],
  image: () => [
    <rect key="a" x="3" y="3" width="18" height="18" rx="2" />,
    <circle key="b" cx="9" cy="9" r="1.8" />,
    P('m21 15-4.4-4.3a2 2 0 0 0-2.8 0L4 20', 'c'),
  ],
  camera: () => [
    P('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z', 'a'),
    <circle key="b" cx="12" cy="13" r="3.2" />,
  ],
  file: () => [
    P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'a'),
    P('M14 2v5h5M9 13h6M9 17h4', 'b'),
  ],
  sheet: () => [
    P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'a'),
    P('M14 2v5h5M8 13h3M13 13h3M8 17h3M13 17h3', 'b'),
  ],
  list: () => [P('M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01', 'a')],
  building: () => [
    <rect key="a" x="4" y="3" width="16" height="18" rx="2" />,
    P('M9 8h.01M15 8h.01M9 12h.01M15 12h.01M10 21v-4h4v4', 'b'),
  ],
  pin: () => [
    P('M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0Z', 'a'),
    <circle key="b" cx="12" cy="10" r="3" />,
  ],
  settings: () => [
    P('M21 5h-6M10 5H3M21 12h-3M13 12H3M21 19h-8M8 19H3', 'a'),
    <circle key="b" cx="12.5" cy="5" r="2.2" />,
    <circle key="c" cx="15.5" cy="12" r="2.2" />,
    <circle key="d" cx="10.5" cy="19" r="2.2" />,
  ],
  zap: () => [P('M13 2 4 14h7l-1 8 9-12h-7l1-8Z', 'a')],
  bell: () => [
    P('M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'a'),
    P('M13.7 21a2 2 0 0 1-3.4 0', 'b'),
  ],
};

export default function Icon({ name, size = 18, className = '', strokeWidth = 1.7, ...rest }) {
  const render = ICONS[name];
  if (!render) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {render()}
    </svg>
  );
}
