import React, { useState, useEffect, useRef } from 'react';

interface LicenseInfo {
  name?: string;
  email?: string;
  product?: string;
  expires_at?: string;
  max_activations?: number;
  current_activations?: number;
}

interface LicenseGateProps {
  children: React.ReactNode;
}

// Fallback for web mode (non-Electron) - always pass
const isElectron = !!(window as any).electronAPI?.isElectron;

const LicenseGate: React.FC<LicenseGateProps> = ({ children }) => {
  const [isValidated, setIsValidated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // In web mode, skip license check
  useEffect(() => {
    if (!isElectron) {
      setIsValidated(true);
      setIsChecking(false);
      return;
    }

    // Check cached license
    const checkCached = async () => {
      try {
        const api = (window as any).electronAPI.license;
        const deviceIdResult = await api.getDeviceId();
        setDeviceId(deviceIdResult);
        
        const result = await api.checkCached();
        if (result.valid) {
          setLicenseInfo(result.license);
          setIsValidated(true);
        } else if (result.error) {
          setError(result.error);
        }
      } catch (err) {
        console.error('License check error:', err);
      } finally {
        setIsChecking(false);
      }
    };

    checkCached();

    // Listen for license revocation while app is running (periodic re-check)
    const api = (window as any).electronAPI.license;
    if (api.onRevoked) {
      api.onRevoked((reason: string) => {
        console.log('[LicenseGate] License revoked:', reason);
        setIsValidated(false);
        setIsChecking(false);
        setLicenseInfo(null);
        setLicenseKey('');
        setError(`⚠️ ${reason || 'License đã bị thu hồi. Vui lòng liên hệ hỗ trợ.'}`);
      });
    }
  }, []);

  const handleValidate = async () => {
    if (isBusy) return;
    
    const key = licenseKey.trim();
    if (!key) {
      setError('Vui lòng nhập License Key');
      return;
    }

    setIsBusy(true);
    setError('');

    try {
      const api = (window as any).electronAPI.license;
      const result = await api.validate(key);
      
      if (result.valid) {
        setLicenseInfo(result.license);
        setIsValidated(true);
      } else {
        setError(result.error || 'License không hợp lệ');
      }
    } catch (err: any) {
      setError(`Lỗi: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleValidate();
  };

  const copyDeviceId = () => {
    navigator.clipboard.writeText(deviceId);
  };

  // If validated, render the app
  if (isValidated) return <>{children}</>;

  // Loading state
  if (isChecking) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(145deg, #1a1a2e 0%, #0d0d1a 50%, #16213e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, sans-serif',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 72, height: 72, margin: '0 auto 24px',
            borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(90,90,64,0.3), rgba(139,125,96,0.2))',
            border: '1px solid rgba(90,90,64,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pulse 2s ease-in-out infinite',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8B7D60" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <p style={{ color: '#8B7D60', fontSize: 14, animation: 'pulse 2s ease-in-out infinite' }}>
            Đang kiểm tra License...
          </p>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      </div>
    );
  }

  // License input form
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(145deg, #1a1a2e 0%, #0d0d1a 50%, #16213e 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      fontFamily: '"Inter", -apple-system, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Card */}
        <div style={{
          position: 'relative',
          borderRadius: 24,
          overflow: 'hidden',
        }}>
          {/* Gradient border glow */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(135deg, rgba(90,90,64,0.25), transparent 50%, rgba(139,125,96,0.15))',
            borderRadius: 24,
          }} />
          
          <div style={{
            position: 'relative',
            padding: 36,
            background: 'rgba(14,14,24,0.95)',
            backdropFilter: 'blur(12px)',
            borderRadius: 24,
            border: '1px solid rgba(90,90,64,0.15)',
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{
                width: 72, height: 72, margin: '0 auto 16px',
                borderRadius: 20,
                background: 'linear-gradient(135deg, rgba(90,90,64,0.35), rgba(139,125,96,0.2))',
                border: '1px solid rgba(90,90,64,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#8B7D60" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h1 style={{
                fontSize: 26,
                fontWeight: 900,
                background: 'linear-gradient(135deg, #C4B896, #8B7D60, #A89B78)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                marginBottom: 6,
                letterSpacing: '-0.02em',
              }}>
                FlowAgent AI
              </h1>
              <p style={{
                fontSize: 11,
                color: '#666',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.15em',
                fontWeight: 500,
              }}>
                Kích hoạt License
              </p>
            </div>

            {/* Device ID */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontSize: 11, fontWeight: 700,
                color: '#8B7D60', marginBottom: 8,
                textTransform: 'uppercase' as const, letterSpacing: '0.1em',
              }}>
                Machine ID
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={deviceId}
                  readOnly
                  style={{
                    flex: 1,
                    background: '#0a0a14',
                    color: '#888',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(90,90,64,0.15)',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    outline: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                />
                <button
                  onClick={copyDeviceId}
                  style={{
                    padding: '10px 18px',
                    background: 'rgba(90,90,64,0.2)',
                    color: '#C4B896',
                    borderRadius: 12,
                    border: '1px solid rgba(90,90,64,0.2)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(90,90,64,0.35)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(90,90,64,0.2)')}
                >
                  Copy
                </button>
              </div>
            </div>

            {/* License Key Input */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontSize: 11, fontWeight: 700,
                color: '#8B7D60', marginBottom: 8,
                textTransform: 'uppercase' as const, letterSpacing: '0.1em',
              }}>
                License Key
              </label>
              <input
                ref={inputRef}
                type="text"
                value={licenseKey}
                onChange={(e) => { setLicenseKey(e.target.value); setError(''); }}
                onKeyDown={handleKeyDown}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoFocus
                style={{
                  width: '100%',
                  background: '#0a0a14',
                  color: '#e0e0e0',
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: '1px solid rgba(90,90,64,0.15)',
                  fontSize: 14,
                  fontFamily: 'monospace',
                  outline: 'none',
                  transition: 'all 0.2s',
                  boxSizing: 'border-box' as const,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(90,90,64,0.5)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(90,90,64,0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(90,90,64,0.15)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: '12px 16px',
                background: 'rgba(180,50,50,0.12)',
                border: '1px solid rgba(180,50,50,0.25)',
                borderRadius: 12,
                marginBottom: 20,
              }}>
                <p style={{ fontSize: 13, color: '#f08080', fontWeight: 500, margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleValidate}
              disabled={isBusy}
              style={{
                width: '100%',
                padding: '15px 20px',
                borderRadius: 14,
                border: 'none',
                fontWeight: 700,
                fontSize: 14,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s',
                background: isBusy
                  ? 'rgba(100,100,100,0.3)'
                  : 'linear-gradient(135deg, #5A5A40, #8B7D60)',
                color: isBusy ? '#666' : '#fff',
                boxShadow: isBusy ? 'none' : '0 8px 32px rgba(90,90,64,0.25)',
                letterSpacing: '0.02em',
              }}
              onMouseEnter={(e) => {
                if (!isBusy) {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #6B6B50, #9C8E70)';
                  e.currentTarget.style.boxShadow = '0 12px 40px rgba(90,90,64,0.35)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isBusy) {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #5A5A40, #8B7D60)';
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(90,90,64,0.25)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
            >
              {isBusy ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                    <path fill="currentColor" opacity="0.75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Đang xác thực...
                </span>
              ) : (
                'Xác nhận License'
              )}
            </button>

            {/* Footer */}
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <p style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
                Sản phẩm: <span style={{ color: '#8B7D60', fontWeight: 600 }}>FlowAgent AI</span>
              </p>
              <p style={{ fontSize: 12, color: '#555' }}>
                📞 Hỗ trợ: <span style={{ color: '#C4B896', fontWeight: 600 }}>Đường Thọ</span> — Zalo{' '}
                <a 
                  href="https://zalo.me/0934415387" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{
                    color: '#8B7D60',
                    fontWeight: 700,
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#C4B896')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#8B7D60')}
                >
                  0934415387
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        * { box-sizing: border-box; margin: 0; }
      `}</style>
    </div>
  );
};

export default LicenseGate;
