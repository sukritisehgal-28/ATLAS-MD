import { useState, useEffect } from 'react';

const API_KEY_FIELDS = [
  { key: 'gemini', label: 'Gemini API Key', placeholder: 'AIza...', desc: 'Powers the AI agent and research analysis' },
  { key: 'claude', label: 'Claude API Key', placeholder: 'sk-ant-...', desc: 'Enhanced paper analysis (optional)' },
  { key: 'semanticScholar', label: 'Semantic Scholar API Key', placeholder: 'Optional — increases rate limits', desc: 'Paper search engine' },
];

function loadKeys() {
  try {
    return JSON.parse(localStorage.getItem('atlas-api-keys') || '{}');
  } catch { return {}; }
}

function saveKeys(keys) {
  localStorage.setItem('atlas-api-keys', JSON.stringify(keys));
}

export default function SettingsPage({ user, onClose, onLogout, onDeleteAccount, theme, onToggleTheme }) {
  const [keys, setKeys] = useState(loadKeys);
  const [showKeys, setShowKeys] = useState({});
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleSaveKeys = () => {
    saveKeys(keys);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setDeleteLoading(true);
    try {
      await onDeleteAccount();
    } catch {
      setDeleteLoading(false);
      setDeleteConfirm(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            SETTINGS
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-body">
          {/* Profile Section */}
          <div className="settings-section">
            <div className="settings-section-title">Profile</div>
            <div className="settings-profile">
              <div className="settings-avatar">{user.name.charAt(0).toUpperCase()}</div>
              <div>
                <div className="settings-user-name">{user.name}</div>
                <div className="settings-user-email">{user.email}</div>
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Theme</div>
                <div className="settings-row-desc">Switch between dark and light mode</div>
              </div>
              <button className="theme-toggle" onClick={onToggleTheme}>
                <div className={`theme-toggle-track ${theme === 'light' ? 'light' : ''}`}>
                  <div className="theme-toggle-thumb">
                    {theme === 'dark' ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="2"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="2"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="2"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="2"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2"/></svg>
                    )}
                  </div>
                </div>
                <span className="theme-toggle-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
              </button>
            </div>
          </div>

          {/* API Keys */}
          <div className="settings-section">
            <div className="settings-section-title">API Keys</div>
            <div className="settings-section-desc">Configure your own API keys. These are stored locally in your browser and never sent to our servers.</div>
            {API_KEY_FIELDS.map((field) => (
              <div key={field.key} className="settings-key-field">
                <label className="settings-key-label">{field.label}</label>
                <div className="settings-key-desc">{field.desc}</div>
                <div className="settings-key-input-wrap">
                  <input
                    type={showKeys[field.key] ? 'text' : 'password'}
                    value={keys[field.key] || ''}
                    onChange={(e) => setKeys((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="settings-key-input"
                    autoComplete="off"
                  />
                  <button
                    className="settings-key-toggle"
                    onClick={() => setShowKeys((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                    title={showKeys[field.key] ? 'Hide' : 'Show'}
                  >
                    {showKeys[field.key] ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
            ))}
            <button className="btn btn-primary settings-save-btn" onClick={handleSaveKeys}>
              {saved ? 'Saved!' : 'Save API Keys'}
            </button>
          </div>

          {/* Account Actions */}
          <div className="settings-section">
            <div className="settings-section-title">Account</div>
            <div className="settings-actions">
              <button className="btn settings-signout-btn" onClick={onLogout}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign Out
              </button>
              <button
                className={`btn settings-delete-btn ${deleteConfirm ? 'confirm' : ''}`}
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
              >
                {deleteLoading ? (
                  <span className="login-btn-loading"><div className="login-spinner" /> Deleting...</span>
                ) : deleteConfirm ? (
                  'Click again to confirm deletion'
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Delete Account
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
