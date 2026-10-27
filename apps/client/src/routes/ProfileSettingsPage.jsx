import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { AtSign, Check, Phone, Save, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiFetch } from '../api.js';

const profileSchema = z.object({
  fullname: z.string().trim().min(2, 'Enter your full name.').max(150),
  officeEmail: z.string().trim().email('Enter a valid office email.').max(254),
  phonenumber: z.string().trim().min(7, 'Enter a valid phone number.').max(32)
    .regex(/^\+?[0-9().\-\s]+$/, 'Enter a valid phone number.'),
});

export default function ProfileSettingsPage({ user }) {
  const queryClient = useQueryClient();
  const [apiError, setApiError] = useState('');
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullname: user.fullname,
      officeEmail: user.officeEmail,
      phonenumber: user.phonenumber,
    },
  });

  async function onSubmit(profile) {
    setApiError('');
    setSaved(false);
    try {
      const response = await apiFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(profile),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to save your profile.');
      queryClient.setQueryData(['current-user'], payload.user);
      reset(payload.user);
      setSaved(true);
    } catch (error) {
      setApiError(error.message || 'Could not reach the server. Try again.');
    }
  }

  return (
    <section className="page-section" aria-labelledby="profile-page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h1 id="profile-page-title">Your profile</h1>
          <p className="page-subtitle">Keep your contact details up to date.</p>
        </div>
      </div>
      <div className="profile-editor">
        <div className="profile-summary">
          <div className="profile-avatar"><UserRound size={24} aria-hidden="true" /></div>
          <div><strong>{user.fullname}</strong><span>{user.officeEmail}</span></div>
          <dl className="profile-meta">
            <div><dt>Employee code</dt><dd>{user.ecode}</dd></div>
            {user.createdAt && <div><dt>Account created</dt><dd>{new Date(user.createdAt).toLocaleDateString()}</dd></div>}
            {user.updatedAt && <div><dt>Last updated</dt><dd>{new Date(user.updatedAt).toLocaleDateString()}</dd></div>}
          </dl>
        </div>

        <form className="settings-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="section-title"><div><h2>Personal details</h2><p>Employee code is managed by your organization.</p></div></div>
          <div className="field-group">
            <label htmlFor="fullname">Full name</label>
            <div className={`input-wrap${errors.fullname ? ' has-error' : ''}`}>
              <UserRound size={18} aria-hidden="true" />
              <input id="fullname" autoComplete="name" aria-invalid={Boolean(errors.fullname)} {...register('fullname')} />
            </div>
            {errors.fullname && <p className="field-error">{errors.fullname.message}</p>}
          </div>
          <div className="field-group">
            <label htmlFor="officeEmail">Office email</label>
            <div className={`input-wrap${errors.officeEmail ? ' has-error' : ''}`}>
              <AtSign size={18} aria-hidden="true" />
              <input id="officeEmail" type="email" autoComplete="email" aria-invalid={Boolean(errors.officeEmail)} {...register('officeEmail')} />
            </div>
            {errors.officeEmail && <p className="field-error">{errors.officeEmail.message}</p>}
          </div>
          <div className="field-group">
            <label htmlFor="phonenumber">Phone number</label>
            <div className={`input-wrap${errors.phonenumber ? ' has-error' : ''}`}>
              <Phone size={18} aria-hidden="true" />
              <input id="phonenumber" type="tel" autoComplete="tel" aria-invalid={Boolean(errors.phonenumber)} {...register('phonenumber')} />
            </div>
            {errors.phonenumber && <p className="field-error">{errors.phonenumber.message}</p>}
          </div>
          {apiError && <p className="form-error" role="alert">{apiError}</p>}
          {saved && <p className="save-confirmation" role="status"><Check size={16} aria-hidden="true" />Profile saved</p>}
          <button className="action-button" type="submit" disabled={isSubmitting || !isDirty}>
            <Save size={17} aria-hidden="true" />{isSubmitting ? 'Saving...' : 'Save changes'}
          </button>
        </form>
      </div>
    </section>
  );
}