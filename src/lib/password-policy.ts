import { z } from "zod";

export const newPasswordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Too long")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/\d/, "Include at least one number");

/** password + confirmPassword fields that must match. */
export const passwordPairSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

export const collegeIdSchema = z
  .string()
  .trim()
  .min(3, "At least 3 characters")
  .max(32)
  .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only")
  .transform((s) => s.toUpperCase());

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email"))
  .optional();

export const optionalPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
  .optional();
