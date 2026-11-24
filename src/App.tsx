import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import StudyPage from './pages/study/StudyPage';
import ClubPage from './pages/club/ClubPage';
import ResearchPage from './pages/research/ResearchPage';
import ProtocolEditor from './pages/research/ProtocolEditor';
import ProtocolPrint from './pages/research/ProtocolPrint';
import Settings from './pages/Settings';
import Reader from './pages/study/Reader';

export default function App() {
  // finish saving any PDF text that wasn't done last time (used to find book quotes)
  useEffect(() => {
    const t = setTimeout(() => void import('./lib/bookSearch').then((m) => m.indexPendingPdfs()), 1500);
    // keep devices in step (only does anything once sync is turned on in Settings)
    void import('./lib/sync/engine').then((m) => m.startAutoSync());
    return () => clearTimeout(t);
  }, []);
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="study" element={<StudyPage />} />
        <Route path="read/:fileId" element={<Reader />} />
        <Route path="club" element={<ClubPage />} />
        <Route path="research" element={<ResearchPage />} />
        <Route path="research/:id" element={<ProtocolEditor />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="research/:id/print" element={<ProtocolPrint />} />
    </Routes>
  );
}
