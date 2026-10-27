import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BadgeCheck, ShieldAlert, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { apiFetch } from '../api.js';

async function fetchApprovals() {
  const response = await apiFetch('/api/permissions', { credentials: 'include' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'Could not load approval activity.');
  return payload.permissions ?? [];
}

export default function WelcomePage({ user }) {
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: fetchApprovals });
  const items = approvals.data ?? [];
  const permissionCount = items.filter((item) => item.consentStatus !== 'REVOKED').length;
  const revokedCount = items.filter((item) => item.consentStatus === 'REVOKED').length;

  return (
    <section className="page-section dashboard-page" aria-labelledby="dashboard-title">
      <div className="dashboard-welcome">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1 id="dashboard-title">Good day, {user.fullname.split(' ')[0]}.</h1>
          <p className="page-subtitle">A clear view of your profile, permissions, and evidence.</p>
        </div>
        <div className="dashboard-id"><span className="profile-avatar"><UserRound size={22} aria-hidden="true" /></span><span><strong>{user.fullname}</strong><small>{user.ecode}</small></span></div>
      </div>

      <div className="dashboard-stats" aria-label="Permission summary">
        <div className="stat-block"><span className="stat-icon stat-green"><BadgeCheck size={19} aria-hidden="true" /></span><span className="stat-label">Permissions on file</span><strong>{approvals.isPending ? '—' : permissionCount}</strong></div>
        <div className="stat-block"><span className="stat-icon stat-red"><ShieldAlert size={19} aria-hidden="true" /></span><span className="stat-label">Revoked permissions</span><strong>{approvals.isPending ? '—' : revokedCount}</strong></div>
      </div>

      <div className="dashboard-lower">
        <section className="activity-section" aria-labelledby="activity-title">
          <div className="section-title"><div><h2 id="activity-title">Recent permissions</h2><p>Access records and their evidence.</p></div><Link className="inline-link" to="/approvals">View all <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
          {approvals.isPending && <p className="inline-status" role="status">Loading approval activity...</p>}
          {approvals.isError && <div className="inline-error" role="alert"><p>{approvals.error.message}</p><button className="text-button" type="button" onClick={() => approvals.refetch()}>Try again</button></div>}
          {!approvals.isPending && !approvals.isError && items.length === 0 && (
            <div className="dashboard-empty"><BadgeCheck size={22} aria-hidden="true" /><div><strong>No permissions recorded</strong><p>Your profile is ready. Add permissions you already have and attach their evidence.</p></div><Link className="inline-link" to="/approvals">Add a permission <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
          )}
          {items.length > 0 && <ul className="recent-list">{items.slice(0, 4).map((item) => <li key={item.permissionId}><span className="activity-mark"><BadgeCheck size={17} aria-hidden="true" /></span><span className="recent-details"><strong>{item.permission}</strong><small>{item.clientName} · {item.lobName} · {item.proofs?.length ? `${item.proofs.length} evidence file${item.proofs.length === 1 ? '' : 's'}` : 'No evidence attached'}</small></span><span className={`status-chip status-${item.consentStatus === 'REVOKED' ? 'revoked' : 'granted'}`}>{item.consentStatus === 'REVOKED' ? 'Revoked' : 'On file'}</span></li>)}</ul>}
        </section>
        <aside className="dashboard-profile">
          <div className="section-title"><div><h2>Profile details</h2><p>Your account information</p></div></div>
          <dl><div><dt>Email</dt><dd>{user.officeEmail}</dd></div><div><dt>Phone</dt><dd>{user.phonenumber}</dd></div><div><dt>Employee code</dt><dd>{user.ecode}</dd></div></dl>
          <Link className="inline-link" to="/profile">Edit profile <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </aside>
      </div>
    </section>
  );
}