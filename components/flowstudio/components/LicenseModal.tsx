import React, { useState, useRef, useEffect } from 'react';
import { useLicense } from '../hooks/useLicense';

const LicenseModal: React.FC<{ onActivated: () => void }> = ({ onActivated }) => {
  const { isLicensed, isValidating, error, validate } = useLicense();
  const [key, setKey] = useState('');
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isLicensed) onActivated();
  }, [isLicensed, onActivated]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const formatKey = (val: string) => {
    const clean = val.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    let formatted = '';
    for (let i = 0; i < clean.length && i < 16; i++) {
      if (i > 0 && i % 4 === 0) formatted += '-';
      formatted += clean[i];
    }
    return formatted;
  };

  const handleSubmit = async () => {
    if (!key || key.length < 19) return;
    const result = await validate(key);
    if (result.valid) {
      setSuccess(true);
      setTimeout(() => onActivated(), 1200);
    }
  };

  if (isLicensed) return null;

  // All styles inline for self-contained component
  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)',
    backdropFilter: 'blur(20px)', zIndex: 10000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20, fontFamily: "'Inter', 'Segoe UI', sans-serif",
  };

  const cardStyle: React.CSSProperties = {
    width: '100%', maxWidth: 440,
    background: 'linear-gradient(180deg, rgba(30,30,40,0.98) 0%, rgba(15,15,25,0.99) 100%)',
    border: '1px solid rgba(0,210,255,0.2)',
    borderRadius: 24, padding: '44px 40px',
    boxShadow: '0 0 80px rgba(0,210,255,0.08), 0 30px 60px rgba(0,0,0,0.6)',
    animation: 'licenseIn 0.45s ease-out',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '2rem', fontWeight: 800, textAlign: 'center', margin: 0,
    background: 'linear-gradient(135deg, #00d2ff, #ff6b9d)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  };

  const subtitleStyle: React.CSSProperties = {
    color: '#888', fontSize: '0.95rem', textAlign: 'center', margin: '12px 0 32px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '16px 20px',
    background: 'rgba(0,0,0,0.5)', border: '2px solid rgba(255,255,255,0.1)',
    borderRadius: 14, color: '#fff', fontSize: '1.15rem',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    letterSpacing: 3, textAlign: 'center', textTransform: 'uppercase',
    outline: 'none', transition: 'all 0.3s', boxSizing: 'border-box',
  };

  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '16px 24px', border: 'none', borderRadius: 14,
    background: 'linear-gradient(135deg, #00d2ff 0%, #7c3aed 50%, #ff6b9d 100%)',
    color: '#fff', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer',
    marginTop: 20, fontFamily: 'inherit', transition: 'all 0.3s',
    boxShadow: '0 4px 24px rgba(0,210,255,0.25)',
    opacity: isValidating ? 0.6 : 1,
  };

  const errorStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '14px 20px', background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12,
    color: '#ef4444', fontSize: '0.9rem', marginTop: 16,
  };

  const successStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '14px 20px', background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12,
    color: '#22c55e', fontSize: '0.9rem', marginTop: 16,
  };

  const footerStyle: React.CSSProperties = {
    marginTop: 28, textAlign: 'center', paddingTop: 20,
    borderTop: '1px solid rgba(255,255,255,0.08)',
  };

  return (
    <>
      <style>{`
        @keyframes licenseIn {
          from { opacity: 0; transform: translateY(-30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes licenseSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={overlayStyle}>
        <div style={cardStyle}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🎬</div>
            <h1 style={titleStyle}>FlowAgent Studio</h1>
            <p style={subtitleStyle}>Nhập mã license để kích hoạt phần mềm</p>
          </div>

          {/* Input */}
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#aaa', display: 'block', marginBottom: 8 }}>
              🔑 Mã License
            </label>
            <input
              ref={inputRef}
              type="text"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={key}
              onChange={e => setKey(formatKey(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={inputStyle}
              onFocus={e => {
                e.target.style.borderColor = '#00d2ff';
                e.target.style.boxShadow = '0 0 0 4px rgba(0,210,255,0.15)';
              }}
              onBlur={e => {
                e.target.style.borderColor = 'rgba(255,255,255,0.1)';
                e.target.style.boxShadow = 'none';
              }}
            />
            <p style={{ fontSize: '0.8rem', color: '#666', textAlign: 'center', margin: '8px 0 0' }}>
              Nhập 16 ký tự — tự động định dạng XXXX-XXXX-XXXX-XXXX
            </p>
          </div>

          {/* Error */}
          {error && !success && (
            <div style={errorStyle}>
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Success */}
          {success && (
            <div style={successStyle}>
              <span>✅</span>
              <span>Kích hoạt thành công! Đang mở ứng dụng...</span>
            </div>
          )}

          {/* Button */}
          <button
            onClick={handleSubmit}
            disabled={isValidating || key.length < 19}
            style={btnStyle}
          >
            {isValidating ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{
                  width: 20, height: 20, border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'licenseSpin 1s linear infinite', display: 'inline-block',
                }} />
                Đang xác thực...
              </span>
            ) : (
              '🚀 Kích hoạt'
            )}
          </button>

          {/* Footer */}
          <div style={footerStyle}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>
              Chưa có mã?{' '}
              <a href="https://zalo.me/0934415387" target="_blank" rel="noopener noreferrer"
                style={{ color: '#00d2ff', textDecoration: 'none', fontWeight: 600 }}>
                Mua license
              </a>
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#555' }}>
              Hỗ trợ Zalo Đường Thọ: <strong style={{ color: '#ff6b9d' }}>0934415387</strong>
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default LicenseModal;
