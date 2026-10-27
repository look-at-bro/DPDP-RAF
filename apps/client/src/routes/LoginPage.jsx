import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, KeyRound, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

const loginSchema = z.object({
  username: z.string().trim()
    .min(1, 'Enter your E-code.')
    .refine((value) => value !== '-', 'Enter a valid E-code.'),
  password: z.string()
    .refine((value) => value.trim().length > 0, 'Enter your password.')
    .refine((value) => value.trim() !== '-', 'Enter a valid password.'),
});

export default function LoginPage() {
  const [apiError, setApiError] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  async function onSubmit(credentials) {
    setApiError('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
        credentials: 'include',
      });
      const payload = await response.json();

      console.log('[login] Authentication response:', {
        status: response.status,
        nextStep: payload.nextStep,
      });

      if (!response.ok) {
        setApiError(
          payload.message
          || payload.payload?.message
          || `Authentication failed (HTTP ${response.status}).`,
        );
        return;
      }

      if (payload.nextStep === 'APPLICATION' && payload.user) {
        console.info('[login] Existing profile found; continuing to the dashboard.');
        queryClient.setQueryData(['current-user'], payload.user);
        navigate('/dashboard', { replace: true });
        return;
      }

      if (payload.nextStep === 'PROFILE_REQUIRED') {
        console.info('[login] First-time user; profile registration is required.');
        navigate('/profile/setup', { state: { ecode: payload.ecode } });
        return;
      }

      setApiError('The server returned an unexpected login response.');
    } catch (error) {
      console.error('[login] Could not reach the login API:', error);
      setApiError('Could not reach the local login server. Start it with npm run dev.');
    }
  }

  return (
    <main className="login-layout">
      <aside className="brand-panel">
        <div className="brand-mark" aria-label="DPDP RAF">
          <span className="brand-symbol" aria-hidden="true">R</span>
          <span>DPDP <strong>RAF</strong></span>
        </div>

        <div className="brand-message">
          <p className="eyebrow">A clearer way forward</p>
          <h1>Good work starts with a clear view.</h1>
          <p className="brand-description">
            Sign in to continue to your DPDP RAF workspace.
          </p>
        </div>

        <p className="brand-footer">Focused work. Thoughtful decisions.</p>
      </aside>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <div className="mobile-brand" aria-label="DPDP RAF">
            <span className="brand-symbol" aria-hidden="true">R</span>
            <span>DPDP <strong>RAF</strong></span>
          </div>

          <p className="eyebrow login-eyebrow">Welcome back</p>
          <h2 id="login-title">Sign in to your account</h2>
          <p className="login-intro">Use your E-code and password to continue.</p>

          <form className="login-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="field-group">
              <label htmlFor="username">E-code</label>
              <div className={`input-wrap${errors.username ? ' has-error' : ''}`}>
                <UserRound size={18} aria-hidden="true" />
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter your E-code"
                  aria-invalid={Boolean(errors.username)}
                  aria-describedby={errors.username ? 'username-error' : undefined}
                  {...register('username')}
                />
              </div>
              {errors.username && <p className="field-error" id="username-error">{errors.username.message}</p>}
            </div>

            <div className="field-group">
              <label htmlFor="password">Password</label>
              <div className={`input-wrap${errors.password ? ' has-error' : ''}`}>
                <KeyRound size={18} aria-hidden="true" />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                />
              </div>
              {errors.password && <p className="field-error" id="password-error">{errors.password.message}</p>}
            </div>

            {apiError && <p className="form-error" role="alert">{apiError}</p>}

            <button className="submit-button" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Checking credentials...' : 'Sign in'}</span>
              {!isSubmitting && <ArrowRight size={18} aria-hidden="true" />}
              {isSubmitting && <span className="loading-dot" aria-hidden="true" />}
            </button>
          </form>

          <p className="login-footnote">Your credentials are sent to the configured authentication service and are not stored by this app.</p>
        </div>
      </section>
    </main>
  );
}