import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { ClerkProvider } from '@clerk/react';
import App from './App.jsx';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Match Clerk's sign-in/sign-up widgets to the app's dark theme.
const appearance = {
  variables: {
    colorPrimary: '#4da3ff',
    colorBackground: '#151b23',
    colorText: '#e8edf3',
    colorForeground: '#e8edf3',
    colorTextSecondary: '#8b98a9',
    colorMutedForeground: '#8b98a9',
    colorInputBackground: '#0d1117',
    colorInputText: '#e8edf3',
    colorInput: '#0d1117',
    colorInputForeground: '#e8edf3',
    colorTextOnPrimaryBackground: '#06182e',
    colorPrimaryForeground: '#06182e',
    borderRadius: '10px',
  },
};

function Root() {
  const navigate = useNavigate();

  if (!PUBLISHABLE_KEY) {
    return (
      <div className="splash" style={{ padding: 24, textAlign: 'center' }}>
        <div>
          <h2>Clerk is not set up yet</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to <code>client/.env</code> and restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/login"
      signUpUrl="/register"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/login"
      appearance={appearance}
    >
      <App />
    </ClerkProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>
);
