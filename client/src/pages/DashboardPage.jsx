import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from '../components/ui/Icon';
import Avatar from '../components/ui/Avatar';
import AdminDashboard from '../components/dashboard/AdminDashboard';
import StudentDashboard from '../components/dashboard/StudentDashboard';
import AccountsPage from './admin/AccountsPage';
import AcademicYearsPage from './admin/AcademicYearsPage';
import StudentsPage from './admin/StudentsPage';
import UniversitiesPage from './admin/UniversitiesPage';
import UniversityStudentsPage from './admin/UniversityStudentsPage';
import FacultiesPage from './admin/FacultiesPage';
import AdmissionStatusPage from './admin/AdmissionStatusPage';
import ReportPage from './admin/ReportPage';
import AdmissionTableReportPage from './admin/AdmissionTableReportPage';
import ActivityLogPage from './admin/ActivityLogPage';
import BackupPage from './admin/BackupPage';

// adminOnly = เมนูที่ครู read-only ไม่ควรเห็นเลย (API ฝั่งนั้นเป็น adminOnly อยู่แล้ว
// กดไปก็ได้ 403 กลับมา — ซ่อนตั้งแต่แรกดีกว่าให้เจอหน้าพัง)
const ADMIN_MENU = [
  { key: 'dashboard', label: 'ภาพรวม', path: '/dashboard', icon: 'dashboard' },
  { key: 'accounts', label: 'จัดการผู้ใช้งาน', path: '/admin/accounts', icon: 'users', adminOnly: true },
  { key: 'academic-years', label: 'ปีการศึกษา', path: '/admin/academic-years', icon: 'calendar' },
  { key: 'students', label: 'รายชื่อนักเรียน', path: '/admin/students', icon: 'graduation' },
  { key: 'universities', label: 'มหาวิทยาลัย', path: '/admin/universities', icon: 'university' },
  { key: 'university-students', label: 'นักเรียนตามมหาวิทยาลัย', path: '/admin/university-students', icon: 'search' },
  { key: 'faculties', label: 'คณะ/สาขา', path: '/admin/faculties', icon: 'faculty' },
  { key: 'admission-status', label: 'สถานะผลสอบ', path: '/admin/admission-status', icon: 'clipboard' },
  { key: 'report', label: 'รายงาน/Export', path: '/admin/report', icon: 'chart' },
  { key: 'report-table', label: 'รายงานตาราง', path: '/admin/report-table', icon: 'table' },
  { key: 'activity-log', label: 'Activity Log', path: '/admin/activity-log', icon: 'log' },
  { key: 'backup', label: 'สำรอง/กู้คืนข้อมูล', path: '/admin/backup', icon: 'save', adminOnly: true },
];

