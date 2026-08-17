import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import SessionGuard from './components/SessionGuard';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import StudentPage from './pages/StudentPage';
// หน้าหลังบ้านทั้งหมดถูก render ผ่าน <DashboardPage activePage="..."> เพื่อให้ได้โครง
// sidebar/topbar เดียวกัน — ที่นี่จึง import แค่หน้าที่ยืนอยู่นอกโครงแอป (print)
import PrintReportPage from './pages/admin/PrintReportPage';
import PrintAdmissionTablePage from './pages/admin/PrintAdmissionTablePage';
import PrintFacultyReportPage from './pages/admin/PrintFacultyReportPage';

export default function App() {
  return (
    <AuthProvider>
      {/* อยู่นอก Routes เพราะต้องเฝ้าทุกหน้าที่ล็อกอินแล้ว ไม่ผูกกับ route ไหนเป็นพิเศษ
          (หน้า login ไม่มี token ตัวนี้จึงเงียบไปเอง) */}
      <SessionGuard />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/accounts"
            element={
              <ProtectedRoute allowedRole="admin">
                <DashboardPage activePage="accounts" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/academic-years"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="academic-years" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="students" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/universities"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="universities" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/university-students"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="university-students" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/faculties"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="faculties" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/admission-status"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="admission-status" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/report"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="report" />
              </ProtectedRoute>
            }
          />
          <Route path="/admin/report/print" element={<PrintReportPage />} />
          <Route path="/admin/report-table/print" element={<PrintAdmissionTablePage />} />
          <Route path="/admin/report-faculty/print" element={<PrintFacultyReportPage />} />
          <Route
            path="/admin/report-table"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="report-table" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/backup"
            element={
              <ProtectedRoute allowedRole="admin">
                <DashboardPage activePage="backup" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/activity-log"
            element={
              <ProtectedRoute allowedRole="staff">
                <DashboardPage activePage="activity-log" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRole="student">
                <StudentPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
