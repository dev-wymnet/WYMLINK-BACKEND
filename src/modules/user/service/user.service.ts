import { NotFoundError } from "../../../core/errors/NotFoundError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { normalizeEmail, normalizePhone } from "../../../core/utils/identity.js";
import { getLimitsForUser } from "../../compliance/service/limits.service.js";
import {
  findContactConflict,
  findUserById,
  toUserDto,
  updateUserProfile,
} from "../repository/user.repository.js";

export async function getMe(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found");
  return { ...toUserDto(user), limits: await getLimitsForUser(userId) };
}

// Self-service edits are deliberately narrow, so a stolen session can't
// redirect the account's recovery channel:
//   * names: only before KYC verification (afterwards they must match the BVN/NIN)
//   * email / phone: only adding one that is missing, never replacing
// Everything else goes through an account update request reviewed by staff.
export async function updateMyProfile(
  userId: string,
  input: {
    firstName?: string | undefined;
    lastName?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
  },
) {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found");

  const changingName =
    (input.firstName !== undefined && input.firstName.trim() !== user.firstName) ||
    (input.lastName !== undefined && input.lastName.trim() !== user.lastName);
  if (changingName && user.kycTier > 0) {
    throw new ValidationError("Your name is locked to your verified identity. Send an account update request to change it.");
  }

  const email = input.email ? normalizeEmail(input.email) : undefined;
  const phone = input.phone ? normalizePhone(input.phone) : undefined;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Invalid email address");
  if (email && user.email && email !== user.email) {
    throw new ValidationError("To change your email, send an account update request.");
  }
  if (phone && user.phone && phone !== user.phone) {
    throw new ValidationError("To change your phone number, send an account update request.");
  }
  if ((email && !user.email) || (phone && !user.phone)) {
    const conflict = await findContactConflict({
      email: user.email ? undefined : email,
      phone: user.phone ? undefined : phone,
      exceptUserId: userId,
    });
    if (conflict) throw new ValidationError("That email or phone number is already in use");
  }

  await updateUserProfile(userId, {
    firstName: input.firstName,
    lastName: input.lastName,
    email: user.email ? undefined : email,
    phone: user.phone ? undefined : phone,
  });
  return getMe(userId);
}
