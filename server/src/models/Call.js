import mongoose from 'mongoose';

const callSchema = new mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    callee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['audio', 'video'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'active', 'completed', 'missed', 'rejected', 'busy', 'failed'],
      default: 'ringing',
    },
    answeredAt: Date,
    endedAt: Date,
    duration: { type: Number, default: 0 }, // seconds
    creditsCharged: { type: Number, default: 0 }, // paid by the caller
  },
  { timestamps: true }
);

callSchema.index({ createdAt: -1 });

export default mongoose.model('Call', callSchema);
