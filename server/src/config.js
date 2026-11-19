// Billing configuration. Edit the packs below to change what you sell.
// Amounts are in the smallest currency unit (paise for INR): 10000 = ₹100.

export const CURRENCY = 'INR';

export const PACKS = [
  { id: 'starter', label: 'Starter', credits: 20, amount: 10000 }, // ₹100
  { id: 'plus', label: 'Plus', credits: 60, amount: 25000 }, // ₹250
  { id: 'pro', label: 'Pro', credits: 150, amount: 50000 }, // ₹500
];

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Credits each person in a call spends per minute. Billed in advance, one minute at a time.
export const COST_PER_MINUTE = {
  video: Math.max(1, int(process.env.COST_VIDEO, 1)),
};

// Free credits given to a new account (0 = none).
export const SIGNUP_CREDITS = int(process.env.SIGNUP_CREDITS, 30);
