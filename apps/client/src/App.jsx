import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { SESSION_EXPIRED_EVENT } from './api.js';
import ApprovalPage from './routes/ApprovalPage.jsx';
import AdminPage from './routes/AdminPage.jsx';
import DashboardLayout from './components/DashboardLayout.jsx';
import LoginPage from './routes/LoginPage.jsx';
import ProfilePage from './routes/ProfilePage.jsx';
import ProfileSettingsPage from './routes/ProfileSettingsPage.jsx';
import RiskAcceptancePage from './routes/RiskAcceptancePage.jsx';
import WelcomePage from './routes/WelcomePage.jsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

async function fetchCurrentUser() {
  const response = await fetch('/api/me', { credentials: 'include' });

  if (response.status === 401 || response.status === 404) return null;

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) throw new Error(payload?.message || 'Unable to verify your session.');
  if (!payload?.user) throw new Error('The session check returned an invalid response.');
  return payload.user;
}

function AppRoutes() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ['current-user'],
    queryFn: fetchCurrentUser,
    staleTime: 30000,
  });

  useEffect(() => {
    function handleSessionExpired() {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'current-user' });
      queryClient.setQueryData(['current-user'], null);
      navigate('/', { replace: true });
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [navigate, queryClient]);

  if (session.isPending) {
    return <main className="welcome-layout"><p role="status">Checking your session...</p></main>;
  }

  if (session.isError) {
    return (
      <main className="welcome-layout">
        <div className="welcome-content">
          <p className="form-error" role="alert">{session.error.message}</p>
          <button className="secondary-button" type="button" onClick={() => session.refetch()}>
            Retry session check
          </button>
        </div>
      </main>
    );
  }

  const user = session.data;

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/profile/setup" element={user ? <Navigate to="/dashboard" replace /> : <ProfilePage />} />
      <Route
        element={user ? <DashboardLayout user={user} /> : <Navigate to="/" replace />}
      >
        <Route path="/dashboard" element={<WelcomePage user={user} />} />
        <Route path="/profile" element={<ProfileSettingsPage user={user} />} />
        <Route path="/approvals" element={<ApprovalPage />} />
        <Route path="/risk-acceptance" element={<RiskAcceptancePage />} />
        <Route
          path="/admin"
          element={user?.roles?.some((role) => ['ADMIN', 'ADMIN_MANAGER'].includes(role))
            ? <AdminPage user={user} />
            : <Navigate to="/dashboard" replace />}
        />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}