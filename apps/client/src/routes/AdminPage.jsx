import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileSearch, FileSpreadsheet, Search, ShieldCheck, UserCog, UserRoundPlus, UserRoundX } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { apiFetch } from '../api.js';
import { z } from 'zod';

const employeeProfileSchema = z.object({
  ecode: z.string().trim().min(1, 'Enter the E-code.').max(32).refine((value) => value !== '-', 'Enter a valid E-code.'),
  fullname: z.string().trim().min(2, 'Enter the employee name.').max(150),
  officeEmail: z.string().trim().email('Enter a valid office email.').max(254),
  phonenumber: z.string().trim().min(7, 'Enter a valid phone number.').max(32)
    .regex(/^\+?[0-9().\-\s]+$/, 'Enter a valid phone number.'),
});

const maxEmployeeImportBytes = 5 * 1024 * 1024;

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`The admin API returned an unexpected response (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error('The admin API returned invalid JSON.');
  }
}

async function fetchPermissionDirectory({ queryKey }) {
  const [, term, page] = queryKey;
  const params = new URLSearchParams({ q: term, page: String(page) });
  const response = await apiFetch(`/api/admin/permissions?${params}`, { credentials: 'include' });
  const payload = await readApiResponse(response);
  if (!response.ok) throw new Error(payload.message || 'Unable to search permissions.');
  return payload;
}

async function fetchAdminList() {
  const response = await apiFetch('/api/admin/admins', { credentials: 'include' });
  const payload = await readApiResponse(response);
  if (!response.ok) throw new Error(payload.message || 'Unable to load administrators.');
  return payload.admins ?? [];
}

function permissionStatus(status) {
  return status === 'REVOKED' ? 'Revoked' : 'On file';
}

export default function AdminPage({ user }) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [roleEcode, setRoleEcode] = useState('');
  const [roleReason, setRoleReason] = useState('');
  const [roleEnabled, setRoleEnabled] = useState(true);
  const [roleMessage, setRoleMessage] = useState('');
  const [roleError, setRoleError] = useState('');
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const isManager = user.roles?.includes('ADMIN_MANAGER');
  const [activeTask, setActiveTask] = useState('permissions');
  const adminTasks = [
    { id: 'permissions', label: 'Permission search', icon: FileSearch },
    ...(isManager ? [{ id: 'employees', label: 'Employee profiles', icon: UserRoundPlus }] : []),
    { id: 'administrators', label: 'Administrators', icon: UserCog },
  ];
  const {
    register: registerEmployee,
    handleSubmit: handleEmployeeSubmit,
    reset: resetEmployeeForm,
    formState: { errors: employeeErrors },
  } = useForm({
    resolver: zodResolver(employeeProfileSchema),
    defaultValues: { ecode: '', fullname: '', officeEmail: '', phonenumber: '' },
  });

  const directory = useQuery({
    queryKey: ['admin-permission-directory', searchTerm, page],
    queryFn: fetchPermissionDirectory,
    enabled: searchTerm.length >= 2,
  });
  const admins = useQuery({ queryKey: ['admin-directory'], queryFn: fetchAdminList, enabled: activeTask === 'administrators' });
  const permissionRecords = directory.data?.results ?? [];
  const totalPages = Math.max(1, Math.ceil((directory.data?.total ?? 0) / (directory.data?.pageSize ?? 50)));

  function searchPermissions(event) {
    event.preventDefault();
    const term = searchInput.trim();
    if (term.length < 2) return;
    setSearchTerm(term);
    setPage(1);
  }

  async function changeAdminRole() {
    setRoleError('');
    setRoleMessage('');
    setIsChangingRole(true);
    try {
      const response = await apiFetch(`/api/admin/admins/${encodeURIComponent(roleEcode.trim())}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: roleEnabled, reason: roleReason }),
      });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.message || 'Unable to update this admin role.');
      setRoleMessage(payload.change.changed
        ? `${roleEcode.trim()} is ${roleEnabled ? 'now an admin' : 'no longer an admin'}.`
        : 'The admin role was already in that state.');
      setRoleEcode('');
      setRoleReason('');
      setRoleEnabled(true);
      await queryClient.invalidateQueries({ queryKey: ['admin-directory'] });
    } catch (error) {
      setRoleError(error.message || 'Could not reach the server. Try again.');
    } finally {
      setIsChangingRole(false);
    }
  }

  async function createEmployeeProfile(values) {
    setProfileError('');
    setProfileMessage('');
    setIsCreatingProfile(true);
    try {
      const response = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.message || 'Unable to create the employee profile.');
      setProfileMessage(`Profile created for ${payload.user.ecode}. They can sign in with their E-code and password.`);
      resetEmployeeForm();
    } catch (error) {
      setProfileError(error.message || 'Could not reach the server. Try again.');
    } finally {
      setIsCreatingProfile(false);
    }
  }

  async function importEmployeeProfiles(event) {
    event.preventDefault();
    setImportError('');
    setImportResult(null);
    if (!importFile) {
      setImportError('Choose an .xlsx employee spreadsheet.');
      return;
    }
    if (importFile.size > maxEmployeeImportBytes) {
      setImportError('The spreadsheet must be 5 MB or smaller.');
      return;
    }

    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const response = await apiFetch('/api/admin/users/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const payload = await readApiResponse(response);
      if (!response.ok) {
        if (payload.results) setImportResult(payload);
        throw new Error(payload.message || 'Unable to import employee profiles.');
      }
      setImportResult(payload);
      setImportFile(null);
      event.target.reset();
    } catch (error) {
      setImportError(error.message || 'Could not reach the server. Try again.');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="page-section admin-page" aria-labelledby="admin-page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 id="admin-page-title">Admin workspace</h1>
          <p className="page-subtitle">Choose an admin task to manage access, employee profiles, or administrator roles.</p>
        </div>
        <div className="heading-count"><ShieldCheck size={17} aria-hidden="true" />Admin access</div>
      </div>

      <nav className="admin-task-nav" aria-label="Admin tasks">
        {adminTasks.map(({ id, label, icon: Icon }) => (
          <button
            className={`admin-task-link${activeTask === id ? ' active' : ''}`}
            key={id}
            type="button"
            aria-current={activeTask === id ? 'page' : undefined}
            onClick={() => setActiveTask(id)}
          >
            <Icon size={17} aria-hidden="true" />{label}
          </button>
        ))}
      </nav>

      <section className="admin-section" aria-labelledby="directory-title" hidden={activeTask !== 'permissions'}>
        <div className="section-title">
          <div><h2 id="directory-title">Permission search</h2><p>Search across users, clients, and project codes.</p></div>
        </div>
        <form className="admin-search-form" onSubmit={searchPermissions}>
          <label className="admin-search-field" htmlFor="permission-search">
            <Search size={18} aria-hidden="true" />
            <input
              id="permission-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Client name or WBS code"
              minLength={2}
              maxLength={100}
            />
          </label>
          <button className="action-button" type="submit" disabled={searchInput.trim().length < 2 || directory.isFetching}>
            <Search size={17} aria-hidden="true" />{directory.isFetching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {directory.isError && <div className="inline-error" role="alert"><p>{directory.error.message}</p><button className="text-button" type="button" onClick={() => directory.refetch()}>Try again</button></div>}
        {directory.isPending && searchTerm && <p className="inline-status" role="status">Searching permission records...</p>}
        {directory.data && !directory.isError && (
          <>
            <p className="admin-result-count" aria-live="polite">{directory.data.total} permission record{directory.data.total === 1 ? '' : 's'} found</p>
            {permissionRecords.length === 0 ? (
              <div className="admin-empty"><FileSearch size={22} aria-hidden="true" /><span>No records match that client or WBS code.</span></div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th scope="col">User</th><th scope="col">Client / WBS</th><th scope="col">Permission</th><th scope="col">Evidence</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {permissionRecords.map((record) => (
                      <tr key={record.permissionId}>
                        <td><strong>{record.user.fullname}</strong><span>{record.user.ecode} · {record.user.officeEmail}</span></td>
                        <td><strong>{record.clientName}</strong><span>{record.wbsCode} · {record.lobName}</span></td>
                        <td>{record.permission}</td>
                        <td>
                          {record.proofs.length === 0 ? <span className="evidence-missing">No evidence</span> : (
                            <ul className="admin-evidence-list">
                              {record.proofs.map((proof) => (
                                <li key={proof.id}><a href={`/api/admin/evidence/${proof.id}`} target="_blank" rel="noreferrer">{proof.originalFilename || 'Open evidence'}</a></li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td><span className={`status-chip status-${record.consentStatus === 'REVOKED' ? 'revoked' : 'granted'}`}>{permissionStatus(record.consentStatus)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <nav className="admin-pagination" aria-label="Permission search pages">
                <span>Page {page} of {totalPages}</span>
                <div>
                  <button className="icon-control" type="button" disabled={page <= 1 || directory.isFetching} onClick={() => setPage((current) => current - 1)} aria-label="Previous page"><ArrowLeft size={17} aria-hidden="true" /></button>
                  <button className="icon-control" type="button" disabled={page >= totalPages || directory.isFetching} onClick={() => setPage((current) => current + 1)} aria-label="Next page"><ArrowRight size={17} aria-hidden="true" /></button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>

      {isManager && (
        <section className="admin-section employee-provisioning" aria-labelledby="employee-provisioning-title" hidden={activeTask !== 'employees'}>
          <div className="section-title">
            <div><h2 id="employee-provisioning-title">Employee profiles</h2><p>Pre-register employee details so they can sign in and continue to the app.</p><p className="employee-provisioning-note">This creates a profile only. Employees still authenticate through the configured organization sign-in service; no password is created or stored here.</p></div>
          </div>
          <div className="employee-provisioning-grid">
            <form className="employee-provision-form" onSubmit={handleEmployeeSubmit(createEmployeeProfile)} noValidate>
              <h3><UserRoundPlus size={18} aria-hidden="true" />Add one employee</h3>
              <label className="field-group" htmlFor="employee-ecode"><span>E-code</span><input className="plain-input" id="employee-ecode" maxLength={32} aria-invalid={Boolean(employeeErrors.ecode)} {...registerEmployee('ecode')} /></label>
              {employeeErrors.ecode && <p className="field-error">{employeeErrors.ecode.message}</p>}
              <label className="field-group" htmlFor="employee-name"><span>Full name</span><input className="plain-input" id="employee-name" maxLength={150} aria-invalid={Boolean(employeeErrors.fullname)} {...registerEmployee('fullname')} /></label>
              {employeeErrors.fullname && <p className="field-error">{employeeErrors.fullname.message}</p>}
              <label className="field-group" htmlFor="employee-email"><span>Office email</span><input className="plain-input" id="employee-email" type="email" maxLength={254} aria-invalid={Boolean(employeeErrors.officeEmail)} {...registerEmployee('officeEmail')} /></label>
              {employeeErrors.officeEmail && <p className="field-error">{employeeErrors.officeEmail.message}</p>}
              <label className="field-group" htmlFor="employee-phone"><span>Phone number</span><input className="plain-input" id="employee-phone" type="tel" maxLength={32} aria-invalid={Boolean(employeeErrors.phonenumber)} {...registerEmployee('phonenumber')} /></label>
              {employeeErrors.phonenumber && <p className="field-error">{employeeErrors.phonenumber.message}</p>}
              {profileError && <p className="form-error" role="alert">{profileError}</p>}
              {profileMessage && <p className="save-confirmation" role="status">{profileMessage}</p>}
              <button className="action-button" type="submit" disabled={isCreatingProfile}>
                <UserRoundPlus size={17} aria-hidden="true" />{isCreatingProfile ? 'Creating profile...' : 'Create profile'}
              </button>
            </form>

            <form className="employee-provision-form" onSubmit={importEmployeeProfiles}>
              <h3><FileSpreadsheet size={18} aria-hidden="true" />Import from Excel</h3>
              <p className="employee-import-guidance">Upload an .xlsx file with these first-row headings: <strong>Ecode</strong>, <strong>Full name</strong>, <strong>Office email</strong>, <strong>Phone number</strong>. Up to 500 employees, 5 MB maximum. Format phone numbers as text to preserve leading zeroes and + signs.</p>
              <label className="field-group" htmlFor="employee-workbook"><span>Employee workbook</span><input id="employee-workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setImportError(''); setImportResult(null); }} /></label>
              {importError && <p className="form-error" role="alert">{importError}</p>}
              <button className="action-button" type="submit" disabled={!importFile || isImporting}>
                <FileSpreadsheet size={17} aria-hidden="true" />{isImporting ? 'Importing employees...' : 'Import employees'}
              </button>
              {importResult && (
                <div className="employee-import-results" role="status">
                  <p>{importResult.createdCount} created · {importResult.skippedCount} skipped</p>
                  <ul>
                    {importResult.results.map((result) => (
                      <li key={`${result.row}-${result.ecode || 'empty'}`}>
                        <strong>Row {result.row}{result.ecode ? ` · ${result.ecode}` : ''}</strong>
                        <span className={result.status === 'created' ? 'import-created' : 'import-skipped'}>{result.status}</span>
                        {result.message && <small>{result.message}</small>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>
          </div>
        </section>
      )}

      <section className="admin-section admin-management" aria-labelledby="admins-title" hidden={activeTask !== 'administrators'}>
        <div className="section-title">
          <div><h2 id="admins-title">Administrators</h2><p>Current users with elevated access.</p></div>
        </div>
        {admins.isPending && <p className="inline-status" role="status">Loading administrator list...</p>}
        {admins.isError && <div className="inline-error" role="alert"><p>{admins.error.message}</p><button className="text-button" type="button" onClick={() => admins.refetch()}>Try again</button></div>}
        {admins.data && admins.data.length === 0 && <p className="inline-status">No administrators assigned.</p>}
        {admins.data?.length > 0 && (
          <ul className="admin-list">
            {admins.data.map((admin) => (
              <li key={admin.ecode}>
                <span className="admin-avatar"><UserCog size={18} aria-hidden="true" /></span>
                <span className="admin-person"><strong>{admin.fullname}</strong><small>{admin.ecode} · {admin.officeEmail}</small></span>
                <span className="admin-roles">{admin.roles.map((role) => role.name === 'ADMIN_MANAGER' ? 'Admin manager' : 'Admin').join(', ')}</span>
                {isManager && admin.roles.some((role) => role.name === 'ADMIN') && (
                  <button
                    className="text-button admin-revoke"
                    type="button"
                    disabled={admin.ecode === user.ecode || isChangingRole}
                    onClick={() => {
                      setRoleEcode(admin.ecode);
                      setRoleReason('');
                      setRoleEnabled(false);
                      setRoleMessage('');
                      setRoleError('');
                    }}
                    title={admin.ecode === user.ecode ? 'You cannot revoke your own admin role' : 'Revoke admin role'}
                  ><UserRoundX size={16} aria-hidden="true" />Revoke</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isManager && (
          <form className="role-management-form" onSubmit={(event) => { event.preventDefault(); changeAdminRole(); }}>
            <h3>{roleEnabled ? <UserRoundPlus size={18} aria-hidden="true" /> : <UserRoundX size={18} aria-hidden="true" />}{roleEnabled ? 'Assign admin access' : `Revoke admin access for ${roleEcode}`}</h3>
            <div className="role-form-fields">
              <label className="field-group" htmlFor="admin-ecode"><span>User E-code</span><input className="plain-input" id="admin-ecode" value={roleEcode} onChange={(event) => setRoleEcode(event.target.value)} maxLength={32} required /></label>
              <label className="field-group" htmlFor="admin-reason"><span>Reason</span><input className="plain-input" id="admin-reason" value={roleReason} onChange={(event) => setRoleReason(event.target.value)} minLength={3} maxLength={500} required /></label>
              <button className="action-button" type="submit" disabled={isChangingRole || !roleEcode.trim() || roleReason.trim().length < 3}>
                {roleEnabled ? <UserRoundPlus size={17} aria-hidden="true" /> : <UserRoundX size={17} aria-hidden="true" />}
                {isChangingRole ? 'Saving...' : roleEnabled ? 'Assign admin' : 'Revoke admin'}
              </button>
              {!roleEnabled && <button className="text-button" type="button" onClick={() => { setRoleEnabled(true); setRoleEcode(''); setRoleReason(''); }}>Cancel</button>}
            </div>
          </form>
        )}
        {roleError && <p className="form-error" role="alert">{roleError}</p>}
        {roleMessage && <p className="save-confirmation" role="status">{roleMessage}</p>}
      </section>
    </section>
  );
}