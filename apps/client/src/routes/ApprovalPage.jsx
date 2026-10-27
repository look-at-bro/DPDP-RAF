import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, FileUp, Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { apiFetch } from '../api.js';

const acceptedTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'message/rfc822',
  'application/vnd.ms-outlook',
  'text/plain',
  'application/octet-stream',
];

const approvalSchema = z.object({
  permission: z.string().trim().min(2, 'Enter the permission name.').max(64),
  wbsCode: z.string().trim().min(1, 'Enter the WBS code.').max(64),
  clientName: z.string().trim().min(1, 'Enter the client name.').max(200),
  lobName: z.string().trim().min(1, 'Enter the line of business.').max(150),
  riskAcceptanceConfirmed: z.boolean().refine(Boolean, 'Acknowledge the permission risks before submitting.'),
  proof: z.custom((files) => typeof FileList !== 'undefined' && files instanceof FileList && files.length > 0, 'Choose an approval document.')
    .refine((files) => files?.[0] && files[0].size <= 10 * 1024 * 1024, 'The document must be 10 MB or smaller.')
    .refine((files) => files?.[0] && acceptedTypes.includes(files[0].type), 'Use a PDF, Word document, or email file.'),
});

const proofAccept = '.pdf,.doc,.docx,.eml,.msg,.txt';

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const message = response.status === 404
      ? 'The approval API route is unavailable. Restart the API server and try again.'
      : `The approval API returned an unexpected response (HTTP ${response.status}). Check the API server and try again.`;
    throw new Error(message);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('The approval API returned invalid JSON. Try again after checking the API server.');
  }
}

async function fetchApprovals() {
  const response = await apiFetch('/api/permissions', { credentials: 'include' });
  const payload = await readApiResponse(response);
  if (!response.ok) throw new Error(payload.message || 'Could not load your approvals.');
  return payload.permissions ?? [];
}

function statusLabel(status) {
  if (status === 'REVOKED') return 'Revoked';
  return 'On file';
}

