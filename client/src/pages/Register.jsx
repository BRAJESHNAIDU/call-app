import { Navigate } from 'react-router-dom';
import { SignUp } from '@clerk/react';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Navigate to="/" replace />;

  return (
    <div className="auth-wrap">
      <SignUp path="/register" signInUrl="/login" />
    </div>
  );
}
