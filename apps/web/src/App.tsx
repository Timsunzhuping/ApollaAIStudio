import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { Login } from './pages/Login';
import { Research } from './pages/Research';
import { Workspace } from './pages/Workspace';
import { Surfaces } from './pages/Surfaces';
import { Agent } from './pages/Agent';
import { Placeholder } from './pages/Placeholder';
import { Loading } from './components/ui';

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="content"><Loading label="Starting Apolla…" /></div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/research" element={<Research />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/surfaces" element={<Surfaces />} />
        <Route path="/agent" element={<Agent />} />
        <Route path="/automation" element={<Placeholder title="Automation" />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
        <Route path="*" element={<Navigate to="/research" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
