import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Login } from './pages/Login';
import { Research } from './pages/Research';
import { Chat } from './pages/Chat';
import { Workspace } from './pages/Workspace';
import { Surfaces } from './pages/Surfaces';
import { Agent } from './pages/Agent';
import { Automation } from './pages/Automation';
import { Billing } from './pages/Billing';
import { Collab } from './pages/Collab';
import { Admin } from './pages/Admin';
import { Settings } from './pages/Settings';
import { Loading } from './components/ui';

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="content"><Loading label="Starting Apolla…" /></div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/research" element={<Research />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/collab" element={<Collab />} />
        <Route path="/collab/accept" element={<Collab />} />
        <Route path="/surfaces" element={<Surfaces />} />
        <Route path="/agent" element={<Agent />} />
        <Route path="/automation" element={<Automation />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/research" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ErrorBoundary>
          <Gate />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}
