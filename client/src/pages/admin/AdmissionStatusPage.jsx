import { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import PhotoUploadDialog from '../../components/PhotoUploadDialog';
import Icon from '../../components/ui/Icon';
import { PageHeader, TableWrap, TableSkeleton, EmptyState, Tag } from '../../components/ui';

const STATUS_LABEL = {
  none:      { label: 'ยังไม่บันทึก',   short: 'ยังไม่บันทึก', tone: 'error',   icon: 'xCircle' },
  pending:   { label: 'รอยืนยันสิทธิ์', short: 'รอยืนยัน',     tone: 'gold',    icon: 'clock' },
  confirmed: { label: 'ยืนยันสิทธิ์แล้ว', short: 'ยืนยันแล้ว',  tone: 'success', icon: 'checkCircle' },
};

// พื้นหลังตารางหมากรุก — ช่วยให้เห็นว่ารูปที่ "ตัดพื้นหลังแล้ว" (PNG โปร่งใส) มองทะลุได้
const CHECKER_STYLE = {
  backgroundImage:
    'linear-gradient(45deg,#d4d4d4 25%,transparent 25%),linear-gradient(-45deg,#d4d4d4 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d4d4d4 75%),linear-gradient(-45deg,transparent 75%,#d4d4d4 75%)',
  backgroundSize: '10px 10px',
  backgroundPosition: '0 0,0 5px,5px -5px,-5px 0',
  backgroundColor: '#fff',
};

// รูปที่ตัดพื้นหลังแล้วจะถูกบันทึกเป็น .png โปร่งใส (ดู PhotoUploadDialog)
const isBgRemoved = (url) => /\.png(\?|$)/i.test(url || '');

export default function AdmissionStatusPage() {
  const [yearId, setYearId] = useState('');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // student object สำหรับ modal
  const [reloadToken, setReloadToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false); // โหลดซ้ำโดยไม่ล้างตาราง
  const [lastCode, setLastCode] = useState(null);      // คนล่าสุดที่เปิดดู — ไว้เลื่อนกลับไปหา
  const rowRefs = useRef(new Map());
  const modalRef = useRef(null);
  const importInputRef = useRef(null);
  const importResultRef = useRef(null);
  const photoInputRef = useRef(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [forceLoading, setForceLoading] = useState(false);
  const [forceResult, setForceResult] = useState(null);

  // ── CRUD state ──
  const [universities, setUniversities] = useState([]);
  const [uniPrograms, setUniPrograms] = useState([]);
  const [addForm, setAddForm] = useState({ uni_id: '', program_id: '', confirmed: false });
  const [addLoading, setAddLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // id ของ admission ที่กำลัง action
  const [photoUploading, setPhotoUploading] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [pendingAutoBg, setPendingAutoBg] = useState(false); // เปิดสวิตช์ลบพื้นหลังอัตโนมัติใน dialog
  const [photoBusy, setPhotoBusy] = useState(false);         // กำลังลบรูป / โหลดรูปมาลบพื้นหลัง

  const loadData = () => setReloadToken(t => t + 1);

  // โหลดปีการศึกษาแล้วใช้ปีแรก
  useEffect(() => {
    Promise.all([
      api.get('/academic-years').then(r => r.data || []),
      api.get('/academic-years/active').then(r => r.data || null).catch(() => null),
    ]).then(([years, active]) => {
      if (active?.active_year_id) {
        setYearId(String(active.active_year_id));
        return;
      }
      if (years.length > 0) setYearId(String(years[0].id));
    });
  }, []);

  // โหลดข้อมูลเมื่อเลือกปี
  // โหลดซ้ำ (หลังใส่รูป/แก้ข้อมูล) ต้องไม่สลับตารางเป็นโครงร่าง ไม่งั้นแถวหดเหลือ 8 แถว
  // แล้ว scroll ของ .table-scroll ก็ถูกดีดกลับไปคนแรก — คนที่กำลังไล่ใส่รูปจะหาที่เดิมไม่เจอ
  useEffect(() => {
    if (!yearId) return;
    const firstLoad = students.length === 0;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    api.get('/student/admin/admission-overview', { params: { year_id: yearId } })
      .then(r => {
        const data = r.data || [];
        setStudents(data);
        // sync selected ถ้า modal ยังเปิดอยู่
        setSelected(prev => prev ? (data.find(s => s.student_code === prev.student_code) || prev) : null);
      })
      .catch(() => { if (firstLoad) setStudents([]); })
      .finally(() => { setLoading(false); setRefreshing(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId, reloadToken]);

  // โหลดรายการมหาลัยครั้งเดียว
  useEffect(() => {
    api.get('/universities').then(r => setUniversities(r.data || [])).catch(() => {});
  }, []);

  // โหลด programs เมื่อเลือก uni
  useEffect(() => {
    if (!addForm.uni_id) return;
    api.get('/programs/list', { params: { university_id: addForm.uni_id } })
      .then(r => setUniPrograms(r.data || []))
      .catch(() => setUniPrograms([]));
  }, [addForm.uni_id]);

  // Import Excel handler
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const formData = new FormData();
    formData.append('file', file);
    setImportLoading(true);
    setImportResult(null);
    try {
      const r = await api.post('/student/admin/import-admissions', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult({ ok: true, ...r.data });
      importResultRef.current?.showModal();
      loadData();
    } catch (err) {
      setImportResult({ ok: false, message: err.response?.data?.message || err.message });
      importResultRef.current?.showModal();
    } finally {
      setImportLoading(false);
    }
  };

  const openModal = (s) => {
    setSelected(s);
    setLastCode(s.student_code);
    setAddForm({ uni_id: '', program_id: '', confirmed: false });
    setUniPrograms([]);
    modalRef.current?.showModal();
  };
  const closeModal = () => modalRef.current?.close();

  // ปิด modal แล้วพากลับไปที่แถวเดิม (เผื่อรายการขยับ/เพิ่งโหลดใหม่)
  const handleModalClose = () => {
    const row = lastCode && rowRefs.current.get(lastCode);
    if (row) requestAnimationFrame(() => row.scrollIntoView({ block: 'center' }));
  };

  // ── Admin CRUD handlers ──
  const handleAddAdmission = async () => {
    if (!addForm.program_id || !selected) return;
    setAddLoading(true);
    try {
      await api.post('/student/admin/admissions', {
        student_code: selected.student_code,
        program_id: Number(addForm.program_id),
        confirmed: addForm.confirmed ? 1 : 0,
      });
      setAddForm({ uni_id: '', program_id: '', confirmed: false });
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleToggleConfirm = async (admission) => {
    setActionLoading(admission.id);
    try {
      await api.patch(`/student/admin/admissions/${admission.id}/confirm`, {
        confirmed: admission.confirmed ? 0 : 1,
      });
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteAdmission = async (admission) => {
    if (!confirm(`ลบ "${admission.university_name}" ของ ${selected?.first_name}?`)) return;
    setActionLoading(admission.id);
    try {
      await api.delete(`/student/admin/admissions/${admission.id}`);
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAdminUploadPhoto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selected) return;
    setPendingAutoBg(false);
    setPendingPhoto(file);
  };

  // ลบรูปนักเรียน (ฝั่งแอดมิน)
  const deleteAdminPhoto = async () => {
    if (!selected?.photo_url) return;
    if (!window.confirm('ต้องการลบรูปนักเรียนคนนี้ใช่หรือไม่?')) return;
    setPhotoBusy(true);
    try {
      await api.delete(`/student/admin/students/${selected.student_code}/photo`);
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    } finally {
      setPhotoBusy(false);
    }
  };

  // โหลดรูปปัจจุบันมาเข้า dialog แล้วเปิดสวิตช์ลบพื้นหลังให้อัตโนมัติ
  const removeBgFromCurrent = async () => {
    if (!selected?.photo_url) return;
    setPhotoBusy(true);
    try {
      const res = await fetch(resolveMediaUrl(selected.photo_url));
      const blob = await res.blob();
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const file = new File([blob], `current-${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
      setPendingAutoBg(true);
      setPendingPhoto(file);
    } catch {
      alert('โหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setPhotoBusy(false);
    }
  };

  const uploadAdminPhotoFile = async (file) => {
    if (!selected) return;
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('year_id', String(yearId || '0'));

    setPhotoUploading(true);
    try {
      await api.post(`/student/admin/students/${selected.student_code}/photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPendingPhoto(null);
      setPendingAutoBg(false);
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleForceImport = async () => {
    if (!importResult?.warnings?.length) return;
    setForceLoading(true);
    setForceResult(null);
    try {
      const r = await api.post('/student/admin/force-import-admissions', {
        rows: importResult.warnings,
      });
      setForceResult({ ok: true, ...r.data });
      setImportResult(prev => ({ ...prev, warnings: [] }));
      loadData();
    } catch (err) {
      setForceResult({ ok: false, message: err.response?.data?.message || err.message });
    } finally {
      setForceLoading(false);
    }
  };

  const getUniversityLabel = (u) => u?.name || u?.name_th || u?.name_en || u?.short_name || `มหาวิทยาลัย #${u?.id}`;

  // จำนวนที่ยืนยันสิทธิ์ของนักเรียนแต่ละคน
  const confirmedCount = (s) => s.admissions.filter(a => a.confirmed).length;

  // สรุปจำนวน
  const counts = { all: students.length, none: 0, pending: 0, confirmed: 0 };
  for (const s of students) counts[s.status]++;
  // นักเรียนที่ยืนยันสิทธิ์มากกว่า 1 ที่ (ผิดหลักเกณฑ์ — มักเกิดจากตอน import)
  const multiConfirm = students.filter(s => confirmedCount(s) > 1);

  // filter + search
  const filtered = students.filter(s => {
    if (filter === 'multi') {
      if (confirmedCount(s) <= 1) return false;
    } else if (filter !== 'all' && s.status !== filter) {
      return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        s.student_code.includes(q) ||
        s.first_name?.toLowerCase().includes(q) ||
        s.last_name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const FILTERS = [
    { key: 'all',       label: 'ทั้งหมด',      icon: 'list' },
    { key: 'none',      label: 'ยังไม่บันทึก', icon: 'xCircle' },
    { key: 'pending',   label: 'รอยืนยัน',     icon: 'clock' },
    { key: 'confirmed', label: 'ยืนยันแล้ว',   icon: 'checkCircle' },
  ];

  return (
    <div>
      <PageHeader
        icon="clipboard"
        title="สถานะการบันทึกผลสอบ"
        subtitle="กดที่แถวของนักเรียนเพื่อดู เพิ่ม หรือแก้ไขรายการมหาวิทยาลัย"
      >
        <div className="relative w-full sm:w-56">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
          />
          <input
            className="input input-sm w-full pl-9"
            placeholder="ค้นหาชื่อ / รหัส"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="ค้นหานักเรียน"
          />
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportFile}
        />
        <button
          className="btn btn-primary btn-sm gap-1.5"
          onClick={() => importInputRef.current?.click()}
          disabled={importLoading}
        >
          {importLoading ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <Icon name="upload" size={15} />
          )}
          นำเข้า Excel
        </button>
      </PageHeader>

      {/* ── ตัวกรองสถานะ ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`btn btn-sm gap-1.5 ${filter === key ? 'btn-primary' : 'btn-outline'}`}
          >
            <Icon name={icon} size={14} />
            {label}
            <span className="font-semibold tabular-nums">{counts[key]}</span>
          </button>
        ))}

        {multiConfirm.length > 0 && (
          <button
            onClick={() => setFilter(filter === 'multi' ? 'all' : 'multi')}
            aria-pressed={filter === 'multi'}
            className={`btn btn-sm gap-1.5 ${
              filter === 'multi' ? 'btn-error' : 'btn-outline border-error/40 text-error hover:bg-error/10'
            }`}
            title="นักเรียนที่ยืนยันสิทธิ์มากกว่า 1 ที่ ซึ่งผิดหลักเกณฑ์ (มักเกิดจากตอน import)"
          >
            <Icon name="warning" size={14} />
            ยืนยันเกิน 1 ที่
            <span className="font-semibold tabular-nums">{multiConfirm.length}</span>
          </button>
        )}

        {refreshing && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-base-content/50" role="status">
            <span className="loading loading-spinner loading-xs" />
            กำลังอัปเดตข้อมูล…
          </span>
        )}
      </div>

      {/* ── คำอธิบายสัญลักษณ์รูป ── */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-base-content/55">
        <span className="font-medium text-base-content/45">รูปนักเรียน:</span>
        <span className="flex items-center gap-1.5">
          <Icon name="user" size={13} className="text-base-content/35" />
          ยังไม่ใส่รูป
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-4 w-3 rounded-sm bg-base-300 ring-1 ring-base-300" />
          ใส่รูปแล้ว (ยังไม่ตัดพื้นหลัง)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-4 w-3 rounded-sm ring-1 ring-base-300" style={CHECKER_STYLE} />
          <Icon name="sparkle" size={13} className="text-success" />
          ตัดพื้นหลังแล้ว (โปร่งใส)
        </span>
      </div>

      {/* ── ตาราง ── */}
      <TableWrap sticky className="anim-fade-up">
        <table className="table table-sm">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th>รหัส</th>
              <th className="w-16">รูป</th>
              <th>ชื่อ-นามสกุล</th>
              <th>ชั้น</th>
              <th>ห้อง</th>
              <th>สถานะ</th>
              <th>รายการที่บันทึก</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton rows={8} cols={8} />
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-0">
                  <EmptyState
                    icon={search || filter !== 'all' ? 'search' : 'clipboard'}
                    title={
                      search || filter !== 'all'
                        ? 'ไม่พบนักเรียนตามเงื่อนไขนี้'
                        : 'ยังไม่มีข้อมูลนักเรียน'
                    }
                    hint={
                      search || filter !== 'all'
                        ? 'ลองเปลี่ยนคำค้นหา หรือเลือกตัวกรอง ทั้งหมด'
                        : 'ตรวจสอบปีการศึกษาที่ใช้งานอยู่ในหน้า ปีการศึกษา'
                    }
                    action={
                      (search || filter !== 'all') && (
                        <button
                          className="btn btn-outline btn-sm gap-1"
                          onClick={() => { setSearch(''); setFilter('all'); }}
                        >
                          <Icon name="x" size={14} />
                          ล้างตัวกรอง
                        </button>
                      )
                    }
                  />
                </td>
              </tr>
            ) : (
              filtered.map((s, i) => {
                const st = STATUS_LABEL[s.status];
                const nConfirmed = confirmedCount(s);
                const overConfirmed = nConfirmed > 1;
                return (
                  <tr
                    key={s.student_code}
                    ref={(el) => {
                      if (el) rowRefs.current.set(s.student_code, el);
                      else rowRefs.current.delete(s.student_code);
                    }}
                    className={`cursor-pointer ${overConfirmed ? 'bg-error/5' : ''} ${
                      s.student_code === lastCode ? 'ring-2 ring-inset ring-primary/45' : ''
                    }`}
                    onClick={() => openModal(s)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openModal(s);
                      }
                    }}
                    aria-label={`เปิดรายละเอียดของ ${s.first_name} ${s.last_name}`}
                  >
                    <td className="text-xs tabular-nums text-base-content/40">{i + 1}</td>
                    <td className="font-mono text-xs tabular-nums">{s.student_code}</td>
                    <td>
                      <div
                        className="relative flex h-12 w-9 items-center justify-center overflow-hidden rounded-md ring-1 ring-base-300"
                        style={s.photo_url ? CHECKER_STYLE : undefined}
                        title={
                          !s.photo_url
                            ? 'ยังไม่ใส่รูป'
                            : isBgRemoved(s.photo_url)
                              ? 'ใส่รูปแล้ว · ตัดพื้นหลังแล้ว'
                              : 'ใส่รูปแล้ว · ยังไม่ตัดพื้นหลัง'
                        }
                      >
                        {s.photo_url ? (
                          <>
                            <img
                              src={resolveMediaUrl(s.photo_url)}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                            {isBgRemoved(s.photo_url) && (
                              <span className="absolute bottom-0 right-0 grid size-4 place-items-center rounded-tl bg-success text-success-content">
                                <Icon name="check" size={10} strokeWidth={2.6} />
                              </span>
                            )}
                          </>
                        ) : (
                          <Icon name="user" size={18} className="text-base-content/25" />
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {s.title_prefix}{s.first_name} {s.last_name}
                    </td>
                    <td className="tabular-nums">{s.class_level}</td>
                    <td className="tabular-nums">{s.class_room}</td>
                    <td>
                      <Tag tone={st.tone} icon={st.icon}>{st.short}</Tag>
                    </td>
                    <td className="text-xs text-base-content/55">
                      <span className="whitespace-nowrap">
                        {s.admissions.length > 0 ? `${s.admissions.length} แห่ง` : '—'}
                      </span>
                      {overConfirmed && (
                        <Tag tone="error" icon="warning" className="ml-1.5">
                          ยืนยัน {nConfirmed} ที่
                        </Tag>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableWrap>

      {/* ── Modal รายละเอียดของนักเรียน ── */}
      <dialog ref={modalRef} className="modal" onClose={handleModalClose}>
        <div className="modal-box max-w-lg">
          {selected && (
            <>
              {/* Header */}
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold leading-tight">
                    {selected.title_prefix}{selected.first_name} {selected.last_name}
                  </h3>
                  <p className="mt-0.5 text-sm text-base-content/55">
                    รหัส <span className="font-mono tabular-nums">{selected.student_code}</span> · ม.
                    {selected.class_level}/{selected.class_room}
                  </p>
                </div>
                <Tag
                  tone={STATUS_LABEL[selected.status].tone}
                  icon={STATUS_LABEL[selected.status].icon}
                >
                  {STATUS_LABEL[selected.status].label}
                </Tag>
              </div>

              {/* รูปนักเรียน */}
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200/50 p-3">
                <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-base-300">
                  {selected.photo_url ? (
                    <img
                      src={resolveMediaUrl(selected.photo_url)}
                      alt={`รูปของ ${selected.first_name}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-base-content/30">
                      <Icon name="user" size={26} />
                    </span>
                  )}
                </div>
                <p className="flex-1 text-xs text-base-content/55">
                  รูปนักเรียน
                  <br />
                  (แอดมินแก้ไขได้)
                </p>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAdminUploadPhoto}
                />
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    className="btn btn-outline btn-sm gap-1.5"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoUploading || photoBusy}
                  >
                    {photoUploading ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <Icon name="image" size={14} />
                    )}
                    ใส่รูป
                  </button>
                  {selected.photo_url && (
                    <>
                      <button
                        className="btn btn-outline btn-sm gap-1.5"
                        onClick={removeBgFromCurrent}
                        disabled={photoUploading || photoBusy}
                        title="ลบพื้นหลังของรูปที่อัปโหลดแล้ว"
                      >
                        {photoBusy ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <Icon name="sparkle" size={14} />
                        )}
                        ลบพื้นหลัง
                      </button>
                      <button
                        className="btn btn-outline btn-error btn-sm gap-1.5"
                        onClick={deleteAdminPhoto}
                        disabled={photoUploading || photoBusy}
                      >
                        <Icon name="trash" size={14} />
                        ลบรูป
                      </button>
                    </>
                  )}
                </div>
                <PhotoUploadDialog
                  key={pendingPhoto?.name + pendingPhoto?.lastModified}
                  file={pendingPhoto}
                  uploading={photoUploading}
                  autoRemoveBg={pendingAutoBg}
                  onCancel={() => { setPendingPhoto(null); setPendingAutoBg(false); }}
                  onConfirm={uploadAdminPhotoFile}
                />
              </div>

              {/* แจ้งเตือนยืนยันสิทธิ์เกิน 1 ที่ */}
              {confirmedCount(selected) > 1 && (
                <div role="alert" className="alert alert-error mb-3 py-2.5">
                  <Icon name="warning" size={17} className="mt-px" />
                  <span className="text-sm">
                    นักเรียนคนนี้ยืนยันสิทธิ์ <b className="tabular-nums">{confirmedCount(selected)}</b> ที่
                    ซึ่งผิดหลักเกณฑ์ (ยืนยันได้เพียง 1 ที่) — โปรดยกเลิกยืนยันรายการที่เกิน
                  </span>
                </div>
              )}

              {/* รายการ admissions */}
              {selected.admissions.length === 0 ? (
                <EmptyState
                  icon="university"
                  title="ยังไม่มีการบันทึกข้อมูล"
                  hint="เพิ่มมหาวิทยาลัยที่นักเรียนสอบติดได้จากช่องด้านล่าง"
                  className="py-6"
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {selected.admissions.map((a, idx) => (
                    <li
                      key={a.id}
                      className={`flex items-start gap-3 rounded-xl border p-3 ${
                        a.confirmed ? 'border-success/35 bg-success/8' : 'border-base-300 bg-base-200/50'
                      }`}
                    >
                      <span className="w-4 shrink-0 text-xs tabular-nums text-base-content/40">
                        {idx + 1}
                      </span>
                      {a.logo_url ? (
                        <img
                          src={resolveMediaUrl(a.logo_url)}
                          alt=""
                          width="36"
                          height="36"
                          loading="lazy"
                          className="size-9 shrink-0 rounded-lg bg-base-100 object-contain p-0.5"
                        />
                      ) : (
                        <span className="gt-chip size-9">
                          <Icon name="university" size={18} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight">{a.university_name}</p>
                        {a.campus && (
                          <p className="flex items-center gap-1 text-xs text-base-content/55">
                            <Icon name="pin" size={11} />
                            วิทยาเขต {a.campus}
                          </p>
                        )}
                        <p className="text-xs text-base-content/60">{a.faculty_name}</p>
                        <p className="text-xs text-base-content/50">{a.program_name}</p>
                        {a.created_at && (
                          <p className="mt-0.5 text-[10px] tabular-nums text-base-content/40">
                            {new Date(a.created_at).toLocaleString('th-TH', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          className={`btn btn-xs gap-1 ${a.confirmed ? 'btn-outline' : 'btn-success'}`}
                          disabled={actionLoading === a.id}
                          onClick={() => handleToggleConfirm(a)}
                        >
                          {actionLoading === a.id ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <Icon name={a.confirmed ? 'undo' : 'check'} size={12} strokeWidth={2.2} />
                          )}
                          {a.confirmed ? 'ยกเลิก' : 'ยืนยัน'}
                        </button>
                        <button
                          className="btn btn-ghost btn-xs gap-1 text-error"
                          disabled={actionLoading === a.id}
                          onClick={() => handleDeleteAdmission(a)}
                        >
                          <Icon name="trash" size={12} />
                          ลบ
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* ── เพิ่มรายการ ── */}
              <div className="divider text-xs text-base-content/50">เพิ่มมหาวิทยาลัย</div>
              <div className="flex flex-col gap-2.5">
                <div>
                  <label htmlFor="add-uni" className="label">มหาวิทยาลัย</label>
                  <select
                    id="add-uni"
                    className="select select-sm w-full"
                    value={addForm.uni_id}
                    onChange={e => {
                      setUniPrograms([]);
                      setAddForm(f => ({ ...f, uni_id: e.target.value, program_id: '' }));
                    }}
                  >
                    <option value="">— เลือกมหาวิทยาลัย —</option>
                    {universities.map(u => (
                      <option key={u.id} value={u.id}>{getUniversityLabel(u)}</option>
                    ))}
                  </select>
                </div>

                {addForm.uni_id && (
                  <div>
                    <label htmlFor="add-prog" className="label">สาขา / หลักสูตร</label>
                    <select
                      id="add-prog"
                      className="select select-sm w-full"
                      value={addForm.program_id}
                      onChange={e => setAddForm(f => ({ ...f, program_id: e.target.value }))}
                    >
                      <option value="">— เลือกสาขา/หลักสูตร —</option>
                      {uniPrograms.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.faculty_name ? `[${p.faculty_name}] ` : ''}{p.program_name_th}
                          {p.program_type ? ` (${p.program_type})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-success"
                    checked={addForm.confirmed}
                    onChange={e => setAddForm(f => ({ ...f, confirmed: e.target.checked }))}
                  />
                  ยืนยันสิทธิ์ทันที
                </label>

                <button
                  className="btn btn-primary btn-sm gap-1.5"
                  disabled={!addForm.program_id || addLoading}
                  onClick={handleAddAdmission}
                >
                  {addLoading ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <Icon name="plus" size={15} />
                  )}
                  เพิ่มรายการ
                </button>
              </div>
            </>
          )}
          <div className="modal-action">
            <button className="btn btn-ghost btn-sm" onClick={closeModal}>ปิด</button>
          </div>
        </div>
        {/* กดพื้นหลังเพื่อปิด */}
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      {/* ── Import Result Dialog ── */}
      <dialog ref={importResultRef} className="modal">
        <div className="modal-box max-w-md">
          {importResult?.ok ? (
            <>
              {/* อ่านไฟล์ผ่าน ≠ ได้ข้อมูล — ถ้าไม่เข้าสักแถวต้องไม่ขึ้นเครื่องหมายถูกสีเขียว */}
              <div className="flex items-center gap-3">
                {importResult.imported > 0 ? (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
                      <Icon name="checkCircle" size={20} />
                    </span>
                    <h3 className="text-base font-semibold">นำเข้าข้อมูลสำเร็จ</h3>
                  </>
                ) : (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#F5C518]/15 text-[#8a6a00]">
                      <Icon name="warning" size={20} />
                    </span>
                    <h3 className="text-base font-semibold text-[#8a6a00]">
                      ไม่มีรายการถูกนำเข้า
                    </h3>
                  </>
                )}
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'รวมทั้งหมด', value: importResult.total, cls: 'text-base-content' },
                  { label: 'นำเข้าสำเร็จ', value: importResult.imported, cls: 'text-success' },
                  { label: 'ข้ามไป', value: importResult.skipped, cls: 'text-[#8a6a00]' },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-base-300 p-3">
                    <dd className={`text-xl font-semibold tabular-nums ${s.cls}`}>{s.value}</dd>
                    <dt className="mt-0.5 text-[11px] text-base-content/55">{s.label}</dt>
                  </div>
                ))}
              </dl>

              {importResult.errors?.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-semibold text-error">
                    รายละเอียดที่ข้าม ({importResult.errors.length}):
                  </p>
                  <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto text-xs text-base-content/60">
                    {importResult.errors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                </div>
              )}

              {importResult.warnings?.length > 0 && (
                <div className="mt-4 rounded-xl border border-[#F5C518]/45 bg-[#F5C518]/8 p-3">
                  <p className="mb-2 flex items-start gap-1.5 text-sm font-semibold text-[#8a6a00]">
                    <Icon name="warning" size={16} className="mt-0.5" />
                    พบ {importResult.warnings.length} รายการที่มีรหัสนักเรียนถูกต้อง แต่ไม่พบข้อมูลในระบบ
                  </p>
                  <div className="mb-3 flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {importResult.warnings.map((w, i) => (
                      <div key={i} className="rounded-lg bg-base-100 px-2 py-1 text-xs">
                        <span className="font-mono font-semibold tabular-nums">{w.student_code}</span>
                        {w.display_name && (
                          <span className="ml-1 text-base-content/60">({w.display_name})</span>
                        )}
                        <span className="ml-2 text-[#8a6a00]">{w.reason}</span>
                      </div>
                    ))}
                  </div>
                  {forceResult?.ok ? (
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                      <Icon name="checkCircle" size={14} />
                      บันทึกแล้ว {forceResult.saved} รายการ
                    </p>
                  ) : (
                    <>
                      {forceResult?.message && (
                        <p className="mb-1 text-xs text-error">{forceResult.message}</p>
                      )}
                      <button
                        className="btn btn-primary btn-sm w-full gap-1.5"
                        disabled={forceLoading}
                        onClick={handleForceImport}
                      >
                        {forceLoading ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <Icon name="plus" size={15} />
                        )}
                        เพิ่มรายการเหล่านี้ลงระบบเลย
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-error/10 text-error">
                <Icon name="alert" size={20} />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-error">นำเข้าข้อมูลไม่สำเร็จ</h3>
                <p className="mt-1 text-sm text-base-content/65">{importResult?.message}</p>
              </div>
            </div>
          )}
          <div className="modal-action">
            <button className="btn btn-ghost btn-sm" onClick={() => importResultRef.current?.close()}>
              ปิด
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
