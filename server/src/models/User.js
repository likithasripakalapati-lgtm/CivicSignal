import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
  },
  passwordHash: { type: String, required: true, select: false },
  languagePreference: { type: String, enum: ['en-IN', 'te-IN'], default: 'en-IN', required: true },
  selectedAreaIds: { type: [String], default: [] },
  notificationCategories: {
    type: [String],
    enum: ['notices', 'events', 'revisions'],
    default: ['notices', 'revisions'],
  },
}, { timestamps: true, versionKey: false });

userSchema.set('toJSON', {
  transform(_document, returned) {
    delete returned.passwordHash;
    return returned;
  },
});

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
