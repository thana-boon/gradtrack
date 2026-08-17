import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { resolveMediaUrl } from '../utils/mediaUrl';
import PhotoUploadDialog from '../components/PhotoUploadDialog';
import Icon from '../components/ui/Icon';
import { Toast, EmptyState } from '../components/ui';

// ── Custom Confirm Dialog ─────────────────────────────────────────────────────
function ConfirmDialog({
  open,
  icon = 'alert',
  tone = 'error',
  title,
  message,
  confirmLabel = 'ยืนยัน',
  confirmClass = 'btn-error',
  onConfirm,
  onCancel,
}) {
  // Esc ต้องปิดได้เสมอ — ไม่งั้นคนใช้คีย์บอร์ดติดอยู่ในกล่อง
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onCancel?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const toneClass = {
    error: 'bg-error/10 text-error',
    success: 'bg-success/10 text-success',
    warning: 'bg-[#F5C518]/20 text-[#8a6a00]',
  }[tone];

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true">
      <div className="modal-box max-w-sm">
        <div className="flex gap-3.5">
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${toneClass}`}>
            <Icon name={icon} size={20} />
          </span>
          <div className="min-w-0">
            {title && <h3 className="text-base font-semibold">{title}</h3>}
            <p className="mt-1 text-sm text-base-content/65">{message}</p>
          </div>
        </div>
        <div className="modal-action mt-5">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>ยกเลิก</button>
          <button className={`btn btn-sm ${confirmClass}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
      <button className="modal-backdrop" aria-label="ปิด" onClick={onCancel} />
    </div>
  );
}

