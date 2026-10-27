import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  AtSign,
  Phone,
  UserRound,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { apiFetch } from '../api.js';

const profileSchema = z.object({
  fullname: z.string().trim().min(2, 'Enter your full name.').max(150),
  officeEmail: z.string().trim().email('Enter a valid office email.').max(254),
  phonenumber: z.string().trim().min(7, 'Enter a valid phone number.').max(32)
    .regex(/^\+?[0-9().\-\s]+$/, 'Enter a valid phone number.'),
});

export default function ProfilePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [ecode, setEcode] = useState(location.state?.ecode || '');
  const [apiError, setApiError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullname: '',
      officeEmail: '',
      phonenumber: '',
    },
  });

  useEffect(() => {
    if (ecode) return undefined;
    let active = true;

    apiFetch('/api/profile/setup', { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Sign in again to continue.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setEcode(payload.ecode);
      })
      .catch(() => {
        if (active) navigate('/', { replace: true });
      });

    return () => {
      active = false;
    };
  }, [ecode, navigate]);

  async function onSubmit(profile) {
    setApiError('');
    try {
      const response = await apiFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(profile),
      });
      const payload = await response.json();

      console.log('[profile] Registration response:', {
        status: response.status,
        success: payload.success,
        message: payload.message,
      });

      if (!response.ok) {
        setApiError(payload.message || `Profile registration failed (HTTP ${response.status}).`);
        return;
      }

      console.info('[profile] Registration completed; session cookie was issued.');
      console.info('[profile] E-code JWT received by the server and stored in an HttpOnly cookie.');
      queryClient.setQueryData(['current-user'], payload.user);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('[profile] Could not submit the profile:', error);
      setApiError('Could not reach the local server. Try again.');
    }
  }

  if (!ecode) {
    return (
      <main className="welcome-layout">
        <p role="status">Verifying your profile setup session...</p>
      </main>
    );
  }

  return (
    <main className="login-layout">
      <aside className="brand-panel">
        <div className="brand-mark" aria-label="DPDP RAF">
          <span className="brand-symbol" aria-hidden="true">R</span>
          <span>DPDP <strong>RAF</strong></span>
        </div>
        <div className="brand-message">
          <p className="eyebrow">One last step</p>
          <h1>Make this workspace yours.</h1>
          <p className="brand-description">Your E-code is verified. Add your profile details to continue.</p>
        </div>
        <p className="brand-footer">Focused work. Thoughtful decisions.</p>
      </aside>

      <section className="login-panel profile-panel" aria-labelledby="profile-title">
        <div className="login-content profile-content">
          <p className="eyebrow login-eyebrow">Profile registration</p>
          <h2 id="profile-title">Your details</h2>
            <p className="login-intro">Add your contact details to create your account. You can request approvals separately at any time.</p>

          <form className="login-form profile-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="field-group">
              <label htmlFor="ecode">Verified E-code</label>
              <div className="input-wrap profile-identity">
                <UserRound size={18} aria-hidden="true" />
                <span id="ecode">{ecode}</span>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="fullname">Full name</label>
              <div className={`input-wrap${errors.fullname ? ' has-error' : ''}`}>
                <UserRound size={18} aria-hidden="true" />
                <input
                  id="fullname"
                  autoComplete="name"
                  placeholder="Your full name"
                  aria-invalid={Boolean(errors.fullname)}
                  aria-describedby={errors.fullname ? 'fullname-error' : undefined}
                  {...register('fullname')}
                />
              </div>
              {errors.fullname && <p className="field-error" id="fullname-error">{errors.fullname.message}</p>}
            </div>

            <div className="field-group">
              <label htmlFor="officeEmail">Office email</label>
              <div className={`input-wrap${errors.officeEmail ? ' has-error' : ''}`}>
                <AtSign size={18} aria-hidden="true" />
                <input
                  id="officeEmail"
                  type="email"
                  autoComplete="email"
                  placeholder="name@company.com"
                  aria-invalid={Boolean(errors.officeEmail)}
                  aria-describedby={errors.officeEmail ? 'office-email-error' : undefined}
                  {...register('officeEmail')}
                />
              </div>
              {errors.officeEmail && <p className="field-error" id="office-email-error">{errors.officeEmail.message}</p>}
            </div>

            <div className="field-group">
              <label htmlFor="phonenumber">Phone number</label>
              <div className={`input-wrap${errors.phonenumber ? ' has-error' : ''}`}>
                <Phone size={18} aria-hidden="true" />
                <input
                  id="phonenumber"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+1 555 010 1234"
                  aria-invalid={Boolean(errors.phonenumber)}
                  aria-describedby={errors.phonenumber ? 'phone-error' : undefined}
                  {...register('phonenumber')}
                />
              </div>
              {errors.phonenumber && <p className="field-error" id="phone-error">{errors.phonenumber.message}</p>}
            </div>

            {apiError && <p className="form-error" role="alert">{apiError}</p>}

            <button className="submit-button" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Saving registration...' : 'Register and continue'}</span>
              {!isSubmitting && <ArrowRight size={18} aria-hidden="true" />}
              {isSubmitting && <span className="loading-dot" aria-hidden="true" />}
            </button>
          </form>

          <p className="login-footnote">Your E-code is bound to your verified sign-in.</p>
        </div>
      </section>
    </main>
  );
}