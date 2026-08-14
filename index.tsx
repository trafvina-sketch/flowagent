
import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import axios from 'axios';
import App from './App';
import i18n from './src/i18n';
import LicenseGate from './components/LicenseGate';

// In Electron production mode (file:// protocol), set axios baseURL
// so all API calls ("/api/...") correctly reach the backend at port 8100
if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
  axios.defaults.baseURL = 'http://127.0.0.1:8100';
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LicenseGate>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </LicenseGate>
  </React.StrictMode>
);