// ── ช่องค้นหาแบบพิมพ์แล้วมีรายการให้เลือก ────────────────────────────────────
function ComboField({ label, icon, placeholder, value, onChange, open, setOpen, items, renderItem, onPick, emptyText = 'ไม่พบรายการ' }) {
  return (
    <div className="relative">
      <label className="label flex items-center gap-1.5">
        <Icon name={icon} size={13} className="text-base-content/45" />
        {label}
      </label>
      <input
        className="input input-sm w-full"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-base-300 bg-base-100 py-1 shadow-lg">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-base-content/45">{emptyText}</p>
          ) : (
            items.map((it) => (
              <button
                type="button"
                key={renderItem(it).key}
                className="block w-full px-3 py-1.5 text-left text-sm leading-snug transition-colors hover:bg-secondary"
                onMouseDown={() => onPick(it)}
              >
                {renderItem(it).node}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SelectField({ label, icon, value, onChange, options, placeholder }) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <Icon name={icon} size={13} className="text-base-content/45" />
        {label}
      </label>
      <select className="select select-sm w-full" value={value} onChange={onChange}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

// ── Admission Add Form (7-level cascade) ─────────────────────────────────────
function AdmissionForm({ onSaved, onCancel }) {
  const [unis, setUnis]                 = useState([]);
  const [selUni, setSelUni]             = useState('');   // university_id
  const [uniSearch, setUniSearch]       = useState('');
  const [showUniDrop, setShowUniDrop]   = useState(false);

  const [campuses, setCampuses]         = useState([]);
  const [selCampus, setSelCampus]       = useState('');

  const [faculties, setFaculties]       = useState([]);
  const [selFaculty, setSelFaculty]     = useState('');
  const [facSearch, setFacSearch]       = useState('');
  const [showFacDrop, setShowFacDrop]   = useState(false);

  const [groupFields, setGroupFields]   = useState([]);   // สาขา
  const [selGroupField, setSelGroupField] = useState('');

  const [fields, setFields]             = useState([]);   // เอก
  const [selField, setSelField]         = useState('');

  const [progNames, setProgNames]       = useState([]);
  const [selProgName, setSelProgName]   = useState('');
  const [progSearch, setProgSearch]     = useState('');
  const [showProgDrop, setShowProgDrop] = useState(false);

  const [progTypes, setProgTypes]       = useState([]);
  const [selProgType, setSelProgType]   = useState('');

  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');

  // ── Load unis on mount ────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/universities').then(r => setUnis(r.data || []));
  }, []);

  // ── Level 2: Campuses — when uni changes ──────────────────────────────────
  useEffect(() => {
    setCampuses([]); setSelCampus('');
    setFaculties([]); setSelFaculty(''); setFacSearch('');
    setGroupFields([]); setSelGroupField('');
    setFields([]); setSelField('');
    setProgNames([]); setSelProgName(''); setProgSearch('');
    setProgTypes([]); setSelProgType('');
    setError('');
    if (!selUni) return;
    api.get('/programs/campuses', { params: { university_id: selUni } }).then(r => {
      const list = r.data || [];
      setCampuses(list);
      if (list.length === 1) setSelCampus(list[0]);
    });
  }, [selUni]);

  // ── Level 3: Faculties — when campus confirmed ────────────────────────────
  useEffect(() => {
    setFaculties([]); setSelFaculty(''); setFacSearch('');
    setGroupFields([]); setSelGroupField('');
    setFields([]); setSelField('');
    setProgNames([]); setSelProgName(''); setProgSearch('');
    setProgTypes([]); setSelProgType('');
    if (!selUni) return;
    if (campuses.length > 1 && !selCampus) return;  // รอผู้ใช้เลือก campus
    const params = { university_id: selUni };
    if (selCampus) params.campus = selCampus;
    api.get('/programs/faculties', { params }).then(r => setFaculties(r.data || []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selCampus, campuses.length]);

  // ── Level 4: Group fields (สาขา) — when faculty chosen ───────────────────
  useEffect(() => {
    setGroupFields([]); setSelGroupField('');
    setFields([]); setSelField('');
    setProgNames([]); setSelProgName(''); setProgSearch('');
    setProgTypes([]); setSelProgType('');
    if (!selUni || !selFaculty) return;
    const params = { university_id: selUni, faculty: selFaculty };
    if (selCampus) params.campus = selCampus;
    api.get('/programs/group-fields', { params }).then(r => {
      const list = r.data || [];
      setGroupFields(list);
      if (list.length <= 1) setSelGroupField(list[0] || '');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selFaculty]);

  // ── Level 5: Fields (เอก) — when group_field resolved ────────────────────
  useEffect(() => {
    setFields([]); setSelField('');
    setProgNames([]); setSelProgName(''); setProgSearch('');
    setProgTypes([]); setSelProgType('');
    if (!selUni || !selFaculty) return;
    if (groupFields.length > 1 && !selGroupField) return;  // รอเลือก
    const params = { university_id: selUni, faculty: selFaculty };
    if (selCampus) params.campus = selCampus;
    if (selGroupField) params.group_field = selGroupField;
    api.get('/programs/fields', { params }).then(r => {
      const list = r.data || [];
      setFields(list);
      if (list.length <= 1) setSelField(list[0] || '');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selGroupField, groupFields.length]);

  // ── Level 6: Program names (หลักสูตร) — when field resolved ──────────────
  useEffect(() => {
    setProgNames([]); setSelProgName(''); setProgSearch('');
    setProgTypes([]); setSelProgType('');
    if (!selUni || !selFaculty) return;
    if (groupFields.length > 1 && !selGroupField) return;
    if (fields.length > 1 && !selField) return;
    const params = { university_id: selUni, faculty: selFaculty };
    if (selCampus) params.campus = selCampus;
    if (selGroupField) params.group_field = selGroupField;
    if (selField) params.field_name = selField;
    api.get('/programs/names', { params }).then(r => setProgNames(r.data || []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selField, fields.length]);

  // ── Level 7: Program types (โปรแกรม) — when program name chosen ──────────
  useEffect(() => {
    setProgTypes([]); setSelProgType('');
    if (!selProgName || !selUni || !selFaculty) return;
    const params = { university_id: selUni, faculty: selFaculty, program_name: selProgName };
    if (selCampus) params.campus = selCampus;
    if (selGroupField) params.group_field = selGroupField;
    if (selField) params.field_name = selField;
    api.get('/programs/types', { params }).then(r => {
      const list = r.data || [];
      setProgTypes(list);
      if (list.length <= 1) setSelProgType(list[0] || '');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selProgName]);

  const canSave = selUni && selFaculty && selProgName &&
    (campuses.length === 0 || selCampus) &&
    (groupFields.length <= 1 || selGroupField) &&
    (fields.length <= 1 || selField) &&
    (progTypes.length <= 1 || selProgType);

  const handleSave = async () => {
    if (!canSave) { setError('กรุณาเลือกข้อมูลให้ครบทุกช่องก่อนกดเพิ่ม'); return; }
    setSaving(true); setError('');
    try {
      const params = { university_id: selUni, faculty: selFaculty, program_name: selProgName };
      if (selCampus) params.campus = selCampus;
      if (selGroupField) params.group_field = selGroupField;
      if (selField) params.field_name = selField;
      if (selProgType) params.program_type = selProgType;
      const { data: prog } = await api.get('/programs/find', { params });
      await api.post('/student/admissions', { program_id: prog.id });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    } finally { setSaving(false); }
  };

  const filteredUnis = unis.filter(u =>
    !uniSearch || u.name?.toLowerCase().includes(uniSearch.toLowerCase()) ||
    u.short_name?.toLowerCase().includes(uniSearch.toLowerCase())
  );
  const filteredFacs = faculties.filter(f =>
    !facSearch || f.toLowerCase().includes(facSearch.toLowerCase())
  );
  const filteredProgs = progNames.filter(p =>
    !progSearch || p.toLowerCase().includes(progSearch.toLowerCase())
  );

  return (
    <div className="anim-scale-in flex flex-col gap-3 rounded-xl border border-base-300 bg-base-200/70 p-4">
      <p className="text-xs text-base-content/55">
        เลือกจากบนลงล่าง — ช่องถัดไปจะขึ้นให้เองเมื่อเลือกช่องก่อนหน้าแล้ว
      </p>

      {/* 1. มหาวิทยาลัย */}
      <ComboField
        label="มหาวิทยาลัย"
        icon="university"
        placeholder="พิมพ์ชื่อเพื่อค้นหา..."
        value={uniSearch}
        onChange={e => { setUniSearch(e.target.value); setShowUniDrop(true); setSelUni(''); }}
        open={showUniDrop}
        setOpen={setShowUniDrop}
        items={filteredUnis}
        renderItem={(u) => ({
          key: u.id,
          node: (
            <>
              <span className="font-medium">{u.name}</span>
              {u.short_name && <span className="ml-1 text-xs text-base-content/45">({u.short_name})</span>}
            </>
          ),
        })}
        onPick={(u) => { setSelUni(String(u.id)); setUniSearch(u.name); setShowUniDrop(false); }}
      />

      {/* 2. วิทยาเขต — ถ้ามี >1 */}
      {selUni && campuses.length > 1 && (
        <SelectField
          label="วิทยาเขต"
          icon="pin"
          value={selCampus}
          onChange={e => setSelCampus(e.target.value)}
          options={campuses}
          placeholder="-- เลือกวิทยาเขต --"
        />
      )}

      {/* 3. คณะ */}
      {faculties.length > 0 && (
        <ComboField
          label="คณะ"
          icon="faculty"
          placeholder="พิมพ์ชื่อคณะ..."
          value={facSearch}
          onChange={e => { setFacSearch(e.target.value); setShowFacDrop(true); setSelFaculty(''); }}
          open={showFacDrop}
          setOpen={setShowFacDrop}
          items={filteredFacs}
          renderItem={(f) => ({ key: f, node: f })}
          onPick={(f) => { setSelFaculty(f); setFacSearch(f); setShowFacDrop(false); }}
        />
      )}

      {/* 4. กลุ่มสาขา (สาขา) — ถ้ามี >1 */}
      {selFaculty && groupFields.length > 1 && (
        <SelectField
          label="กลุ่มสาขา"
          icon="list"
          value={selGroupField}
          onChange={e => setSelGroupField(e.target.value)}
          options={groupFields}
          placeholder="-- เลือกกลุ่มสาขา --"
        />
      )}

      {/* 5. เอก (field_name) — ถ้ามี >1 */}
      {selFaculty && fields.length > 1 && (groupFields.length <= 1 || selGroupField) && (
        <SelectField
          label="เอก / วิชาเอก"
          icon="star"
          value={selField}
          onChange={e => setSelField(e.target.value)}
          options={fields}
          placeholder="-- เลือกวิชาเอก --"
        />
      )}

      {/* 6. หลักสูตร */}
      {progNames.length > 0 && (
        <ComboField
          label="หลักสูตร"
          icon="clipboard"
          placeholder="พิมพ์ชื่อหลักสูตร..."
          value={progSearch}
          onChange={e => { setProgSearch(e.target.value); setShowProgDrop(true); setSelProgName(''); }}
          open={showProgDrop}
          setOpen={setShowProgDrop}
          items={filteredProgs}
          renderItem={(p) => ({ key: p, node: p })}
          onPick={(p) => { setSelProgName(p); setProgSearch(p); setShowProgDrop(false); }}
        />
      )}

      {/* 7. โปรแกรม (program_type) — ถ้ามี >1 */}
      {selProgName && progTypes.length > 1 && (
        <SelectField
          label="โปรแกรม / ประเภท"
          icon="file"
          value={selProgType}
          onChange={e => setSelProgType(e.target.value)}
          options={progTypes}
          placeholder="-- เลือกโปรแกรม --"
        />
      )}

      {/* สรุปก่อนบันทึก */}
      {canSave && (
        <div className="anim-scale-in rounded-xl border border-success/30 bg-success/10 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-success">
            <Icon name="checkCircle" size={13} strokeWidth={2} />
            รายการที่จะเพิ่ม
          </p>
          <p className="text-sm font-semibold">{uniSearch}</p>
          {selCampus && (
            <p className="flex items-center gap-1 text-xs text-base-content/55">
              <Icon name="pin" size={12} />
              {selCampus}
            </p>
          )}
          <p className="text-xs text-base-content/70">{selFaculty}</p>
          {(selGroupField || selField) && (
            <p className="text-xs text-base-content/55">
              {[selGroupField, selField].filter(Boolean).join(' › ')}
            </p>
          )}
          <p className="mt-0.5 text-xs font-medium leading-snug">{selProgName}</p>
          {selProgType && <span className="badge badge-xs badge-ghost mt-1">{selProgType}</span>}
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <p className="flex items-center gap-1.5 text-xs text-error">
            <Icon name="alert" size={13} strokeWidth={2} />
            {error}
          </p>
        )}
      </div>

      <div className="mt-1 flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          ยกเลิก
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !canSave}>
          {saving ? <span className="loading loading-spinner loading-xs" /> : <Icon name="plus" size={15} />}
          เพิ่มรายการ
        </button>
      </div>
    </div>
  );
}

export default function StudentPage() {
  const { user, login, logout } = useAuth();

  // ── Quote ──
  const [quote, setQuote] = useState(user?.quote || '');
  const [editingQuote, setEditingQuote] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);

  // ── Photo ──
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(user?.photo_url || null);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const fileInputRef = useRef(null);

  // ── Toast ──
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Confirm Dialog ──
  const [dialog, setDialog] = useState(null);
  const openDialog = useCallback((opts) => setDialog(opts), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  // ── Admission ──
  const [admissions, setAdmissions] = useState([]);
  const [loadingAdmissions, setLoadingAdmissions] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const hasConfirmed = admissions.some(a => a.confirmed);

  const loadAdmissions = () => {
    setLoadingAdmissions(true);
    api.get('/student/admissions')
      .then(r => setAdmissions(r.data || []))
      .catch(() => setAdmissions([]))
      .finally(() => setLoadingAdmissions(false));
  };

  useEffect(() => { loadAdmissions(); }, []);

  const handleAdmissionSaved = () => {
    setShowAddForm(false);
    loadAdmissions();
    showToast('เพิ่มมหาวิทยาลัยเรียบร้อยแล้ว');
  };

  const handleDelete = (id) => {
    openDialog({
      icon: 'trash',
      tone: 'error',
      title: 'ลบรายการนี้',
      message: 'มหาวิทยาลัยนี้จะถูกลบออกจากรายการของคุณ เพิ่มใหม่ได้ภายหลัง',
      confirmLabel: 'ลบรายการ',
      confirmClass: 'btn-error',
      onConfirm: async () => {
        closeDialog();
        setDeletingId(id);
        try {
          await api.delete(`/student/admissions/${id}`);
          loadAdmissions();
          showToast('ลบรายการแล้ว');
        } catch (err) {
          showToast(err.response?.data?.message || 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง', 'error');
        } finally { setDeletingId(null); }
      },
    });
  };

  const handleConfirm = (id) => {
    openDialog({
      icon: 'graduation',
      tone: 'success',
      title: 'ยืนยันสิทธิ์',
      message: 'ต้องการยืนยันสิทธิ์ที่มหาวิทยาลัยนี้? ยังสามารถยกเลิกได้ภายหลัง',
      confirmLabel: 'ยืนยันสิทธิ์',
      confirmClass: 'btn-success',
      onConfirm: async () => {
        closeDialog();
        setConfirmingId(id);
        try {
          await api.post(`/student/admissions/${id}/confirm`);
          loadAdmissions();
          showToast('ยืนยันสิทธิ์เรียบร้อยแล้ว');
        } catch (err) {
          showToast(err.response?.data?.message || 'เกิดข้อผิดพลาด', 'error');
        } finally { setConfirmingId(null); }
      },
    });
  };

  const handleUnconfirm = (id) => {
    openDialog({
      icon: 'undo',
      tone: 'warning',
      title: 'ยกเลิกการยืนยันสิทธิ์',
      message: 'รายการนี้จะกลับไปเป็นสถานะยังไม่ยืนยัน และยืนยันใหม่ได้',
      confirmLabel: 'ยกเลิกการยืนยัน',
      confirmClass: 'btn-warning',
      onConfirm: async () => {
        closeDialog();
        setConfirmingId(id);
        try {
          await api.post(`/student/admissions/${id}/unconfirm`);
          loadAdmissions();
          showToast('ยกเลิกการยืนยันแล้ว');
        } catch (err) {
          showToast(err.response?.data?.message || 'เกิดข้อผิดพลาด', 'error');
        } finally { setConfirmingId(null); }
      },
    });
  };

  const handleSaveQuote = async () => {
    setSavingQuote(true);
    try {
      await api.put('/student/profile/quote', { quote });
      const updated = { ...user, quote };
      login(updated, localStorage.getItem('token'));
      setEditingQuote(false);
      showToast('บันทึกคำคมแล้ว');
    } catch {
      showToast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง', 'error');
    } finally {
      setSavingQuote(false);
    }
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingPhoto(file);
  };

  const uploadPhotoFile = async (file) => {
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await api.post('/student/profile/photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhotoUrl(res.data.photo_url);
      login({ ...user, photo_url: res.data.photo_url }, localStorage.getItem('token'));
      showToast('อัปโหลดรูปเรียบร้อยแล้ว');
      setPendingPhoto(null);
    } catch {
      showToast('อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const deletePhoto = () => {
    openDialog({
      icon: 'trash',
      tone: 'error',
      title: 'ลบรูปโปรไฟล์',
      message: 'ต้องการลบรูปนี้ใช่หรือไม่? อัปโหลดใหม่ได้ตลอด',
      confirmLabel: 'ลบรูป',
      confirmClass: 'btn-error',
      onConfirm: async () => {
        closeDialog();
        setUploadingPhoto(true);
        try {
          await api.delete('/student/profile/photo');
          setPhotoUrl(null);
          login({ ...user, photo_url: null }, localStorage.getItem('token'));
          showToast('ลบรูปแล้ว');
        } catch {
          showToast('ลบรูปไม่สำเร็จ', 'error');
        } finally {
          setUploadingPhoto(false);
        }
      },
    });
  };

  // logout() พาออกไป SchoolOS เอง — ห้ามต่อท้ายด้วย navigate('/login') (ดู DashboardPage)
  const handleLogout = () => logout();

  return (
    <div className="min-h-dvh bg-base-200">
      <ConfirmDialog
        open={!!dialog}
        icon={dialog?.icon}
        tone={dialog?.tone}
        title={dialog?.title}
        message={dialog?.message}
        confirmLabel={dialog?.confirmLabel}
        confirmClass={dialog?.confirmClass}
        onConfirm={dialog?.onConfirm}
        onCancel={closeDialog}
      />

      {/* Photo upload + background removal */}
      <PhotoUploadDialog
        key={pendingPhoto?.name + pendingPhoto?.lastModified}
        file={pendingPhoto}
        uploading={uploadingPhoto}
        onCancel={() => setPendingPhoto(null)}
        onConfirm={uploadPhotoFile}
      />

      <Toast toast={toast} />

      {/* ── Topbar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-base-300 bg-base-100/80 px-4 backdrop-blur-md sm:px-6">
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-content">
          <Icon name="graduation" size={19} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold tracking-tight">GradTrack</p>
          <p className="truncate text-[11px] text-base-content/50">โรงเรียนสุคนธีรวิทย์</p>
        </div>
        <span className="ml-auto hidden text-xs text-base-content/55 sm:block">
          {user?.class_level} ห้อง {user?.class_room}
        </span>
        <button className="btn btn-ghost btn-sm gap-1.5" onClick={handleLogout}>
          <Icon name="logout" size={16} />
          <span className="max-sm:hidden">ออกจากระบบ</span>
        </button>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:py-8">

        {/* ── การ์ดโปรไฟล์ ───────────────────────────────── */}
        <section className="card anim-fade-up overflow-hidden bg-base-100">
          <div className="gt-band h-24 rounded-none" />
          <div className="flex flex-col items-center px-5 pb-5 text-center sm:flex-row sm:items-end sm:gap-5 sm:text-left">
            <div className="relative -mt-14 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="block size-28 overflow-hidden rounded-2xl bg-base-200 ring-4 ring-base-100 transition-transform hover:scale-[1.02] sm:h-36 sm:w-28"
                aria-label="เปลี่ยนรูปโปรไฟล์"
              >
                {photoUrl ? (
                  <img
                    src={resolveMediaUrl(photoUrl)}
                    alt="รูปโปรไฟล์ของคุณ"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-base-content/30">
                    <Icon name="user" size={40} />
                  </span>
                )}
              </button>

              <button
                className="btn btn-circle btn-primary btn-sm absolute -bottom-1 -right-1 shadow-md"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPhoto}
                aria-label="เปลี่ยนรูปโปรไฟล์"
              >
                {uploadingPhoto ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Icon name="camera" size={16} />
                )}
              </button>

              {photoUrl && (
                <button
                  className="btn btn-circle btn-sm absolute -bottom-1 -left-1 border-base-300 bg-base-100 text-error shadow-md hover:bg-error hover:text-error-content"
                  onClick={deletePhoto}
                  disabled={uploadingPhoto}
                  aria-label="ลบรูปโปรไฟล์"
                >
                  <Icon name="trash" size={15} />
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>

            <div className="mt-3 min-w-0 flex-1 sm:mt-0 sm:pb-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {user?.title_prefix}{user?.first_name} {user?.last_name}
              </h1>
              <p className="mt-1 text-sm text-base-content/55">
                รหัส <span className="font-mono tabular-nums">{user?.username}</span> ·{' '}
                {user?.class_level} ห้อง {user?.class_room}
              </p>
              {hasConfirmed && (
                <span className="badge badge-sm badge-soft-success mt-2 gap-1">
                  <Icon name="checkCircle" size={12} strokeWidth={2} />
                  ยืนยันสิทธิ์แล้ว
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ── ผลการสอบคัดเลือก ───────────────────────────── */}
        <section className="card anim-fade-up bg-base-100 p-5" style={{ '--anim-delay': '0.06s' }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="gt-chip size-8">
                <Icon name="university" size={16} />
              </span>
              <h2 className="text-base font-semibold">ผลการสอบคัดเลือก</h2>
            </div>
            {!hasConfirmed && (
              <button
                className={`btn btn-sm gap-1.5 ${showAddForm ? 'btn-ghost' : 'btn-primary'}`}
                onClick={() => setShowAddForm(v => !v)}
              >
                <Icon name={showAddForm ? 'x' : 'plus'} size={15} />
                {showAddForm ? 'ปิด' : 'เพิ่ม'}
              </button>
            )}
          </div>

          {showAddForm && (
            <div className="mb-4">
              <AdmissionForm
                onSaved={handleAdmissionSaved}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          )}

          {loadingAdmissions ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-base-200 p-3">
                  <span className="gt-skeleton size-10 rounded-lg" />
                  <span className="flex-1">
                    <span className="gt-skeleton mb-1.5 block h-3 w-2/5" />
                    <span className="gt-skeleton block h-2.5 w-3/5" />
                  </span>
                </div>
              ))}
            </div>
          ) : admissions.length === 0 ? (
            <EmptyState
              icon="university"
              title="ยังไม่มีรายการ"
              hint="กดปุ่ม เพิ่ม ด้านบน เพื่อบันทึกมหาวิทยาลัยที่สอบติด"
              className="py-8"
            />
          ) : (
            <ul className="stagger-children flex flex-col gap-2.5">
              {admissions.map((a, idx) => (
                <li
                  key={a.id}
                  style={{ '--i': idx }}
                  className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                    a.confirmed
                      ? 'border-success/35 bg-success/8'
                      : 'border-base-300 bg-base-200/60'
                  }`}
                >
                  <div className="size-10 shrink-0">
                    {a.logo_url ? (
                      <img
                        src={resolveMediaUrl(a.logo_url)}
                        alt=""
                        width="40"
                        height="40"
                        loading="lazy"
                        className="size-10 rounded-lg bg-base-100 object-contain p-0.5"
                      />
                    ) : (
                      <span className="gt-chip size-10">
                        <Icon name="university" size={19} />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{a.university_name}</p>
                    {a.campus && (
                      <p className="flex items-center gap-1 truncate text-xs text-base-content/50">
                        <Icon name="pin" size={11} />
                        {a.campus}
                      </p>
                    )}
                    <p className="truncate text-xs text-base-content/60">{a.faculty_name}</p>
                    {(a.group_field || a.field_name_th) && (
                      <p className="truncate text-xs text-base-content/50">
                        {[a.group_field, a.field_name_th].filter(Boolean).join(' › ')}
                      </p>
                    )}
                    <p className="truncate text-xs font-medium leading-snug text-base-content/85">
                      {a.program_name_th}
                    </p>
                    {a.program_type && (
                      <span className="badge badge-xs badge-ghost mt-1">{a.program_type}</span>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {a.confirmed ? (
                      <>
                        <span className="badge badge-sm badge-soft-success gap-1">
                          <Icon name="checkCircle" size={12} strokeWidth={2} />
                          ยืนยันแล้ว
                        </span>
                        <button
                          className="btn btn-ghost btn-xs gap-1 text-[#8a6a00]"
                          onClick={() => handleUnconfirm(a.id)}
                          disabled={confirmingId === a.id}
                        >
                          {confirmingId === a.id ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <Icon name="undo" size={13} />
                          )}
                          ยกเลิก
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-success btn-xs gap-1"
                          onClick={() => handleConfirm(a.id)}
                          disabled={confirmingId === a.id || hasConfirmed}
                          title={hasConfirmed ? 'ยืนยันสิทธิ์ได้ที่เดียวเท่านั้น' : 'ยืนยันสิทธิ์ที่นี่'}
                        >
                          {confirmingId === a.id ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <Icon name="check" size={13} strokeWidth={2.2} />
                          )}
                          ยืนยันสิทธิ์
                        </button>
                        <button
                          className="btn btn-ghost btn-xs gap-1 text-error"
                          onClick={() => handleDelete(a.id)}
                          disabled={deletingId === a.id}
                        >
                          {deletingId === a.id ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <Icon name="trash" size={13} />
                          )}
                          ลบ
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── คำคม ───────────────────────────────────────── */}
        <section className="card anim-fade-up bg-base-100 p-5" style={{ '--anim-delay': '0.12s' }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="gt-chip size-8">
                <Icon name="sparkle" size={16} />
              </span>
              <h2 className="text-base font-semibold">คำคมของฉัน</h2>
            </div>
            {!editingQuote && (
              <button className="btn btn-ghost btn-sm gap-1.5" onClick={() => setEditingQuote(true)}>
                <Icon name="edit" size={15} />
                แก้ไข
              </button>
            )}
          </div>

          {editingQuote ? (
            <>
              <textarea
                className="textarea w-full resize-none"
                rows={4}
                maxLength={300}
                placeholder="เขียนคำคม คติประจำใจ หรือความฝันของคุณ..."
                value={quote}
                onChange={e => setQuote(e.target.value)}
                autoFocus
              />
              <p className="mt-1 text-right text-xs tabular-nums text-base-content/40">
                {quote.length}/300
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setQuote(user?.quote || ''); setEditingQuote(false); }}
                  disabled={savingQuote}
                >
                  ยกเลิก
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleSaveQuote} disabled={savingQuote}>
                  {savingQuote ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <Icon name="save" size={15} />
                  )}
                  บันทึก
                </button>
              </div>
            </>
          ) : quote ? (
            <blockquote className="border-l-2 border-[#F5C518] pl-4 text-sm italic leading-relaxed text-base-content/75 whitespace-pre-wrap">
              {quote}
            </blockquote>
          ) : (
            <p className="text-sm text-base-content/40">
              ยังไม่มีคำคม — กด แก้ไข เพื่อเพิ่มข้อความประจำตัวของคุณ
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