export default function ApprovalPage() {
  const queryClient = useQueryClient();
  const [apiError, setApiError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fileName, setFileName] = useState('');
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: fetchApprovals });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(approvalSchema),
    defaultValues: { permission: '', wbsCode: '', clientName: '', lobName: '', riskAcceptanceConfirmed: false },
  });
  const proofRegistration = register('proof');

  async function onSubmit(values) {
    setApiError('');
    setSubmitted(false);
    const formData = new FormData();
    formData.append('permission', values.permission);
    formData.append('wbsCode', values.wbsCode);
    formData.append('clientName', values.clientName);
    formData.append('lobName', values.lobName);
    formData.append('riskAcceptanceConfirmed', String(values.riskAcceptanceConfirmed));
    formData.append('proof', values.proof[0]);

    try {
      const response = await apiFetch('/api/permissions', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const payload = await readApiResponse(response);
      if (!response.ok) throw new Error(payload.message || 'Unable to save this permission.');
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      reset();
      setFileName('');
      setSubmitted(true);
    } catch (error) {
      setApiError(error.message || 'Could not reach the server. Try again.');
    }
  }

  const approvalItems = approvals.data ?? [];

  return (
    <section className="page-section" aria-labelledby="approvals-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Access records</p>
          <h1 id="approvals-title">Approvals</h1>
          <p className="page-subtitle">Record permissions you already have and keep their evidence together.</p>
        </div>
        <div className="heading-count"><ShieldCheck size={17} aria-hidden="true" />{approvalItems.length} permission{approvalItems.length === 1 ? '' : 's'}</div>
      </div>

      <div className="approval-workspace">
        <aside className="approval-sidebar" aria-labelledby="approval-list-title">
          <div className="section-title approval-list-heading">
            <div><h2 id="approval-list-title">Your permissions</h2><p>Access and evidence recorded on your account</p></div>
          </div>
          {approvals.isPending && <p className="inline-status" role="status">Loading approvals...</p>}
          {approvals.isError && (
            <div className="inline-error" role="alert">
              <p>{approvals.error.message}</p>
              <button type="button" className="text-button" onClick={() => approvals.refetch()}>Try again</button>
            </div>
          )}
          {!approvals.isPending && !approvals.isError && approvalItems.length === 0 && (
            <div className="empty-approvals">
              <span className="empty-icon"><BadgeCheck size={20} aria-hidden="true" /></span>
              <strong>No permissions recorded</strong>
              <p>Add a permission you already have and attach its approval document.</p>
            </div>
          )}
          {approvalItems.length > 0 && (
            <ul className="approval-list">
              {approvalItems.map((approval) => (
                <li key={approval.permissionId} className="approval-list-item">
                  <div className="approval-list-top"><strong>{approval.permission}</strong><span className={`status-chip status-${approval.consentStatus?.toLowerCase()}`}>{statusLabel(approval.consentStatus)}</span></div>
                  <span className="approval-context">{approval.clientName} · {approval.lobName}</span>
                  <span className="approval-proof">{approval.proofs?.[0]?.originalFilename || 'No document attached'}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="approval-form-column">
          <div className="section-title">
            <div><h2>Add a permission</h2><p>Enter the access you have and attach its approval evidence.</p></div>
          </div>
          <form className="approval-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="field-group">
              <label htmlFor="permission">Permission name</label>
              <input className={`plain-input${errors.permission ? ' has-error' : ''}`} id="permission" placeholder="e.g. Client data access" aria-invalid={Boolean(errors.permission)} {...register('permission')} />
              {errors.permission && <p className="field-error">{errors.permission.message}</p>}
            </div>
            <div className="approval-context-fields">
              <div className="field-group">
                <label htmlFor="wbsCode">WBS code</label>
                <input className={`plain-input${errors.wbsCode ? ' has-error' : ''}`} id="wbsCode" placeholder="Project code" aria-invalid={Boolean(errors.wbsCode)} {...register('wbsCode')} />
                {errors.wbsCode && <p className="field-error">{errors.wbsCode.message}</p>}
              </div>
              <div className="field-group">
                <label htmlFor="clientName">Client</label>
                <input className={`plain-input${errors.clientName ? ' has-error' : ''}`} id="clientName" placeholder="Client or organization" aria-invalid={Boolean(errors.clientName)} {...register('clientName')} />
                {errors.clientName && <p className="field-error">{errors.clientName.message}</p>}
              </div>
              <div className="field-group full-width">
                <label htmlFor="lobName">Line of business</label>
                <input className={`plain-input${errors.lobName ? ' has-error' : ''}`} id="lobName" placeholder="e.g. Advisory" aria-invalid={Boolean(errors.lobName)} {...register('lobName')} />
                {errors.lobName && <p className="field-error">{errors.lobName.message}</p>}
              </div>
            </div>
            <div className="field-group">
              <label htmlFor="proof">Approval document</label>
              <input
                className="visually-hidden"
                id="proof"
                type="file"
                accept={proofAccept}
                aria-invalid={Boolean(errors.proof)}
                {...proofRegistration}
                onChange={(event) => {
                  proofRegistration.onChange(event);
                  setFileName(event.target.files?.[0]?.name || '');
                }}
              />
              <label className={`upload-zone${errors.proof ? ' upload-error' : ''}`} htmlFor="proof">
                <FileUp size={22} aria-hidden="true" />
                <span><strong>{fileName || 'Choose a file'}</strong>{fileName ? '' : ' to attach'}</span>
                <small>PDF, Word, or email · Up to 10 MB</small>
              </label>
              {errors.proof && <p className="field-error">{errors.proof.message}</p>}
            </div>
            <div className="risk-acceptance-control">
              <div className="risk-acceptance-summary">
                <ShieldAlert size={18} aria-hidden="true" />
                <p>Review the responsibilities and risks before recording additional access.</p>
              </div>
              <div className="consent-control">
                <input
                  id="riskAcceptanceConfirmed"
                  type="checkbox"
                  aria-invalid={Boolean(errors.riskAcceptanceConfirmed)}
                  aria-describedby={errors.riskAcceptanceConfirmed ? 'risk-acceptance-error' : undefined}
                  {...register('riskAcceptanceConfirmed')}
                />
                <div>
                  <label htmlFor="riskAcceptanceConfirmed">I acknowledge that this permission was approved, I understand its risks, and I will use it only within its approved scope and applicable policies.</label>
                  <Link className="risk-acceptance-link" to="/risk-acceptance" target="_blank" rel="noreferrer">Read risk acceptance</Link>
                </div>
              </div>
              {errors.riskAcceptanceConfirmed && <p className="field-error" id="risk-acceptance-error">{errors.riskAcceptanceConfirmed.message}</p>}
            </div>
            {apiError && <p className="form-error" role="alert">{apiError}</p>}
            {submitted && <p className="save-confirmation" role="status"><BadgeCheck size={16} aria-hidden="true" />Permission and evidence saved.</p>}
            <button className="action-button" type="submit" disabled={isSubmitting}>
              <Plus size={18} aria-hidden="true" />{isSubmitting ? 'Saving permission...' : 'Save permission'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}