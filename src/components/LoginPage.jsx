import { useState } from 'react';
import { login, register } from '../services/api';

export default function LoginPage({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let data;
      if (mode === 'login') {
        data = await login(email, password);
      } else {
        data = await register(email, password, name);
      }
      if (!data.token || !data.user) {
        throw new Error('Invalid server response. Please try again.');
      }
      localStorage.setItem('atlas-token', data.token);
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
  };

  return (
    <div className="login-page">
      {/* Background pattern */}
      <div className="login-bg">
        <div className="login-bg-gradient" />
        <div className="login-bg-grid" />
      </div>

      <div className="login-container">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">&#9670;</div>
          <span className="login-logo-text">ATLAS</span>
        </div>
        <p className="login-tagline">Medical Research Intelligence</p>

        {/* Card */}
        <div className="login-card">
          <h2 className="login-title">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="login-subtitle">
            {mode === 'login'
              ? 'Sign in to continue your research'
              : 'Start exploring medical literature with AI'}
          </p>

          <form onSubmit={handleSubmit} className="login-form">
            {mode === 'register' && (
              <div className="login-field">
                <label>Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dr. Jane Smith"
                  required
                  autoComplete="name"
                />
              </div>
            )}

            <div className="login-field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hospital.org"
                required
                autoComplete="email"
              />
            </div>

            <div className="login-field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Min 8 characters' : 'Enter your password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <span className="login-btn-loading">
                  <span className="login-spinner" />
                  {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                </span>
              ) : (
                mode === 'login' ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>

          <div className="login-switch">
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button onClick={switchMode}>Sign up</button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={switchMode}>Sign in</button>
              </>
            )}
          </div>

          <div className="login-divider">
            <span>or try instantly</span>
          </div>

          <div className="login-demo-buttons">
            {[
              { email: 'demo@atlasmd.live', password: 'demo1234', label: 'Demo User', icon: '👤' },
            ].map((demo) => (
              <button
                key={demo.email}
                className="login-demo-btn"
                disabled={loading}
                onClick={async () => {
                  setError('');
                  setLoading(true);
                  try {
                    const data = await login(demo.email, demo.password);
                    if (!data.token || !data.user) throw new Error('Login failed');
                    localStorage.setItem('atlas-token', data.token);
                    onAuth(data.user);
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <span className="login-demo-icon">{demo.icon}</span>
                <span className="login-demo-label">{demo.label}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="login-footer">AI-powered clinical research analysis</p>
      </div>
    </div>
  );
}
