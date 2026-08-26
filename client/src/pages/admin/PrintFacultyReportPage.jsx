import { useEffect, useState } from 'react';

// หน้าพิมพ์ของ "รายงานแยกกลุ่ม" (จัดกลุ่มด้วยคณะ หรือด้วยสาขา/กลุ่มวิชา)
// เปิดใน tab ใหม่แล้วให้ผู้ใช้สั่ง Save as PDF
// ข้อมูลมาจาก localStorage ที่ AdmissionTableReportPage เก็บไว้ (Set/Map ถูกแปลงเป็นตัวเลขมาแล้ว)
export default function PrintFacultyReportPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('gradtrack-faculty-print-data');
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
        <p>ไม่พบข้อมูล กรุณาเปิดจากหน้ารายงานอีกครั้ง</p>
      </div>
    );
  }

  const { groups = [], yearName, cols, dim, groupUni, onlyConfirmed, dateRangeLabel, totals } = data;
  // ไฟล์ที่ค้างใน localStorage จากเวอร์ชันก่อนไม่มีคีย์ cols — ถือว่าเอาทุกคอลัมน์
  const show = { class: true, room: true, seat: true, code: true, ...(cols || {}) };
  // ข้อมูลเวอร์ชันก่อนไม่มี dim (จัดกลุ่มด้วยคณะอย่างเดียว) และเก็บชื่อกลุ่มไว้ในคีย์ faculty
  const dimLabel = dim?.label || 'คณะ';
  const byField = dim?.key === 'field';
  const titleOf = (g) => g.title ?? g.faculty;

  const idCols = [
    show.class && { key: 'class', label: 'ชั้น', width: 34 },
    show.room && { key: 'room', label: 'ห้อง', width: 30 },
    show.seat && { key: 'seat', label: 'เลขที่', width: 36 },
    show.code && { key: 'code', label: 'รหัส', width: 54 },
  ].filter(Boolean);

  const cellOf = (r, key) => {
    if (key === 'class') return r.class_level;
    if (key === 'room') return r.class_room;
    if (key === 'seat') return r.number_in_room;
    return r.student_code;
  };

  const conditions = [
    onlyConfirmed ? 'เฉพาะรายการที่ยืนยันสิทธิ์แล้ว' : '',
    groupUni ? `แยก${dimLabel}ตามมหาวิทยาลัย` : '',
    dateRangeLabel,
  ].filter(Boolean);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@400;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Prompt', 'Noto Sans Thai', sans-serif; font-size: 10px; background: white; color: #111; }
        .print-notice { text-align: center; padding: 16px; background: #faf9fc; color: #4a4358; border-bottom: 1px solid #e6e0f0; }
        h2 { font-size: 14px; font-weight: 700; text-align: center; margin-bottom: 4px; padding-top: 12px; }
        .meta { text-align: center; font-size: 10px; color: #6b6478; margin-bottom: 12px; }
        h3 { font-size: 11px; font-weight: 700; margin: 14px 0 4px; color: #3d2a55; }
        /* หัวข้อกลุ่มห้ามอยู่ท้ายหน้าโดยไม่มีรายชื่อตามมา */
        h3 { break-after: avoid; page-break-after: avoid; }
        .sub { font-weight: 400; color: #6b6478; }
        .badges { float: right; font-weight: 400; font-size: 10px; color: #4a4358; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
        th { background: #f1edf7; color: #3d2a55; font-weight: 600; padding: 5px 6px; border: 1px solid #cdc2de; text-align: left; }
        td { padding: 4px 6px; border: 1px solid #e6e0f0; vertical-align: top; }
        tr:nth-child(even) td { background: #faf9fc; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        .summary { margin-bottom: 18px; }
        .confirmed { color: #16a34a; font-weight: 600; }
        .dim { color: #aaa; }
        .num { text-align: center; font-variant-numeric: tabular-nums; }
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .print-notice { display: none !important; }
          @page { margin: 10mm; size: A4 portrait; }
        }
      `}</style>

      <div className="print-notice">
        <p>กด <strong>Ctrl+P</strong> เพื่อพิมพ์ · เลือก "Save as PDF" · ปิด "Headers and footers" ใน More settings</p>
      </div>

      <h2>รายงานผลการสอบติดราย{dimLabel} ปีการศึกษา {yearName}</h2>
      <p className="meta">
        {totals ? `${totals.groups ?? totals.faculties} ${dimLabel} · ${totals.students} คน · ${totals.rows} รายการ` : ''}
        {conditions.length > 0 ? ` · ${conditions.join(' · ')}` : ''}
      </p>

      {groups.length === 0 ? (
        <p className="meta">ไม่มีข้อมูลการสอบติดตามเงื่อนไขที่เลือก</p>
      ) : (
        <>
          {/* สรุปภาพรวมก่อน แล้วค่อยลงรายชื่อ — คนอ่านส่วนใหญ่ดูแค่หน้าแรก */}
          <table className="summary">
            <thead>
              <tr>
                <th className="num" style={{ width: 32 }}>ลำดับ</th>
                <th style={{ minWidth: 150 }}>{dimLabel}</th>
                <th style={{ minWidth: 150 }}>{groupUni ? 'มหาวิทยาลัย' : 'มหาวิทยาลัยที่มีคนติดมากสุด'}</th>
                {!groupUni && <th className="num" style={{ width: 44 }}>จำนวนแห่ง</th>}
                <th className="num" style={{ width: 40 }}>คน</th>
                <th className="num" style={{ width: 46 }}>รายการ</th>
                <th className="num" style={{ width: 44 }}>ยืนยัน</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={g.key}>
                  <td className="num" style={{ color: '#999' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{titleOf(g)}</td>
                  <td>
                    {groupUni
                      ? `${g.university}${g.campus ? ` (${g.campus})` : ''}`
                      : g.mainUni || <span className="dim">-</span>}
                  </td>
                  {!groupUni && <td className="num">{g.uniCount}</td>}
                  <td className="num">{g.students}</td>
                  <td className="num">{g.rows.length}</td>
                  <td className="num">{g.confirmed || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {groups.map((g, gi) => (
            <section key={g.key}>
              <h3>
                <span className="badges">
                  {g.students} คน
                  {g.rows.length !== g.students ? ` · ${g.rows.length} รายการ` : ''}
                  {g.confirmed > 0 ? ` · ยืนยัน ${g.confirmed}` : ''}
                </span>
                {gi + 1}. {titleOf(g)}
                {groupUni && (
                  <span className="sub"> · {g.university}{g.campus ? ` (${g.campus})` : ''}</span>
                )}
              </h3>
              <table>
                <thead>
                  <tr>
                    <th className="num" style={{ width: 26 }}>#</th>
                    {idCols.map(c => (
                      <th key={c.key} className="num" style={{ width: c.width }}>{c.label}</th>
                    ))}
                    <th style={{ minWidth: 110 }}>ชื่อ-นามสกุล</th>
                    <th style={{ minWidth: 140 }}>มหาวิทยาลัย</th>
                    {byField && <th style={{ minWidth: 120 }}>คณะ</th>}
                    <th style={{ minWidth: 120 }}>สาขา</th>
                    <th className="num" style={{ width: 40 }}>ยืนยัน</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={`${r.student_code}|${i}`}>
                      <td className="num" style={{ color: '#999' }}>{i + 1}</td>
                      {idCols.map(c => (
                        <td
                          key={c.key}
                          className="num"
                          style={c.key === 'code' ? { fontFamily: 'monospace' } : undefined}
                        >
                          {cellOf(r, c.key)}
                        </td>
                      ))}
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td>
                        {r.university || <span className="dim">-</span>}
                        {r.campus ? <span className="sub"> (วิทยาเขต{r.campus})</span> : ''}
                      </td>
                      {byField && <td>{r.faculty || <span className="dim">-</span>}</td>}
                      <td>{r.program || <span className="dim">-</span>}</td>
                      <td className="num">{r.confirmed ? <span className="confirmed">✓</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </>
  );
}
