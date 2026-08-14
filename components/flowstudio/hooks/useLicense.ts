import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';

const DEV_MODE = false; // Set true to bypass license check during development

const LICENSE_CONFIG = {
  validateUrl: '/api/license/validate',
  checkStatusUrl: '/api/license/check-status',
  deactivateUrl: '/api/license/deactivate',
  localGetUrl: '/api/license/local',
  localClearUrl: '/api/license/local/clear',
  productName: 'Flowagent',
  deviceIdKey: 'flowagent_device_id',
  // Re-check online every 7 days, but license stays valid offline
  recheckDays: 7,
};

function getDeviceId(): string {
  let deviceId = localStorage.getItem(LICENSE_CONFIG.deviceIdKey);
  if (!deviceId) {
    deviceId = 'FA-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(LICENSE_CONFIG.deviceIdKey, deviceId);
  }
  return deviceId;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Linux')) return 'Linux PC';
  return 'Unknown Device';
}

interface LicenseData {
  valid: boolean;
  status?: string;
  error?: string;
  license?: {
    name?: string;
    email?: string;
    product?: string;
    max_activations?: number;
    current_activations?: number;
    expires_at?: string;
    created_at?: string;
  };
}

export function useLicense() {
  const [isLicensed, setIsLicensed] = useState<boolean | null>(null); // null = loading
  const [licenseInfo, setLicenseInfo] = useState<LicenseData | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check saved license on mount — reads from file via backend
  useEffect(() => {
    if (DEV_MODE) {
      console.log('🔓 DEV_MODE enabled - License check bypassed');
      setIsLicensed(true);
      return;
    }

    const checkLocal = async () => {
      try {
        const res = await axios.get(LICENSE_CONFIG.localGetUrl);
        const data = res.data;

        if (data.success && data.license?.valid) {
          // License found in local file!
          setIsLicensed(true);
          setLicenseInfo(data.license);

          // Background re-check if older than recheckDays
          const savedAt = data.timestamp || 0;
          const daysSince = (Date.now() / 1000 - savedAt) / 86400;
          if (daysSince > LICENSE_CONFIG.recheckDays && data.license_key) {
            // Silent re-validate
            try {
              const recheck = await axios.post(LICENSE_CONFIG.validateUrl, {
                license_key: data.license_key,
                device_id: getDeviceId(),
                device_name: getDeviceName() + ' - FlowAgent Studio',
              });
              if (recheck.data?.valid === false) {
                // License revoked/expired online
                setIsLicensed(false);
                setLicenseInfo(null);
                setError(recheck.data.error || 'License đã bị vô hiệu hóa');
              }
              // If valid, backend auto-saves updated timestamp
            } catch {
              // Offline — keep local license valid
              console.log('[License] Offline — using cached license');
            }
          }
        } else {
          setIsLicensed(false);
        }
      } catch {
        // Backend not ready yet — retry after 2s
        setTimeout(async () => {
          try {
            const retry = await axios.get(LICENSE_CONFIG.localGetUrl);
            if (retry.data.success && retry.data.license?.valid) {
              setIsLicensed(true);
              setLicenseInfo(retry.data.license);
            } else {
              setIsLicensed(false);
            }
          } catch {
            setIsLicensed(false);
          }
        }, 2000);
      }
    };

    checkLocal();
  }, []);

  const validate = useCallback(async (licenseKey: string): Promise<LicenseData> => {
    setIsValidating(true);
    setError(null);
    try {
      const res = await axios.post(LICENSE_CONFIG.validateUrl, {
        license_key: licenseKey,
        device_id: getDeviceId(),
        device_name: getDeviceName() + ' - FlowAgent Studio',
      });
      let data: LicenseData = res.data;

      // Auto-retry: if device already activated with another license, reset device_id and retry
      if (!data.valid && data.error && (
        data.error.toLowerCase().includes('already activated') ||
        data.error.toLowerCase().includes('device is already')
      )) {
        console.log('[License] Device already activated with another key — resetting device_id and retrying...');
        // Generate new device_id
        const newDeviceId = 'FA-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(LICENSE_CONFIG.deviceIdKey, newDeviceId);
        // Retry with new device_id
        const retryRes = await axios.post(LICENSE_CONFIG.validateUrl, {
          license_key: licenseKey,
          device_id: newDeviceId,
          device_name: getDeviceName() + ' - FlowAgent Studio',
        });
        data = retryRes.data;
      }

      if (data.valid) {
        // Backend auto-saves to license.json
        setIsLicensed(true);
        setLicenseInfo(data);
      } else {
        let errorMsg = data.error || 'License không hợp lệ';
        if (data.status === 'expired') errorMsg = '⏰ License đã hết hạn';
        else if (data.status === 'revoked') errorMsg = '🚫 License đã bị thu hồi';
        else if (data.error?.includes('Activation limit')) errorMsg = '📱 Đã đạt giới hạn số thiết bị kích hoạt';
        else if (data.error?.includes('not found')) errorMsg = '❌ Mã license không tồn tại';
        setError(errorMsg);
      }
      return data;
    } catch (err: any) {
      const errMsg = 'Không thể kết nối server. Kiểm tra kết nối mạng.';
      setError(errMsg);
      return { valid: false, error: errMsg };
    } finally {
      setIsValidating(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await axios.post(LICENSE_CONFIG.localClearUrl);
    } catch {}
    setIsLicensed(false);
    setLicenseInfo(null);
  }, []);

  return { isLicensed, licenseInfo, isValidating, error, validate, logout, devMode: DEV_MODE };
}
