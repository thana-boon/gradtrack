import { useEffect, useState } from 'react';

export default function PrintAdmissionTablePage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('gradtrack-table-print-data');
      if (raw) setData(JSON.parse(raw));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => window.print(), 800);
    return () => clearTimeout(timer);
  }, [data]);

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Prompt, sans-serif' }}>
        <p>ไม่พบข้อมูล กรุณาเปิดจากหน้ารายงานตารางอีกครั้ง</p>
      </div>
    );
  }

  // cols: คอลัมน์ประจำตัวนักเรียนที่ผู้ใช้ติ๊กเลือกไว้ — ไฟล์เก่าที่ค้างใน localStorage
  // ไม่มีคีย์นี้ ให้ถือว่าเอาทุกคอลัมน์เหมือนเดิม
  const { flatRows, yearName, cols } = data;
  const show = { class: true, room: true, seat: true, code: true, ...(cols || {}) };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@400;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Prompt', 'Noto Sans Thai', sans-serif; font-size: 10px; background: white; color: #111; }
        .print-notice { text-align: center; padding: 16px; background: #faf9fc; color: #4a4358; border-bottom: 1px solid #e6e0f0; }
        h2 { font-size: 14px; font-weight: 700; text-align: center; margin-bottom: 12px; padding-top: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th { background: #f1edf7; color: #3d2a55; font-weight: 600; padding: 5px 6px; border: 1px solid #cdc2de; text-align: left; }
        td { padding: 4px 6px; border: 1px solid #e6e0f0; vertical-align: top; }
        tr:nth-child(even) td { background: #faf9fc; }
        .border-top td { border-top: 2px solid #b7a8cd; }
        .confirmed { color: #16a34a; font-weight: 600; }
        .dim { color: #aaa; }
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .print-notice { display: none !important; }
          @page { margin: 10mm; size: A4 portrait; }
        }
      `}</style>

      <div className="print-notice">
        <p>กด <strong>Ctrl+P</strong> เพื่อพิมพ์ · เลือก "Save as PDF" · ปิด "Headers and footers" ใน More settings</p>
      </div>

      <h2>รายงานผลการสอบเข้ามหาวิทยาลัย ปีการศึกษา {yearName}</h2>

      <table>
        <thead>
          <tr>
            <th style={{ width: 28, textAlign: 'center' }}>ลำดับ</th>
            {show.class && <th style={{ width: 40, textAlign: 'center' }}>ชั้น</th>}
            {show.room && <th style={{ width: 30, textAlign: 'center' }}>ห้อง</th>}
            {show.seat && <th style={{ width: 36, textAlign: 'center', whiteSpace: 'nowrap' }}>เลขที่</th>}
            {show.code && <th style={{ width: 52, textAlign: 'center' }}>รหัส</th>}
            <th style={{ minWidth: 100, textAlign: 'center' }}>ชื่อ-นามสกุล</th>
            <th style={{ minWidth: 160, textAlign: 'center' }}>มหาวิทยาลัย</th>
            <th style={{ minWidth: 140, textAlign: 'center' }}>คณะ</th>
            <th style={{ minWidth: 120, textAlign: 'center' }}>สาขา</th>
            <th style={{ width: 52, textAlign: 'center' }}>ยืนยัน</th>
          </tr>
        </thead>
        <tbody>
          {flatRows.map((r, i) => (
            <tr key={i} className={r.isFirst && i > 0 ? 'border-top' : ''}>
              {r.isFirst && (
                <>
                  <td rowSpan={r.rowSpan} style={{ textAlign: 'center', color: '#999' }}>{r.seq}</td>
                  {show.class && <td rowSpan={r.rowSpan}>{r.class_level}</td>}
                  {show.room && <td rowSpan={r.rowSpan} style={{ textAlign: 'center' }}>{r.class_room}</td>}
                  {show.seat && <td rowSpan={r.rowSpan} style={{ textAlign: 'center' }}>{r.number_in_room}</td>}
                  {show.code && <td rowSpan={r.rowSpan} style={{ fontFamily: 'monospace' }}>{r.student_code}</td>}
                  <td rowSpan={r.rowSpan} style={{ fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'left' }}>{r.title_prefix}{r.first_name} {r.last_name}</td>
                </>
              )}
              <td style={{ textAlign: 'left' }}>{r.university_name || <span className="dim">-</span>}</td>
              <td style={{ textAlign: 'left' }}>{r.faculty_name || <span className="dim">-</span>}</td>
              <td style={{ textAlign: 'left' }}>{r.program_name || <span className="dim">-</span>}</td>
              <td style={{ textAlign: 'center' }}>
                {r.confirmed ? <span className="confirmed">✓</span> : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
