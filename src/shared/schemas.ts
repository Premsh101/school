import { z } from 'zod';
import { IMPORT_CHUNK } from './csv';
import { isValidDate } from './dates';
import { ROLES } from './permissions';

const text = (max: number) => z.string().trim().max(max);
const id = z.coerce.number().int().positive();
const date = z.string().refine(isValidDate, 'Enter a real date');
const optionalDate = z
  .union([date, z.literal(''), z.null()])
  .optional()
  .transform((v) => v || null);
const phone = z
  .string()
  .trim()
  .regex(/^[0-9+ -]{0,15}$/, 'Phone can only have digits');
const password = z.string().min(8, 'Password must be at least 8 characters').max(100);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'Username must be 3 to 30 letters, numbers, dot, dash');

export const branchInput = z.object({
  name: text(80).min(1, 'Enter the branch name'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, 'Short code must be 2 to 6 letters or numbers'),
  address: text(200).default(''),
  phone: phone.default(''),
  active: z.boolean().default(true),
});

export const setupInput = z.object({
  school_name: text(100).min(1, 'Enter the school name'),
  owner_name: text(80).min(1, 'Enter your name'),
  username,
  password,
  branch: branchInput,
  session_start_year: z.number().int().min(2000).max(2100),
});

/** Setup when the school, branches and fees are already loaded: only the owner's login is asked for. */
export const ownerSetupInput = z.object({
  owner_name: text(80).min(1, 'Enter your name'),
  username,
  password,
});

export const loginInput = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const passwordChangeInput = z.object({
  current_password: z.string().min(1),
  new_password: password,
});

export const userInput = z.object({
  username,
  name: text(80).min(1, 'Enter the name'),
  role: z.enum(ROLES),
  branch_ids: z.array(id).default([]),
  active: z.boolean().default(true),
  /** Required when creating; when editing, leave empty to keep the current password. */
  password: z.union([password, z.literal('')]).optional(),
});

export const sessionInput = z.object({
  start_year: z.number().int().min(2000).max(2100),
  start_month: z.number().int().min(1).max(12).default(4),
});

export const sectionInput = z.object({
  branch_id: id,
  class_id: id,
  name: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9 ]{1,10}$/, 'Section name can have letters and numbers only'),
});

export const subjectInput = z.object({
  name: text(60).min(1, 'Enter the subject name'),
  code: text(10).default(''),
  active: z.boolean().default(true),
});

export const GENDERS = ['male', 'female', 'other'] as const;

export const studentPersonInput = z.object({
  admission_no: text(20).default(''), // empty → the server gives the next number
  name: text(80).min(1, "Enter the student's name"),
  father_name: text(80).default(''),
  mother_name: text(80).default(''),
  phone: phone.default(''),
  phone2: phone.default(''),
  address: text(200).default(''),
  dob: optionalDate,
  gender: z.union([z.enum(GENDERS), z.literal('')]).default(''),
});

export const enrolmentPlaceInput = z.object({
  branch_id: id,
  class_id: id,
  section_id: id,
  roll_no: z
    .union([z.number().int().min(1).max(9999), z.null()])
    .optional()
    .transform((v) => v ?? null),
  admission_type: z.enum(['new', 'old']).default('new'),
});

export const studentCreateInput = studentPersonInput.extend({
  session_id: id,
  enrolment: enrolmentPlaceInput,
});

export const enrolmentUpdateInput = enrolmentPlaceInput.extend({
  status: z.enum(['studying', 'left']).default('studying'),
  left_date: optionalDate,
  result: z.union([z.enum(['pass', 'fail']), z.null()]).optional(),
});

export const enrolmentCreateInput = enrolmentPlaceInput.extend({ session_id: id });

export const staffInput = z.object({
  name: text(80).min(1, 'Enter the name'),
  phone: phone.default(''),
  designation: text(60).default(''),
  branch_id: id,
  joining_date: optionalDate,
  is_teaching: z.boolean().default(true),
  user_id: z
    .union([id, z.null()])
    .optional()
    .transform((v) => v ?? null),
  active: z.boolean().default(true),
});

export const settingsInput = z.object({
  school_name: text(100).min(1, 'Enter the school name').optional(),
  school_address: text(200).optional(),
  /** Small image as a data URL, or '' to remove. */
  logo: z
    .string()
    .max(90_000, 'Logo is too large. Use a smaller picture.')
    .refine(
      (v) => v === '' || /^data:image\/(png|jpeg|webp);base64,/.test(v),
      'Logo must be a picture',
    )
    .optional(),
  modules: z.record(z.string(), z.boolean()).optional(),
});

/** One row of the student import, after the browser has read the CSV or Excel file. */
export const importRowInput = z.object({
  line: z.number().int(), // row number in the file, for error messages
  admission_no: z.string().trim().max(20).default(''),
  name: z.string().trim().max(80).default(''),
  father_name: z.string().trim().max(80).default(''),
  mother_name: z.string().trim().max(80).default(''),
  phone: z.string().trim().max(20).default(''),
  phone2: z.string().trim().max(20).default(''),
  address: z.string().trim().max(200).default(''),
  dob: z.string().trim().max(20).default(''),
  gender: z.string().trim().max(10).default(''),
  class: z.string().trim().max(20).default(''),
  section: z.string().trim().max(10).default(''),
  roll_no: z.string().trim().max(6).default(''),
  admission_type: z.string().trim().max(10).default(''),
});
export const importInput = z.object({
  branch_id: id,
  session_id: id,
  rows: z.array(importRowInput).min(1).max(IMPORT_CHUNK),
  /** Highest numeric admission number anywhere in the file, so automatic numbers start after it. */
  auto_after: z.number().int().min(0).max(1_000_000_000).default(0),
});

export const PROMOTION_OUTCOMES = ['pass', 'fail', 'left'] as const;
export const promotionInput = z.object({
  from_session_id: id,
  to_session_id: id,
  branch_id: id,
  class_id: id,
  outcomes: z
    .array(z.object({ enrolment_id: id, outcome: z.enum(PROMOTION_OUTCOMES) }))
    .min(1)
    .max(300),
});

export type BranchInput = z.infer<typeof branchInput>;
export type SetupInput = z.infer<typeof setupInput>;
export type OwnerSetupInput = z.infer<typeof ownerSetupInput>;
export type UserInput = z.infer<typeof userInput>;
export type StudentCreateInput = z.infer<typeof studentCreateInput>;
export type StudentPersonInput = z.infer<typeof studentPersonInput>;
export type EnrolmentUpdateInput = z.infer<typeof enrolmentUpdateInput>;
export type StaffInput = z.infer<typeof staffInput>;
export type ImportRowInput = z.infer<typeof importRowInput>;
export type PromotionInput = z.infer<typeof promotionInput>;
