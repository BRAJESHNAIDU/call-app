import { Navigate } from 'react-router-dom';
import { SignIn } from '@clerk/react';
import { useAuth } from '../context/AuthContext';

// Clerk renders the whole sign-in form (email, password, Google, etc. as configured
// in the Clerk dashboard).
export default function Login() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Navigate to="/" replace />;

  return (
    <div className="auth-wrap">
      <SignIn path="/login" signUpUrl="/register" />
    </div>
  );
}
