import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';

const BillingContext = createContext(null);
export const useBilling = () => useContext(BillingContext);

const DEFAULT_COSTS = { video: 2 };

// Packs, call prices and the checkout key. The server enforces all of this;
// the client only uses it to disable buttons and show prices.
export function BillingProvider({ children }) {
  const { isSignedIn, user } = useAuth();
  const [config, setConfig] = useState(null);

  useEffect(() => {
    if (!isSignedIn) {
      setConfig(null);
      return undefined;
    }
    let cancelled = false;
    api('/api/payments/config')
      .then((data) => !cancelled && setConfig(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const costs = config?.costs ?? DEFAULT_COSTS;
  const credits = user?.credits ?? 0;
  const canAfford = useCallback(() => credits >= costs.video, [credits, costs]);

  const value = useMemo(
    () => ({ config, costs, credits, canAfford }),
    [config, costs, credits, canAfford]
  );
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
