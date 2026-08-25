import { useEffect, useMemo, useState } from 'react';
import { StudentCard, mergeStudentSettings, normCode, noteAspect } from './ReportPage';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { fontStack, loadCardFonts, fontsInUse } from '../../utils/cardFonts';

// โหลดรูปทั้งหมดล่วงหน้าแบบจำกัดจำนวนที่โหลดพร้อมกัน (กัน server ค้างจากการยิงพร้อมกันทีเดียว)
// รูปจะถูก cache ไว้ พอ <img> จริง render จะดึงจาก cache ทันที → print ออกมาตรงกับตัวอย่าง
async function preloadAll(urls, concurrency, onProgress) {
  const unique = [...new Set(urls.filter(Boolean))];
  const total = unique.length;
  let done = 0;
  let idx = 0;

  const loadOne = (url) =>
    new Promise((resolve) => {
      const img = new window.Image();
      // จดสัดส่วนไว้ตั้งแต่ตรงนี้ — กล่องโลโก้คิดขนาดจากค่านี้ และหน้านี้สั่ง print เองอัตโนมัติ
      // ถ้าปล่อยให้การ์ดไปโหลดเองทีหลังจะพิมพ์ทันด้วยขนาด fallback (กล่องจัตุรัส)
      img.onload = () => { noteAspect(url, img); resolve(); };
      img.onerror = resolve; // รูปเสีย/หายก็ข้ามไป ไม่ให้ค้าง
      img.src = url;
    });

  async function worker() {
    while (idx < unique.length) {
      const url = unique[idx++];
      await loadOne(url);
      done++;
      onProgress?.(done, total);
    }
  }

  onProgress?.(0, total);
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, worker)
  );
}

