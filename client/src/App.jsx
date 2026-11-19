import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { BillingProvider } from './context/BillingContext';
import { SocketProvider } from './context/SocketContext';
import { CallProvider } from './context/CallContext';
import ProtectedLayout from './components/ProtectedLayout';
import CallUI from './components/CallUI';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import History from './pages/History';
import Credits from './pages/Credits';

export default function App() {
  return (
    <AuthProvider>
      <BillingProvider>
      <SocketProvider>
        <CallProvider>
          <Routes>
            {/* "/*" lets Clerk use sub-paths like /login/factor-one for multi-step sign-in */}
            <Route path="/login/*" element={<Login />} />
            <Route path="/register/*" element={<Register />} />
            <Route element={<ProtectedLayout />}>
              <Route index element={<Home />} />
              <Route path="history" element={<History />} />
              <Route path="credits" element={<Credits />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <CallUI />
        </CallProvider>
      </SocketProvider>
      </BillingProvider>
    </AuthProvider>
  );
}