const TODAY = () =>
  new Date().toLocaleDateString('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/* เนื้อใน sidebar — ใช้ซ้ำทั้งฝั่ง desktop และ drawer มือถือ
   (ประกาศไว้นอก component หลัก ไม่งั้น React remount ใหม่ทุกครั้งที่ parent render) */
function SidebarBody({ mini = false, menu, activePage, user, roleLabel, onLogout }) {
  return (
    <div className="flex h-full flex-col">
      {/* แบรนด์ */}
      <div className="p-3">
        <div
          className={`flex items-center gap-3 rounded-xl bg-white/10 p-3 ring-1 ring-white/15 ${
            mini ? 'justify-center' : ''
          }`}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#F5C518] text-[#241b04]">
            <Icon name="graduation" size={20} strokeWidth={1.9} />
          </span>
          {!mini && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold tracking-tight text-white">GradTrack</p>
              <p className="truncate text-[11px] text-white/60">โรงเรียนสุคนธีรวิทย์</p>
              <p className="truncate text-[11px] font-medium text-[#F5C518]">ติดตามผลศึกษาต่อ</p>
            </div>
          )}
        </div>
      </div>

      {/* เมนู */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="เมนูหลัก">
        <ul className="flex flex-col gap-1">
          {menu.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end
                title={mini ? item.label : undefined}
                className={({ isActive }) =>
                  `gt-nav-link ${isActive ? 'is-active' : ''} ${mini ? 'justify-center px-0' : ''}`
                }
                aria-current={item.key === (activePage || 'dashboard') ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} />
                {!mini && <span className="truncate">{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* ผู้ใช้ + ออกจากระบบ */}
      <div className="border-t border-white/10 p-3">
        <div
          className={`mb-2 flex items-center gap-3 rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10 ${
            mini ? 'justify-center' : ''
          }`}
        >
          <Avatar user={user} className="size-8 bg-[#F5C518] text-xs font-bold text-[#241b04]" />
          {!mini && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium text-white">
                {user?.name || user?.username}
              </p>
              <p className="truncate text-[11px] text-white/50">{roleLabel}</p>
            </div>
          )}
        </div>
        <button
          onClick={onLogout}
          className={`gt-nav-link w-full text-white/70 hover:bg-white/10 ${
            mini ? 'justify-center px-0' : ''
          }`}
          title={mini ? 'ออกจากระบบ' : undefined}
        >
          <Icon name="logout" size={18} />
          {!mini && <span>ออกจากระบบ</span>}
        </button>
      </div>
    </div>
  );
}

export default function DashboardPage({ activePage }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  // ครูจาก SchoolOS ที่ไม่ได้เป็น teacher-admin → เข้าหลังบ้านได้แต่แก้อะไรไม่ได้
  const isStaff = user?.role === 'admin' || user?.role === 'teacher';
  const isReadOnly = user?.role === 'teacher';

  // ย่อ sidebar: จำไว้ข้ามการรีเฟรช (จอ 13" ยุบแล้วได้พื้นที่ตารางเพิ่มเยอะ)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('gt.sidebar') === 'collapsed'
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('gt.sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  // เปลี่ยนหน้า = ปิด drawer เสมอ ไม่งั้นมือถือค้างทับเนื้อหา
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // logout() พาออกไป SchoolOS เอง (ออกจากแพลตฟอร์มด้วยในการ navigate ครั้งเดียว)
  // — ห้าม navigate('/login') ต่อท้าย มันจะแข่งกับการเปลี่ยนหน้าจริงแล้วโชว์ฟอร์มของเรา
  // แวบหนึ่งก่อนออกไป ทั้งที่ผู้ใช้ไม่เคยต้องเห็นหน้านั้น
  const handleLogout = () => logout();

  const menu = ADMIN_MENU.filter((item) => !(item.adminOnly && isReadOnly));
  const current = menu.find((m) => m.key === (activePage || 'dashboard'));
  const pageTitle = isStaff ? current?.label || 'ภาพรวม' : 'หน้าหลัก';

  const renderContent = () => {
    if (!isStaff) return <StudentDashboard />;
    if (activePage === 'accounts') return <AccountsPage />;
    if (activePage === 'academic-years') return <AcademicYearsPage />;
    if (activePage === 'students') return <StudentsPage />;
    if (activePage === 'universities') return <UniversitiesPage />;
    if (activePage === 'university-students') return <UniversityStudentsPage />;
    if (activePage === 'faculties') return <FacultiesPage />;
    if (activePage === 'admission-status') return <AdmissionStatusPage />;
    if (activePage === 'report') return <ReportPage />;
    if (activePage === 'report-table') return <AdmissionTableReportPage />;
    if (activePage === 'activity-log') return <ActivityLogPage />;
    if (activePage === 'backup') return <BackupPage />;
    return <AdminDashboard />;
  };

  const roleLabel =
    user?.role === 'admin' ? 'ผู้ดูแลระบบ' : isReadOnly ? 'ครู · ดูอย่างเดียว' : 'นักเรียน';

  const sidebarProps = { menu, activePage, user, roleLabel, onLogout: handleLogout };

  return (
    <div className="min-h-dvh bg-base-200">
      <div className="flex">
        {/* ── Sidebar (จอใหญ่) ─────────────────────────────── */}
        {isStaff && (
          <aside
            className={`gt-no-print sticky top-0 hidden h-dvh shrink-0 flex-col transition-[width] duration-200 md:flex gt-sidebar ${
              collapsed ? 'w-20' : 'w-64'
            }`}
          >
            <SidebarBody mini={collapsed} {...sidebarProps} />
          </aside>
        )}

        {/* ── Drawer (มือถือ) ──────────────────────────────── */}
        {isStaff && drawerOpen && (
          <div className="gt-no-print fixed inset-0 z-50 md:hidden">
            <button
              className="absolute inset-0 bg-[#1a102a]/60 backdrop-blur-[2px]"
              aria-label="ปิดเมนู"
              onClick={() => setDrawerOpen(false)}
            />
            <div
              className="gt-sidebar absolute inset-y-0 left-0 w-72 shadow-2xl"
              style={{ animation: 'gt-fade-up 0.22s var(--gt-ease) both' }}
              role="dialog"
              aria-modal="true"
              aria-label="เมนูหลัก"
            >
              <button
                onClick={() => setDrawerOpen(false)}
                className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="ปิดเมนู"
              >
                <Icon name="x" size={18} />
              </button>
              <SidebarBody {...sidebarProps} />
            </div>
          </div>
        )}

        {/* ── เนื้อหา ──────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="gt-no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-base-300 bg-base-100/80 px-4 backdrop-blur-md sm:px-6">
            {isStaff && (
              <>
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="btn btn-ghost btn-sm -ml-1 px-2 md:hidden"
                  aria-label="เปิดเมนู"
                >
                  <Icon name="menu" size={20} />
                </button>
                <button
                  onClick={() => setCollapsed((c) => !c)}
                  className="btn btn-ghost btn-sm hidden px-2 md:inline-flex"
                  aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
                >
                  <Icon name={collapsed ? 'panelOpen' : 'panelClose'} size={18} />
                </button>
              </>
            )}

            <h1 className="truncate text-base font-semibold">{pageTitle}</h1>

            <span className="ml-auto hidden text-xs text-base-content/50 lg:block">
              {TODAY()}
            </span>

            <div className="ml-auto flex items-center gap-2 lg:ml-4">
              {isReadOnly && (
                <span className="badge badge-sm badge-gold gap-1 max-sm:hidden">
                  <Icon name="eye" size={12} strokeWidth={2} />
                  ดูอย่างเดียว
                </span>
              )}
              <span className="hidden text-sm font-medium sm:block">
                {user?.name || user?.username}
              </span>
              <Avatar
                user={user}
                className="size-9 bg-primary text-sm font-semibold text-primary-content"
              />
            </div>
          </header>

          {/* Main */}
          <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
            {isReadOnly && (
              <div role="status" className="alert mb-5 alert-info py-2.5 anim-fade-up">
                <Icon name="info" size={18} className="mt-px" />
                <span className="text-sm">
                  <span className="font-semibold">โหมดดูอย่างเดียว</span> — บัญชีครูเปิดดูข้อมูลได้ทุกหน้า
                  แต่บันทึก/แก้ไข/ลบไม่ได้ (ต้องเป็นผู้ดูแลระบบที่ SchoolOS)
                </span>
              </div>
            )}
            {renderContent()}
          </main>
        </div>
      </div>
    </div>
  );
}
