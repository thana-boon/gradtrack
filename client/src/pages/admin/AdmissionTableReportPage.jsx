import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { domToCanvas } from 'modern-screenshot';
import { saveAs } from 'file-saver';
import api from '../../utils/api';
import { withBase } from '../../utils/withBase';
import Icon from '../../components/ui/Icon';
import { PageHeader, TableWrap, EmptyState, Tag } from '../../components/ui';

// จานสีกราฟ: ไล่จากสีหลักของแบรนด์ (ม่วง → ทอง → เขียว → น้ำเงิน → แดง) แล้ววนโทนใกล้เคียง
// เรียงให้สีที่อยู่ติดกันต่างกันชัด เพราะ pie chart วางชิ้นติดกัน
const PIE_COLORS = [
  '#5b2d8e','#f5c518','#16a34a','#1e2a5e','#dc2626','#7a3fc0',
  '#c79b00','#0d9488','#3b5bb5','#b91c1c','#9b6ad4','#8a6a00',
  '#15803d','#2563eb','#e11d48','#a855f7','#d97706','#059669',
  '#1d4ed8','#f472b6',
];

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const THAI_YEARS = Array.from({ length: 16 }, (_, i) => 2560 + i); // พ.ศ. 2560–2575

// 'YYYY-MM-DD' → '5 มี.ค. 2569' (ไว้ใส่ในภาพ/ไฟล์ที่ export ให้รู้ว่ากรองช่วงไหนไว้)
const thaiDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1] || ''} ${y + 543}`;
};

// ── รายงานรายคณะ: ตัวเลือกการเรียง ──────────────────────────────────────────
// ผู้ใช้เลือกได้ว่าจะให้คณะไหนขึ้นก่อน — คนดูรายงานคนละคนสนใจคนละมุม
// (หัวหน้าระดับดูว่าคณะไหนคนติดเยอะ, ฝ่ายแนะแนวไล่หาคณะตามชื่อ)
const FACULTY_SORTS = [
  { key: 'count',     label: 'จำนวนนักเรียนที่ติด (มาก → น้อย)' },
  { key: 'confirmed', label: 'จำนวนที่ยืนยันสิทธิ์ (มาก → น้อย)' },
  { key: 'name',      label: 'ชื่อคณะ (ก → ฮ)' },
  { key: 'uni',       label: 'ชื่อมหาวิทยาลัย (ก → ฮ)' },
  { key: 'custom',    label: 'กำหนดลำดับเอง' },
];

// กราฟในหน้าต่างวิเคราะห์ — เลือกได้ว่าจะบันทึกอันไหนบ้าง
// (บันทึกทีเดียวทั้งสามอันได้ภาพยาวมากจนเอาไปวางในเอกสารลำบาก)
const CHART_DEFS = [
  { key: 'uni',  title: 'มหาวิทยาลัยที่สอบติด',    short: 'มหาวิทยาลัย', sheet: 'มหาวิทยาลัย',   head: 'มหาวิทยาลัย' },
  { key: 'fac',  title: 'คณะที่สอบติด',            short: 'คณะ',        sheet: 'คณะ',          head: 'คณะ' },
  { key: 'prog', title: 'สาขา/กลุ่มวิชาที่สอบติด', short: 'สาขา',       sheet: 'สาขากลุ่มวิชา', head: 'สาขา/กลุ่มวิชา' },
];

// คอลัมน์ประจำตัวนักเรียนใน PDF — บางรายงานที่ส่งออกไปข้างนอกไม่ควรมีรหัส/เลขที่ติดไปด้วย
// ชื่อ-นามสกุลไม่อยู่ในนี้เพราะต้องมีเสมอ (ไม่งั้นอ่านรายงานไม่รู้เรื่อง)
const PDF_COLUMNS = [
  { key: 'class', label: 'ชั้น' },
  { key: 'room',  label: 'ห้อง' },
  { key: 'seat',  label: 'เลขที่' },
  { key: 'code',  label: 'รหัสประจำตัว' },
];
const ALL_PDF_COLUMNS = { class: true, room: true, seat: true, code: true };

const LS_PDF_COLS = 'gradtrack-report-pdf-columns';
const LS_FAC_ORDER = 'gradtrack-report-faculty-order';

const loadJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const saveJSON = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* โควตาเต็ม/โหมดส่วนตัว — ไม่ใช่เรื่องคอขาดบาดตาย */ }
};

function ThaiDatePicker({ value, onChange }) {
  const parse = (v) => {
    if (!v) return { day: '', month: '', year: '' };
    const p = v.split('-');
    return { day: parseInt(p[2]) || '', month: parseInt(p[1]) || '', year: parseInt(p[0]) + 543 || '' };
  };

  const [local, setLocal] = useState(() => parse(value));

  // sync เมื่อ parent ล้างค่า (เช่น กดปุ่ม ✕ ล้าง)
  useEffect(() => { setLocal(parse(value)); }, [value]);

  const handleChange = (field, val) => {
    const next = { ...local, [field]: val };
    setLocal(next);
    if (next.day && next.month && next.year) {
      onChange(`${next.year - 543}-${String(next.month).padStart(2,'0')}-${String(next.day).padStart(2,'0')}`);
    } else {
      onChange('');
    }
  };

  return (
    <div className="flex gap-1">
      <select className="select select-sm w-16"
        aria-label="วัน"
        value={local.day} onChange={e => handleChange('day', Number(e.target.value))}>
        <option value="">วัน</option>
        {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <select className="select select-sm w-[4.5rem]"
        aria-label="เดือน"
        value={local.month} onChange={e => handleChange('month', Number(e.target.value))}>
        <option value="">เดือน</option>
        {THAI_MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
      </select>
      <select className="select select-sm w-24"
        aria-label="ปี พ.ศ."
        value={local.year} onChange={e => handleChange('year', Number(e.target.value))}>
        <option value="">ปี พ.ศ.</option>
        {THAI_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

// ตารางสรุปตัวเลขในกราฟ — คนอ่านหน้าจอ/คนตาบอดสีต้องได้ข้อมูลเท่ากับคนที่เห็นสี
function ChartLegend({ data, total, colors, scroll = false }) {
  // data-scrollpanel: ตอน export เป็นรูปต้องคลายความสูงออกก่อน ไม่งั้นรายการที่เลื่อนดูหายไปจากภาพ
  return (
    <ul
      data-scrollpanel={scroll ? '' : undefined}
      className={`flex flex-col gap-1 ${scroll ? 'max-h-80 overflow-y-auto' : 'mt-2'}`}
    >
      {data.map((d, i) => (
        <li key={d.name} className="flex items-center gap-2 text-xs">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ background: colors[i % colors.length] }}
          />
          <span className="flex-1 truncate">{d.name}</span>
          <span className="whitespace-nowrap font-semibold tabular-nums">{d.value} รายการ</span>
          <span className="whitespace-nowrap tabular-nums text-base-content/50">
            ({((d.value / total) * 100).toFixed(1)}%)
          </span>
        </li>
      ))}
    </ul>
  );
}

// เมนูติ๊กเลือกคอลัมน์ที่จะให้ติดไปในไฟล์ PDF (ใช้ร่วมกันทั้งรายงานตารางและรายงานรายคณะ)
function PdfColumnMenu({ cols, onToggle }) {
  const ref = useRef(null);

  // <details> ไม่ปิดตัวเองเวลาคลิกนอกกล่อง ต้องปิดให้เอง ไม่งั้นเมนูค้างทับปุ่มอื่น
  useEffect(() => {
    const close = (e) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target)) el.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const picked = PDF_COLUMNS.filter(c => cols[c.key]).length;

  return (
    <details ref={ref} className="dropdown dropdown-end">
      <summary className="btn btn-ghost btn-sm gap-1.5">
        <Icon name="filter" size={14} />
        คอลัมน์ PDF
        <span className="tabular-nums text-xs text-base-content/55">{picked}/{PDF_COLUMNS.length}</span>
      </summary>
      <div className="dropdown-content z-30 mt-1 w-56 border border-base-300 bg-base-100 p-3 shadow-xl">
        <p className="mb-2 text-xs leading-relaxed text-base-content/55">
          เลือกคอลัมน์ที่จะมีในไฟล์ PDF<br />
          (ชื่อ-นามสกุลมีให้เสมอ)
        </p>
        {PDF_COLUMNS.map(c => (
          <label key={c.key} className="flex cursor-pointer items-center gap-2 py-1">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={!!cols[c.key]}
              onChange={() => onToggle(c.key)}
            />
            <span className="text-sm">{c.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

// จัดลำดับคณะเอง — ลากสลับได้ หรือกดลูกศรทีละขั้นสำหรับคนที่ลากไม่ถนัด/ใช้คีย์บอร์ด
function FacultyOrderPanel({ names, onReorder, onReset }) {
  const [dragIndex, setDragIndex] = useState(null);

  const move = (from, to) => {
    if (to < 0 || to >= names.length || from === to) return;
    const next = [...names];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next);
  };

  if (names.length === 0) return null;

  return (
    <div className="no-print card mb-3 border border-base-300 bg-base-100 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-xs text-base-content/60">
          ลากสลับ หรือกดลูกศรเพื่อจัดลำดับคณะ — ลำดับนี้ถูกจำไว้ใช้ครั้งต่อไปด้วย
        </p>
        <button className="btn btn-ghost btn-xs ml-auto gap-1" onClick={onReset}>
          <Icon name="undo" size={12} />
          เรียงตามจำนวนเหมือนเดิม
        </button>
      </div>
      <ol className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
        {names.map((name, i) => (
          <li
            key={name}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (dragIndex !== null) move(dragIndex, i); setDragIndex(null); }}
            onDragEnd={() => setDragIndex(null)}
            className={`flex cursor-grab items-center gap-2 rounded-lg border border-base-300 bg-base-200/40 px-2 py-1.5 text-sm ${
              dragIndex === i ? 'opacity-40' : ''
            }`}
          >
            <span className="w-6 shrink-0 text-center text-xs tabular-nums text-base-content/45">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span className="flex shrink-0 gap-0.5">
              <button
                className="btn btn-ghost btn-xs px-1"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                aria-label={`ย้าย ${name} ขึ้น`}
              >
                <Icon name="chevronUp" size={14} />
              </button>
              <button
                className="btn btn-ghost btn-xs px-1"
                onClick={() => move(i, i + 1)}
                disabled={i === names.length - 1}
                aria-label={`ย้าย ${name} ลง`}
              >
                <Icon name="chevronDown" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function AdmissionTableReportPage() {
  const [yearId, setYearId] = useState('');
  const [yearName, setYearName] = useState('');
  const [years, setYears] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [chartMode, setChartMode] = useState('all'); // 'all' | 'confirmed'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [includeNoData, setIncludeNoData] = useState(true);
  // ── รายงานรายคณะ ──
  const [facSort, setFacSort] = useState('count');
  const [facGroupUni, setFacGroupUni] = useState(false);   // แยกคณะเดียวกันตามมหาวิทยาลัย
  const [facOnlyConfirmed, setFacOnlyConfirmed] = useState(false);
  // ลำดับคณะที่ผู้ใช้จัดเอง (เก็บเป็นชื่อคณะ ไม่ใช่ key ของกลุ่ม — ลำดับจะได้ไม่หายเวลาสลับ "แยกตามมหาวิทยาลัย")
  const [facOrder, setFacOrder] = useState(() => loadJSON(LS_FAC_ORDER, []));
  // ── export ──
  const [pdfCols, setPdfCols] = useState(() => ({ ...ALL_PDF_COLUMNS, ...loadJSON(LS_PDF_COLS, {}) }));
  const [chartPick, setChartPick] = useState({ uni: true, fac: true, prog: true });
  const [chartExporting, setChartExporting] = useState(false);
  const chartAreaRef = useRef(null);
  const chartTitleRef = useRef(null);
  const pairGridRef = useRef(null);

  const togglePdfCol = (key) => {
    setPdfCols(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveJSON(LS_PDF_COLS, next);
      return next;
    });
  };

  const applyFacOrder = (names) => {
    // ชื่อที่เคยจัดไว้แต่ปีนี้ไม่มีข้อมูล เก็บต่อท้ายไว้ ไม่ให้ลำดับที่ตั้งไว้หายไปเวลาสลับปีการศึกษา
    const next = [...names, ...facOrder.filter(n => !names.includes(n))];
    setFacOrder(next);
    saveJSON(LS_FAC_ORDER, next);
  };

  const filterByDate = useCallback((admissions) => {
    if (!dateFrom && !dateTo) return admissions;
    return admissions.filter(a => {
      if (!a.created_at) return false;
      const d = new Date(a.created_at);
      if (dateFrom && d < new Date(dateFrom + 'T00:00:00')) return false;
      if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
      return true;
    });
  }, [dateFrom, dateTo]);

  // Load academic years
  useEffect(() => {
    Promise.all([
      api.get('/academic-years').then(r => r.data || []),
      api.get('/academic-years/active').then(r => r.data || null).catch(() => null),
    ]).then(([ys, active]) => {
      setYears(ys);
      if (active?.active_year_id) {
        const activeYear = ys.find(y => String(y.id) === String(active.active_year_id)) || active.year;
        setYearId(String(active.active_year_id));
        setYearName(String(activeYear?.year_be || activeYear?.title || activeYear?.name || ''));
        return;
      }
      if (ys.length > 0) {
        setYearId(String(ys[0].id));
        setYearName(String(ys[0].year_be || ys[0].title || ys[0].name || ''));
      }
    });
  }, []);

  // Load students when yearId changes
  useEffect(() => {
    if (!yearId) return;
    setLoading(true);
    api.get('/student/admin/admission-overview', { params: { year_id: yearId } })
      .then(r => {
        // Include ALL students (even those with no admissions)
        setStudents(r.data || []);
      })
      .finally(() => setLoading(false));
  }, [yearId]);

  // Flatten to rows for table/export — admissions filtered by date range
  const exportStudents = includeNoData
    ? students
    : students.filter(s => filterByDate(s.admissions || []).length > 0);

  const flatRows = exportStudents.map((s, si) => {
    const admissions = filterByDate(s.admissions || []);
    if (admissions.length === 0) {
      return [{
        seq: si + 1,
        class_level: s.class_level,
        class_room: s.class_room,
        number_in_room: s.number_in_room,
        student_code: s.student_code,
        title_prefix: s.title_prefix,
        first_name: s.first_name,
        last_name: s.last_name,
        university_name: '',
        faculty_name: '',
        program_name: '',
        confirmed: '',
        rowSpan: 1,
        isFirst: true,
      }];
    }
    return admissions.map((a, ai) => ({
      seq: si + 1,
      class_level: s.class_level,
      class_room: s.class_room,
      number_in_room: s.number_in_room,
      student_code: s.student_code,
      title_prefix: s.title_prefix,
      first_name: s.first_name,
      last_name: s.last_name,
      university_name: a.university_name || '',
      faculty_name: a.faculty_name || '',
      program_name: a.program_name || '',
      confirmed: a.confirmed ? 'ยืนยัน' : '',
      rowSpan: ai === 0 ? admissions.length : 0,
      isFirst: ai === 0,
    }));
  }).flat();

  // ── Export Excel ──
  const exportExcel = () => {
    const data = flatRows.map(r => ({
      'ลำดับ': r.isFirst ? r.seq : '',
      'ชั้น': r.isFirst ? r.class_level : '',
      'ห้อง': r.isFirst ? r.class_room : '',
      'เลขที่': r.isFirst ? r.number_in_room : '',
      'รหัสนักเรียน': r.isFirst ? r.student_code : '',
      'ชื่อ': r.isFirst ? `${r.title_prefix || ''}${r.first_name || ''}` : '',
      'นามสกุล': r.isFirst ? r.last_name : '',
      'มหาวิทยาลัย': r.university_name,
      'คณะ': r.faculty_name,
      'สาขา': r.program_name,
      'ยืนยันสิทธิ์': r.confirmed,
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    // Column widths
    ws['!cols'] = [
      { wch: 7 }, { wch: 8 }, { wch: 6 }, { wch: 7 }, { wch: 12 },
      { wch: 16 }, { wch: 18 }, { wch: 36 }, { wch: 30 }, { wch: 28 }, { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ผลการสอบ');
    XLSX.writeFile(wb, `ผลการสอบ_${yearName}.xlsx`);
  };

  // ── Export PDF (print tab) ──
  const exportPdf = () => {
    localStorage.setItem(
      'gradtrack-table-print-data',
      JSON.stringify({ flatRows, yearName, cols: pdfCols })
    );
    window.open(withBase('/admin/report-table/print'), '_blank');
  };

  // ── รายงานรายคณะ: คณะไหนมีใครติดบ้าง ────────────────────────────────────────
  // นับ "คน" กับ "รายการ" แยกกัน — คนเดียวติดคณะเดียวกันหลายสาขาได้ ถ้านับรวมเป็นคน
  // ยอดจะพองเกินจริง (คณะที่เปิดหลายสาขาจะดูเหมือนมีคนติดเยอะกว่าที่เป็น)
  const facultyGroups = useMemo(() => {
    const map = new Map();
    for (const s of students) {
      for (const a of filterByDate(s.admissions || [])) {
        if (facOnlyConfirmed && !a.confirmed) continue;
        const faculty = a.faculty_name || 'ไม่ระบุคณะ';
        const university = a.university_name || 'ไม่ระบุมหาวิทยาลัย';
        const campus = a.campus || '';
        const key = facGroupUni ? `${faculty} ${university} ${campus}` : faculty;
        let g = map.get(key);
        if (!g) {
          g = {
            key, faculty,
            university: facGroupUni ? university : '',
            campus: facGroupUni ? campus : '',
            rows: [], codes: new Set(), uniCount: new Map(), confirmed: 0,
          };
          map.set(key, g);
        }
        g.rows.push({
          student_code: s.student_code,
          name: `${s.title_prefix || ''}${s.first_name || ''} ${s.last_name || ''}`.trim(),
          class_level: s.class_level,
          class_room: s.class_room,
          number_in_room: s.number_in_room,
          university, campus,
          program: a.program_name || '',
          confirmed: !!a.confirmed,
        });
        g.codes.add(s.student_code);
        g.uniCount.set(university, (g.uniCount.get(university) || 0) + 1);
        if (a.confirmed) g.confirmed++;
      }
    }

    // มหาวิทยาลัยตัวแทนของกลุ่ม (ใช้ตอนเรียงตามชื่อมหาวิทยาลัย) — โหมดไม่แยกมหาวิทยาลัย
    // คณะหนึ่งมีได้หลายแห่ง จึงยึดแห่งที่มีคนติดมากที่สุดในคณะนั้น
    const mainUni = (g) =>
      [...g.uniCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'))[0]?.[0] || '';

    const byName = (a, b) => a.faculty.localeCompare(b.faculty, 'th');
    const byCount = (a, b) => b.codes.size - a.codes.size || byName(a, b);
    // คณะที่ผู้ใช้ยังไม่ได้จัดลำดับให้ ไปต่อท้ายแล้วเรียงตามจำนวนกันเอง
    const rank = (g) => {
      const i = facOrder.indexOf(g.faculty);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const SORTERS = {
      count:     byCount,
      confirmed: (a, b) => b.confirmed - a.confirmed || b.codes.size - a.codes.size || byName(a, b),
      name:      byName,
      uni:       (a, b) => mainUni(a).localeCompare(mainUni(b), 'th') || byName(a, b),
      custom:    (a, b) => rank(a) - rank(b) || byCount(a, b),
    };

    const groups = [...map.values()];
    groups.forEach(g => { g.mainUni = mainUni(g); });
    groups.sort(SORTERS[facSort] || SORTERS.count);
    return groups;
  }, [students, filterByDate, facGroupUni, facOnlyConfirmed, facSort, facOrder]);

  // ชื่อคณะเรียงตามที่แสดงอยู่จริง — ใช้เป็นรายการให้ลากจัดลำดับ (โหมดแยกมหาวิทยาลัยมีชื่อคณะซ้ำได้)
  const facultyNames = useMemo(
    () => [...new Set(facultyGroups.map(g => g.faculty))],
    [facultyGroups]
  );

  // คนคนเดียวติดหลายคณะได้ — ยอด "คน" ของทั้งรายงานจึงต้อง unique ข้ามกลุ่ม ไม่ใช่บวกยอดรายกลุ่ม
  const facultyStudentCount = new Set(facultyGroups.flatMap(g => [...g.codes])).size;
  const facultyRowCount = facultyGroups.reduce((n, g) => n + g.rows.length, 0);

  const exportFacultyExcel = () => {
    const wb = XLSX.utils.book_new();

    const summary = facultyGroups.map((g, i) => ({
      'ลำดับ': i + 1,
      'คณะ': g.faculty,
      ...(facGroupUni
        ? { 'มหาวิทยาลัย': g.university, 'วิทยาเขต': g.campus }
        : { 'มหาวิทยาลัยที่มีคนติดมากสุด': g.mainUni, 'จำนวนมหาวิทยาลัย': g.uniCount.size }),
      'จำนวนนักเรียน (คน)': g.codes.size,
      'จำนวนรายการ': g.rows.length,
      'ยืนยันสิทธิ์': g.confirmed,
    }));
    const wsSum = XLSX.utils.json_to_sheet(summary);
    wsSum['!cols'] = [{ wch: 7 }, { wch: 34 }, { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 13 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsSum, 'สรุปรายคณะ');

    // แถวรายชื่อซ้ำชื่อคณะทุกบรรทัด (ไม่ merge) เพื่อให้เอาไปกรอง/ทำ pivot ใน Excel ต่อได้
    const detail = facultyGroups.flatMap(g =>
      g.rows.map((r, i) => ({
        'คณะ': g.faculty,
        'ลำดับในคณะ': i + 1,
        'ชั้น': r.class_level,
        'ห้อง': r.class_room,
        'เลขที่': r.number_in_room,
        'รหัสนักเรียน': r.student_code,
        'ชื่อ-นามสกุล': r.name,
        'มหาวิทยาลัย': r.university,
        'วิทยาเขต': r.campus,
        'สาขา': r.program,
        'ยืนยันสิทธิ์': r.confirmed ? 'ยืนยัน' : '',
      }))
    );
    const wsDetail = XLSX.utils.json_to_sheet(detail);
    wsDetail['!cols'] = [
      { wch: 34 }, { wch: 11 }, { wch: 7 }, { wch: 6 }, { wch: 7 }, { wch: 12 },
      { wch: 24 }, { wch: 30 }, { wch: 14 }, { wch: 28 }, { wch: 11 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'รายชื่อรายคณะ');

    XLSX.writeFile(wb, `รายงานรายคณะ_${yearName}.xlsx`);
  };

  // ── รายงานรายคณะ → PDF (เปิดหน้าพิมพ์ใน tab ใหม่) ──────────────────────────
  // Set/Map ผ่าน JSON ไม่ได้ ต้องแปลงเป็นตัวเลขก่อนส่งให้หน้าพิมพ์
  const exportFacultyPdf = () => {
    const payload = {
      yearName,
      cols: pdfCols,
      groupUni: facGroupUni,
      onlyConfirmed: facOnlyConfirmed,
      dateRangeLabel,
      totals: {
        faculties: facultyGroups.length,
        students: facultyStudentCount,
        rows: facultyRowCount,
      },
      groups: facultyGroups.map(g => ({
        key: g.key,
        faculty: g.faculty,
        university: g.university,
        campus: g.campus,
        mainUni: g.mainUni,
        uniCount: g.uniCount.size,
        students: g.codes.size,
        confirmed: g.confirmed,
        rows: g.rows,
      })),
    };
    localStorage.setItem('gradtrack-faculty-print-data', JSON.stringify(payload));
    window.open(withBase('/admin/report-faculty/print'), '_blank');
  };

  const totalStudents = students.length;
  const allAdmissions = students.flatMap(s => filterByDate(s.admissions || []));
  const confirmedAdmissions = allAdmissions.filter(a => a.confirmed);
  const withAdmissions = students.filter(s => filterByDate(s.admissions || []).length > 0).length;
  const confirmed = students.filter(s => filterByDate(s.admissions || []).some(a => a.confirmed)).length;
  const isFiltered = !!(dateFrom || dateTo);

  const buildChartData = (admissions) => ({
    uni: Object.values(
      admissions.reduce((acc, a) => {
        const key = a.university_name || 'ไม่ระบุ';
        acc[key] = acc[key] || { name: key, value: 0 };
        acc[key].value++;
        return acc;
      }, {})
    ).sort((a, b) => b.value - a.value),
    fac: Object.values(
      admissions.reduce((acc, a) => {
        const key = a.faculty_name || 'ไม่ระบุ';
        acc[key] = acc[key] || { name: key, value: 0 };
        acc[key].value++;
        return acc;
      }, {})
    ).sort((a, b) => b.value - a.value),
    prog: Object.values(
      admissions.reduce((acc, a) => {
        const key = a.group_field || 'ไม่ระบุ';
        acc[key] = acc[key] || { name: key, value: 0 };
        acc[key].value++;
        return acc;
      }, {})
    ).sort((a, b) => b.value - a.value),
  });

  const allChartData = buildChartData(allAdmissions);
  const confirmedChartData = buildChartData(confirmedAdmissions);

  const activeData = chartMode === 'confirmed' ? confirmedChartData : allChartData;
  const activeTotal = chartMode === 'confirmed' ? confirmedAdmissions.length : allAdmissions.length;

  const dateRangeLabel = isFiltered
    ? `เฉพาะที่บันทึก${dateFrom ? ` ตั้งแต่ ${thaiDate(dateFrom)}` : ''}${dateTo ? ` ถึง ${thaiDate(dateTo)}` : ''}`
    : '';
  const modeLabel = chartMode === 'confirmed' ? 'เฉพาะยืนยันสิทธิ์' : 'ทั้งหมดที่บันทึก';

  // กราฟที่ติ๊กไว้ = สิ่งที่จะถูกบันทึก (ทั้งรูปและ Excel) และเป็นชื่อท้ายไฟล์ด้วย
  const pickedCharts = CHART_DEFS.filter(c => chartPick[c.key]);
  const pickLabel = pickedCharts.length === CHART_DEFS.length
    ? 'ทุกกราฟ'
    : pickedCharts.map(c => c.short).join('-');

  // ── Export กราฟเป็นรูป ──────────────────────────────────────────────────────
  // เก็บภาพจาก "ชั้นในของกล่องที่เลื่อน" ไม่ใช่ตัวกล่องเอง — ถ้าเก็บจากกล่องที่มี
  // overflow-y-auto จะได้แค่ส่วนที่มองเห็นอยู่ กราฟที่เลื่อนลงไปหายหมด
  // ปุ่ม/ตัวสลับโหมดติด data-noexport ไว้ให้ตัดออกจากภาพ แล้วโชว์หัวเรื่องแทนเฉพาะตอนเก็บภาพ
  const exportChartPng = async () => {
    const node = chartAreaRef.current;
    if (!node || chartExporting || pickedCharts.length === 0) return;
    setChartExporting(true);
    const title = chartTitleRef.current;
    if (title) title.style.display = 'block';
    // ซ่อนกราฟที่ไม่ได้เลือก — เก็บทั้งสามอันทีเดียวได้ภาพยาวจนเอาไปใช้ต่อลำบาก
    const hidden = [...node.querySelectorAll('[data-chartkey]')]
      .filter(el => !chartPick[el.dataset.chartkey]);
    for (const el of hidden) el.style.display = 'none';
    // กราฟมหาวิทยาลัย/คณะวางคู่กันสองคอลัมน์ ถ้าเลือกไว้อันเดียวต้องยุบเหลือคอลัมน์เดียว
    // ไม่งั้นภาพมีที่ว่างเปล่าอีกครึ่ง
    const pairGrid = pairGridRef.current;
    const pairCount = ['uni', 'fac'].filter(k => chartPick[k]).length;
    const collapsePair = pairGrid && pairCount === 1;
    if (collapsePair) pairGrid.style.gridTemplateColumns = 'minmax(0, 1fr)';
    // เลือกเฉพาะกราฟสาขา: เส้นคั่นกับระยะห่างด้านบนไม่มีอะไรให้คั่นแล้ว เอาออกจากภาพ
    const prog = pairCount === 0 && chartPick.prog ? node.querySelector('[data-chartkey="prog"]') : null;
    if (prog) { prog.style.borderTop = 'none'; prog.style.marginTop = '0'; prog.style.paddingTop = '0'; }
    // คลายกล่องที่เลื่อนดู (ตารางสรุปสาขา) ให้สูงเต็มก่อน ไม่งั้นภาพได้แค่ส่วนที่เห็นอยู่
    const panels = [...node.querySelectorAll('[data-scrollpanel]')];
    for (const p of panels) { p.style.maxHeight = 'none'; p.style.overflow = 'visible'; }
    // recharts วัดขนาดตัวเองผ่าน ResizeObserver ซึ่งไม่ทันทีทันใด — เปลี่ยนเลย์เอาต์แล้ว
    // ต้องรอให้วาดใหม่เสร็จก่อน ไม่งั้นได้ภาพวงกลมที่ยังอยู่ตำแหน่งเดิม
    if (collapsePair) await new Promise(r => setTimeout(r, 400));
    try {
      const bg = getComputedStyle(node).backgroundColor;
      const canvas = await domToCanvas(node, {
        scale: 2, // ชัดพอเอาไปวางในเอกสาร/สไลด์โดยไม่แตก
        backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff',
        filter: (el) => !(el.nodeType === 1 && el.hasAttribute('data-noexport')),
        fetch: { requestInit: { mode: 'cors' } },
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('แปลงภาพไม่สำเร็จ');
      saveAs(blob, `กราฟผลการสอบ_${yearName}_${modeLabel}_${pickLabel}.png`);
    } catch (err) {
      console.error('บันทึกกราฟเป็นรูปไม่สำเร็จ', err);
      alert('บันทึกกราฟเป็นรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      if (title) title.style.display = 'none';
      for (const el of hidden) el.style.display = '';
      if (collapsePair) pairGrid.style.gridTemplateColumns = '';
      if (prog) { prog.style.borderTop = ''; prog.style.marginTop = ''; prog.style.paddingTop = ''; }
      for (const p of panels) { p.style.maxHeight = ''; p.style.overflow = ''; }
      setChartExporting(false);
    }
  };

  // ── Export ตัวเลขในกราฟเป็น Excel ──────────────────────────────────────────
  const exportChartExcel = () => {
    if (pickedCharts.length === 0) return;
    const wb = XLSX.utils.book_new();
    for (const c of pickedCharts) {
      const rows = activeData[c.key].map((d, i) => ({
        'ลำดับ': i + 1,
        [c.head]: d.name,
        'จำนวน (รายการ)': d.value,
        'สัดส่วน (%)': activeTotal > 0 ? Number(((d.value / activeTotal) * 100).toFixed(1)) : 0,
      }));
      rows.push({ 'ลำดับ': '', [c.head]: 'รวม', 'จำนวน (รายการ)': activeTotal, 'สัดส่วน (%)': activeTotal > 0 ? 100 : 0 });
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 7 }, { wch: 40 }, { wch: 15 }, { wch: 13 }];
      XLSX.utils.book_append_sheet(wb, ws, c.sheet);
    }
    XLSX.writeFile(wb, `กราฟผลการสอบ_${yearName}_${modeLabel}_${pickLabel}.xlsx`);
  };

  return (
    <>
      {/* Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 11px; }
          table { font-size: 10px; }
          /* กล่องตารางถูกจำกัดความสูงไว้ให้เลื่อนดูบนจอ — ตอนพิมพ์ต้องคลายออก
             ไม่งั้นได้เฉพาะส่วนที่มองเห็นหน้าเดียว */
          .table-scroll { max-height: none !important; overflow: visible !important; }
          tr { break-inside: avoid; }
        }
      `}</style>

      <div className="flex min-w-0 flex-col overflow-hidden">
        <div className="no-print">
          <PageHeader
            icon="table"
            title="รายงานผลการสอบ (ตาราง)"
            subtitle="สรุปผลทั้งชั้นปี พร้อมส่งออกเป็น Excel / PDF และดูกราฟภาพรวม"
          >
            <label htmlFor="report-year" className="whitespace-nowrap text-xs text-base-content/55">
              ปีการศึกษา
            </label>
            <select
              id="report-year"
              className="select select-sm"
              value={yearId}
              onChange={e => {
                const y = years.find(y => String(y.id) === e.target.value);
                setYearId(e.target.value);
                setYearName(y ? String(y.year_be || y.title || y.name || '') : '');
              }}
            >
              {years.map(y => (
                <option key={y.id} value={y.id}>
                  {y.year_be || y.title || y.name}
                </option>
              ))}
            </select>
          </PageHeader>
        </div>

        {/* สรุป + ตัวกรอง + ปุ่ม */}
        {/* ไม่ใส่ overflow-hidden: เมนู "คอลัมน์ PDF" ที่ลอยออกนอกการ์ดจะโดนตัดหาย
            (การ์ดมีพื้นหลังของตัวเองที่โค้งมุมอยู่แล้ว ลูก ๆ ไม่มีพื้นหลังให้ต้องตัด) */}
        <div className="card no-print anim-fade-up bg-base-100">
          {/* ตัวเลขสรุป */}
          <dl className="grid grid-cols-2 divide-base-300 border-b border-base-300 sm:grid-cols-4 sm:divide-x">
            {[
              { label: 'นักเรียนทั้งหมด', value: totalStudents, cls: 'text-base-content' },
              {
                label: isFiltered ? 'บันทึกในช่วงนี้' : 'บันทึกมหาลัยแล้ว',
                value: withAdmissions,
                cls: 'text-primary',
              },
              { label: 'ยืนยันสิทธิ์แล้ว', value: confirmed, cls: 'text-success' },
              { label: 'ยังไม่บันทึก', value: totalStudents - withAdmissions, cls: 'text-error' },
            ].map((s) => (
              <div key={s.label} className="px-4 py-3 text-center max-sm:border-b max-sm:border-base-300">
                <dd className={`text-xl font-semibold tabular-nums ${s.cls}`}>{s.value}</dd>
                <dt className="mt-0.5 text-xs text-base-content/55">{s.label}</dt>
              </div>
            ))}
          </dl>

          {/* ตัวกรอง + ปุ่มส่งออก */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-base-content/55">
                <Icon name="calendar" size={14} />
                ตั้งแต่
              </span>
              <ThaiDatePicker value={dateFrom} onChange={setDateFrom} />
              <span className="text-xs text-base-content/45">ถึง</span>
              <ThaiDatePicker value={dateTo} onChange={setDateTo} />
              {isFiltered && (
                <button
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                >
                  <Icon name="x" size={12} />
                  ล้าง
                </button>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={includeNoData}
                onChange={e => setIncludeNoData(e.target.checked)}
              />
              <span className="text-sm">รวมนักเรียนที่ไม่มีข้อมูล</span>
            </label>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                className="btn btn-outline btn-sm gap-1.5"
                onClick={exportExcel}
                disabled={loading || students.length === 0}
              >
                <Icon name="sheet" size={15} />
                Excel
              </button>
              <PdfColumnMenu cols={pdfCols} onToggle={togglePdfCol} />
              <button
                className="btn btn-outline btn-sm gap-1.5"
                onClick={exportPdf}
                disabled={loading || students.length === 0}
              >
                <Icon name="print" size={15} />
                PDF
              </button>
              <button
                className="btn btn-primary btn-sm gap-1.5"
                onClick={() => setShowChart(true)}
                disabled={loading || allAdmissions.length === 0}
              >
                <Icon name="chart" size={15} />
                ดูกราฟ
              </button>
            </div>
          </div>
        </div>

        {/* Chart Modal */}
        {showChart && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#1a102a]/55 p-4 backdrop-blur-[2px]"
            onClick={() => setShowChart(false)}
            role="dialog"
            aria-modal="true"
            aria-label="กราฟวิเคราะห์ผลการสอบ"
          >
            <div
              className="anim-scale-in max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
             {/* ชั้นในของกล่องที่เลื่อน = สิ่งที่ถูกเก็บเป็นรูปตอน export (ดู exportChartPng) */}
             <div ref={chartAreaRef} className="bg-base-100 p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3" data-noexport>
                <div className="flex items-center gap-2.5">
                  <span className="gt-chip size-9">
                    <Icon name="chart" size={18} />
                  </span>
                  <h2 className="text-base font-semibold sm:text-lg">
                    กราฟวิเคราะห์ผลการสอบ ปีการศึกษา {yearName}
                  </h2>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-outline btn-sm gap-1.5"
                    onClick={exportChartPng}
                    disabled={chartExporting || pickedCharts.length === 0}
                    title="บันทึกกราฟที่เลือกไว้เป็นไฟล์รูป .png"
                  >
                    {chartExporting ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <Icon name="image" size={15} />
                    )}
                    บันทึกรูป
                  </button>
                  <button
                    className="btn btn-outline btn-sm gap-1.5"
                    onClick={exportChartExcel}
                    disabled={pickedCharts.length === 0}
                    title="ส่งออกตัวเลขของกราฟที่เลือกไว้เป็น Excel"
                  >
                    <Icon name="sheet" size={15} />
                    Excel
                  </button>
                  <button
                    className="btn btn-ghost btn-sm px-2"
                    onClick={() => setShowChart(false)}
                    aria-label="ปิดกราฟ"
                  >
                    <Icon name="x" size={18} />
                  </button>
                </div>
              </div>

              {/* หัวเรื่องของภาพที่ export — ซ่อนบนหน้าจอ เพราะแถบด้านบนบอกอยู่แล้ว
                  แต่ในไฟล์รูปต้องมี ไม่งั้นดูทีหลังไม่รู้ว่าเป็นปีไหน ชุดข้อมูลไหน */}
              <div
                ref={chartTitleRef}
                style={{ display: 'none' }}
                className="mb-6 border-b border-base-300 pb-4 text-center"
              >
                <p className="text-lg font-semibold">
                  กราฟวิเคราะห์ผลการสอบ ปีการศึกษา {yearName}
                </p>
                <p className="mt-1 text-xs text-base-content/60">
                  {modeLabel} · {activeTotal} รายการ{dateRangeLabel ? ` · ${dateRangeLabel}` : ''}
                </p>
              </div>

              {/* สลับชุดข้อมูล */}
              <div className="mb-3 flex flex-wrap gap-2" data-noexport>
                <button
                  className={`btn btn-sm gap-1.5 ${chartMode === 'all' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setChartMode('all')}
                  aria-pressed={chartMode === 'all'}
                >
                  รวมทั้งหมดที่บันทึก
                  <span className="font-semibold tabular-nums">{allAdmissions.length}</span>
                </button>
                <button
                  className={`btn btn-sm gap-1.5 ${chartMode === 'confirmed' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setChartMode('confirmed')}
                  aria-pressed={chartMode === 'confirmed'}
                >
                  เฉพาะยืนยันสิทธิ์แล้ว
                  <span className="font-semibold tabular-nums">{confirmedAdmissions.length}</span>
                </button>
              </div>

              {/* เลือกกราฟที่จะบันทึก — เก็บทีเดียวทั้งสามอันได้ภาพยาวเกินกว่าจะเอาไปใช้ต่อ */}
              <div
                className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-base-300 bg-base-200/40 px-3 py-2"
                data-noexport
              >
                <span className="whitespace-nowrap text-xs text-base-content/60">
                  เลือกกราฟที่จะบันทึก
                </span>
                {CHART_DEFS.map(c => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm checkbox-primary"
                      checked={!!chartPick[c.key]}
                      onChange={e => setChartPick(p => ({ ...p, [c.key]: e.target.checked }))}
                    />
                    <span className="text-sm">{c.short}</span>
                  </label>
                ))}
                {pickedCharts.length === 0 && (
                  <span className="text-xs text-error">เลือกอย่างน้อย 1 กราฟ</span>
                )}
              </div>

              <div ref={pairGridRef} className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {CHART_DEFS.filter(c => c.key !== 'prog').map(({ key, title }) => {
                  const data = activeData[key];
                  return (
                  <section key={key} data-chartkey={key} className="flex flex-col gap-2">
                    <h3 className="text-center text-sm font-semibold">{title}</h3>
                    {data.length === 0 ? (
                      <p className="py-10 text-center text-sm text-base-content/45">ไม่มีข้อมูล</p>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={data}
                              cx="50%" cy="50%"
                              outerRadius={110}
                              dataKey="value"
                              label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                              labelLine={false}
                            >
                              {data.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(v, n) => [
                                `${v} รายการ (${((v / activeTotal) * 100).toFixed(1)}%)`,
                                n,
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <ChartLegend data={data} total={activeTotal} colors={PIE_COLORS} />
                      </>
                    )}
                  </section>
                  );
                })}
              </div>

              {/* สาขา — เต็มความกว้าง */}
              <section data-chartkey="prog" className="mt-8 flex flex-col gap-2 border-t border-base-300 pt-6">
                <h3 className="text-center text-sm font-semibold">สาขา/กลุ่มวิชาที่สอบติด</h3>
                {activeData.prog.length === 0 ? (
                  <p className="py-10 text-center text-sm text-base-content/45">ไม่มีข้อมูล</p>
                ) : (
                  <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
                    <ResponsiveContainer width="100%" height={350}>
                      <PieChart>
                        <Pie
                          data={activeData.prog}
                          cx="50%" cy="50%"
                          outerRadius={130}
                          dataKey="value"
                          label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {activeData.prog.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v, n) => [
                            `${v} รายการ (${((v / activeTotal) * 100).toFixed(1)}%)`,
                            n,
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <ChartLegend data={activeData.prog} total={activeTotal} colors={PIE_COLORS} scroll />
                  </div>
                )}
              </section>
             </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="card mt-4 bg-base-100 p-5">
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="gt-skeleton h-4" style={{ width: `${92 - i * 7}%` }} />
              ))}
            </div>
          </div>
        )}

        {/* ── รายงานรายคณะ: คณะไหนมีใครติดบ้าง ยืนยันที่ไหน ── */}
        {!loading && (
          <section className="mt-6">
            <div className="no-print mb-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2.5">
                <span className="gt-chip size-8">
                  <Icon name="faculty" size={16} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold sm:text-base">รายงานรายคณะ</h2>
                  <p className="mt-0.5 text-xs text-base-content/55">
                    {facultyGroups.length} คณะ · {facultyStudentCount} คน · {facultyRowCount} รายการ
                  </p>
                </div>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label htmlFor="fac-sort" className="whitespace-nowrap text-xs text-base-content/55">
                  เรียงตาม
                </label>
                <select
                  id="fac-sort"
                  className="select select-sm"
                  value={facSort}
                  onChange={e => setFacSort(e.target.value)}
                >
                  {FACULTY_SORTS.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>

                <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary"
                    checked={facGroupUni}
                    onChange={e => setFacGroupUni(e.target.checked)}
                  />
                  <span className="text-sm">แยกตามมหาวิทยาลัย</span>
                </label>

                <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-success"
                    checked={facOnlyConfirmed}
                    onChange={e => setFacOnlyConfirmed(e.target.checked)}
                  />
                  <span className="text-sm">เฉพาะที่ยืนยันสิทธิ์</span>
                </label>

                <button
                  className="btn btn-outline btn-sm gap-1.5"
                  onClick={exportFacultyExcel}
                  disabled={facultyGroups.length === 0}
                >
                  <Icon name="sheet" size={15} />
                  Excel
                </button>

                <PdfColumnMenu cols={pdfCols} onToggle={togglePdfCol} />

                <button
                  className="btn btn-outline btn-sm gap-1.5"
                  onClick={exportFacultyPdf}
                  disabled={facultyGroups.length === 0}
                >
                  <Icon name="print" size={15} />
                  PDF
                </button>
              </div>
            </div>

            {facSort === 'custom' && (
              <FacultyOrderPanel
                names={facultyNames}
                onReorder={applyFacOrder}
                onReset={() => { setFacOrder([]); saveJSON(LS_FAC_ORDER, []); }}
              />
            )}

            <TableWrap sticky className="anim-fade-up">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>ชั้น/ห้อง</th>
                    <th>เลขที่</th>
                    <th>รหัส</th>
                    <th>ชื่อ-นามสกุล</th>
                    <th>มหาวิทยาลัย</th>
                    <th>สาขา</th>
                    <th>ยืนยันสิทธิ์</th>
                  </tr>
                </thead>
                <tbody>
                  {facultyGroups.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <EmptyState
                          icon="faculty"
                          title={
                            facOnlyConfirmed
                              ? 'ยังไม่มีใครยืนยันสิทธิ์ตามเงื่อนไขนี้'
                              : 'ยังไม่มีข้อมูลการสอบติดในช่วงนี้'
                          }
                          hint={
                            isFiltered || facOnlyConfirmed
                              ? 'ลองล้างช่วงวันที่ หรือเอาตัวกรอง “เฉพาะที่ยืนยันสิทธิ์” ออก'
                              : 'บันทึกผลสอบของนักเรียนได้ที่หน้า สถานะการบันทึกผลสอบ'
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    facultyGroups.map(g => (
                      <Fragment key={g.key}>
                        <tr>
                          <th colSpan={8} className="bg-base-200/70">
                            <div className="flex flex-wrap items-center gap-2">
                              <Icon name="faculty" size={15} className="text-primary" />
                              <span className="text-sm font-semibold text-base-content">
                                {g.faculty}
                              </span>
                              {facGroupUni && (
                                <span className="text-xs font-normal text-base-content/60">
                                  · {g.university}{g.campus ? ` (${g.campus})` : ''}
                                </span>
                              )}
                              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                                <Tag tone="primary">{g.codes.size} คน</Tag>
                                {g.rows.length !== g.codes.size && (
                                  <Tag tone="muted">{g.rows.length} รายการ</Tag>
                                )}
                                {!facGroupUni && g.uniCount.size > 1 && (
                                  <Tag tone="navy" icon="university">{g.uniCount.size} แห่ง</Tag>
                                )}
                                <Tag
                                  tone={g.confirmed > 0 ? 'success' : 'muted'}
                                  icon={g.confirmed > 0 ? 'checkCircle' : undefined}
                                >
                                  ยืนยัน {g.confirmed}
                                </Tag>
                              </span>
                            </div>
                          </th>
                        </tr>
                        {g.rows.map((r, i) => (
                          <tr
                            key={`${g.key}|${r.student_code}|${i}`}
                            className={r.confirmed ? 'bg-success/5' : ''}
                          >
                            <td className="text-xs tabular-nums text-base-content/40">{i + 1}</td>
                            <td className="whitespace-nowrap tabular-nums">
                              {r.class_level}/{r.class_room}
                            </td>
                            <td className="tabular-nums">{r.number_in_room}</td>
                            <td className="font-mono text-xs tabular-nums">{r.student_code}</td>
                            <td className="whitespace-nowrap">{r.name}</td>
                            <td className="text-xs">
                              {r.university}
                              {r.campus && (
                                <span className="block text-base-content/50">วิทยาเขต {r.campus}</span>
                              )}
                            </td>
                            <td className="text-xs text-base-content/70">{r.program || '—'}</td>
                            <td>
                              {r.confirmed ? (
                                <Tag tone="success" icon="checkCircle">ยืนยันแล้ว</Tag>
                              ) : (
                                <span className="text-xs text-base-content/35">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </TableWrap>
          </section>
        )}
      </div>
    </>
  );
}
