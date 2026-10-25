import { eq, or, desc } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { trainingRegistrations } from "../../../core/db/schema.js";

export interface TrainingRegistrationInput {
  fullName: string;
  email: string;
  phone: string;
}

export async function createTrainingRegistration(input: TrainingRegistrationInput) {
  const rows = await db
    .insert(trainingRegistrations)
    .values({
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
    })
    .returning();

  return rows[0]!;
}

export async function findTrainingRegistrationByEmailOrPhone(input: {
  email?: string;
  phone?: string;
}) {
  const conditions = [] as Array<ReturnType<typeof eq>>;
  if (input.email) conditions.push(eq(trainingRegistrations.email, input.email.toLowerCase()));
  if (input.phone) conditions.push(eq(trainingRegistrations.phone, input.phone));

  if (conditions.length === 0) return null;

  const whereClause = conditions.length === 1 ? conditions[0] : or(...conditions);
  const rows = await db
    .select()
    .from(trainingRegistrations)
    .where(whereClause)
    .limit(1);

  return rows[0] ?? null;
}

export async function listTrainingRegistrations() {
  const rows = await db
    .select()
    .from(trainingRegistrations)
    .orderBy(desc(trainingRegistrations.createdAt));

  return rows;
}