// หน้านี้เปิดใน tab ใหม่เพื่อ print เป็น PDF
// รับข้อมูลจาก localStorage ที่ ReportPage เก็บไว้
export default function PrintReportPage() {
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready'
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('gradtrack-print-data');
      if (raw) {
        setData(JSON.parse(raw));
      } else {
        setPhase('nodata');
      }
    } catch (e) {
      console.error('Failed to load print data', e);
      setPhase('nodata');
    }
  }, []);

  const approvedSet = useMemo(
    () => new Set(data?.approvedCodes || []),
    [data]
  );

  // รวบรวม URL รูปทั้งหมดที่จะใช้ในหน้านี้
  const allImageUrls = useMemo(() => {
    if (!data) return [];
    const { students = [], settings = {} } = data;
    const urls = [
      resolveMediaUrl(settings.background_image_url),
      resolveMediaUrl(settings.school_logo_url),
    ];
    for (const s of students) {
      urls.push(resolveMediaUrl(s.photo_url));
      for (const a of s.admissions || []) {
        urls.push(resolveMediaUrl(a.logo_url));
      }
    }
    return urls;
  }, [data]);

  // โหลดรูป + ฟอนต์ให้ครบก่อน แล้วค่อยพร้อม print (แทนการรอเวลาตายตัว)
  useEffect(() => {
    if (!data) return;
    let cancelled = false;

    (async () => {
      await preloadAll(allImageUrls, 6, (done, total) => {
        if (!cancelled) setProgress({ done, total });
      });
      // ต้องสั่งโหลดฟอนต์ที่การ์ดใช้จริงก่อน — document.fonts.ready เฉย ๆ จะ resolve ทันที
      // ถ้ายังไม่มีข้อความไหนบนจอใช้ฟอนต์นั้น แล้ว print ออกมาได้ฟอนต์ระบบ (ดู utils/cardFonts.js)
      try { await loadCardFonts(fontsInUse(data.settings, data.overrides)); } catch { /* ไม่รองรับก็ข้าม */ }
      if (!cancelled) setPhase('ready');
    })();

    return () => { cancelled = true; };
  }, [data, allImageUrls]);

  // เมื่อทุกอย่างพร้อม + วาดเสร็จแล้ว ค่อยเปิดกล่อง print อัตโนมัติ
  useEffect(() => {
    if (phase !== 'ready') return;
    let raf1, raf2, timer;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        timer = setTimeout(() => window.print(), 300);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [phase]);

  if (phase === 'nodata' || (!data && phase !== 'loading')) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Prompt, sans-serif' }}>
        <p>ไม่พบข้อมูล กรุณาเปิดจากหน้า Export PDF อีกครั้ง</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Prompt, sans-serif' }}>
        <p>กำลังโหลด...</p>
      </div>
    );
  }

  const { students, settings, overrides = {}, yearName } = data;
  const SCALE = 0.714; // 1080 * 0.714 ≈ 771px ≈ A4 width at 96dpi
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      {/* Print CSS */}
      <style>{`
        /* ฟอนต์ของการ์ดถูกแปะเป็น <link crossorigin> โดย loadCardFonts ไปแล้ว
           ที่นี่กำหนดแค่ฟอนต์ของตัวหน้า (แถบแจ้งเตือน) ซึ่งไม่ได้ติดไปกับ PDF */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: white; font-family: ${fontStack(settings.font_family)}; }

        .print-notice {
          text-align: center;
          padding: 20px;
          background: #f5f5f5;
          font-family: 'Prompt', sans-serif;
          color: #555;
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .print-notice button {
          margin-top: 10px;
          padding: 9px 22px;
          font-size: 14px;
          font-weight: 500;
          font-family: 'Prompt', sans-serif;
          border: none;
          border-radius: 10px;
          background: #5b2d8e;
          color: white;
          cursor: pointer;
          transition: background-color 0.18s ease;
        }
        .print-notice button:hover { background: #4a2474; }
        .print-notice button:focus-visible { outline: 2px solid #5b2d8e; outline-offset: 2px; }
        .print-notice button:disabled { opacity: 0.5; cursor: default; }

        .print-progress-bar {
          width: 320px;
          height: 8px;
          border-radius: 999px;
          background: #e6e0f0;
          margin: 12px auto 0;
          overflow: hidden;
        }
        .print-progress-bar > div {
          height: 100%;
          background: #5b2d8e;
          transition: width 0.2s ease;
        }

        .print-page-wrapper {
          width: ${Math.round(1080 * SCALE)}px;
          height: ${Math.round(1080 * SCALE)}px;
          overflow: hidden;
          margin: 0 auto 8px;
          page-break-after: always;
          break-after: page;
        }

        .print-scale-container {
          transform: scale(${SCALE});
          transform-origin: top left;
          width: 1080px;
          height: 1080px;
        }

        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .print-notice { display: none !important; }

          @page {
            size: ${Math.round(1080 * SCALE)}px ${Math.round(1080 * SCALE)}px;
            margin: 0;
          }

          .print-page-wrapper {
            margin: 0;
            page-break-after: always;
            break-after: page;
          }
        }
      `}</style>

      <div className="print-notice" role="status" aria-live="polite">
        {phase === 'loading' ? (
          <>
            <p>กำลังเตรียมรูปภาพ... {pct}% ({progress.done}/{progress.total})</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              รอจนโหลดรูปครบก่อน แล้วกล่อง print จะเปิดให้อัตโนมัติ เพื่อให้ PDF ตรงกับตัวอย่าง
            </p>
            <div className="print-progress-bar"><div style={{ width: `${pct}%` }} /></div>
          </>
        ) : (
          <>
            <p>หน้านี้พร้อม print เป็น PDF แล้ว ({students.length} คน)</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              ตั้ง Destination เป็น "Save as PDF" · ปิด margin และเลือก "No headers and footers"
            </p>
            <button onClick={() => window.print()}>เปิดกล่อง Print / Save PDF</button>
          </>
        )}
      </div>

      {students.map((student) => (
        <div key={student.student_code} className="print-page-wrapper">
          <div className="print-scale-container">
            <StudentCard
              student={student}
              settings={mergeStudentSettings(settings, overrides[normCode(student.student_code)])}
              yearName={yearName}
              quoteApproved={approvedSet.has(student.student_code)}
            />
          </div>
        </div>
      ))}
    </>
  );
}
