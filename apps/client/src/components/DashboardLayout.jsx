import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Gauge, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';

export default function DashboardLayout({ user }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setError('');
    setIsSigningOut(true);
    try {
      const response = await fetch('/api/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Unable to sign out. Please try again.');
      queryClient.setQueryData(['current-user'], null);
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="app-brand" to="/dashboard" aria-label="DPDP RAF dashboard">
          <span className="brand-symbol" aria-hidden="true">R</span>
          <span>DPDP <strong>RAF</strong></span>
        </NavLink>
        <nav className="primary-nav" aria-label="Main navigation">
          <NavLink to="/dashboard" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Gauge size={17} aria-hidden="true" />Dashboard
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <UserRound size={17} aria-hidden="true" />Profile
          </NavLink>
          <NavLink to="/approvals" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <BadgeCheck size={17} aria-hidden="true" />Approvals
          </NavLink>
          {user.roles?.some((role) => ['ADMIN', 'ADMIN_MANAGER'].includes(role)) && (
            <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <ShieldCheck size={17} aria-hidden="true" />Admin
            </NavLink>
          )}
        </nav>
        <div className="header-account">
          <span className="account-name">{user.fullname}</span>
          <button className="signout-button" type="button" onClick={signOut} disabled={isSigningOut} aria-label="Sign out">
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>
      {error && <p className="shell-error" role="alert">{error}</p>}
      <main className="app-main"><Outlet /></main>
    </div>
  );
}