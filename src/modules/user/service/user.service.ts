import { NotFoundError } from "../../../core/errors/NotFoundError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import {
  ensureNoDuplicateUser,
  findUserById,
  updateUserProfile,
} from "../repository/user.repository.js";

export async function getMe(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found");

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    countryCode: user.countryCode,
    currencyCode: user.currencyCode,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function updateMyProfile(
  userId: string,
  input: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
    countryCode?: string;
    preferredCurrency?: string | null;
  },
) {
  // Basic validation
  if (input.email !== undefined && input.email !== null) {
    const email = String(input.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError("Invalid email address");
    }
  }
  if (input.phone !== undefined && input.phone !== null) {
    const phone = String(input.phone).trim();
    if (phone && !/^\+?\d{7,15}$/.test(phone)) {
      throw new ValidationError("Invalid phone number");
    }
  }

  // Duplicate check for email/phone if provided
  if (
    (input.email && input.email.trim()) ||
    (input.phone && input.phone.trim())
  ) {
    const dupInput: { email?: string; phone?: string } = {};
    const emailTrim = input.email?.trim();
    const phoneTrim = input.phone?.trim();
    if (emailTrim) dupInput.email = emailTrim;
    if (phoneTrim) dupInput.phone = phoneTrim;
    const dup = await ensureNoDuplicateUser(dupInput);
    if (dup && dup.id !== userId) {
      throw new ValidationError("Email or phone already in use");
    }
  }

  await updateUserProfile(userId, input);
  return getMe(userId);
}
