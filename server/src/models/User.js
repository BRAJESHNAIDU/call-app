import mongoose from 'mongoose';

// Sign-in is handled by Clerk. This document is the app's own record of a person:
// it holds their credits and is what calls and payments point at.
const userSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: { type: String, lowercase: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    lastSeen: { type: Date, default: Date.now },
    credits: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Shape returned to the signed-in user about themselves.
userSchema.methods.toSelf = function toSelf() {
  return {
    id: this._id.toString(),
    name: this.name,
    username: this.username ?? null,
    email: this.email ?? null,
    credits: this.credits ?? 0,
  };
};

export default mongoose.model('User', userSchema);
