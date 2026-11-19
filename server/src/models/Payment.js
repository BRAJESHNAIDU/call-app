import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: String, required: true, unique: true }, // Razorpay order id
    paymentId: String, // Razorpay payment id, set once paid
    packId: { type: String, required: true },
    credits: { type: Number, required: true },
    amount: { type: Number, required: true }, // smallest currency unit
    currency: { type: String, required: true },
    status: { type: String, enum: ['created', 'paid'], default: 'created' },
    paidAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('Payment', paymentSchema);
