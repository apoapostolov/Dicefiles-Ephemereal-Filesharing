"use strict";

const { z } = require("zod");

const fields = z.object({
  label: z.string().trim().min(1).max(80),
  mode: z.enum(["cohort", "personal"]),
  binding: z.enum(["account", "browser"]).optional(),
  accountId: z.string().max(128).optional(),
  rotation: z.enum(["monthly", "fixed-days", "manual"]).optional(),
  days: z.number().int().min(1).max(365).optional(),
  expiresAt: z.number().int().positive().optional(),
  maxActivations: z.number().int().min(0).max(1000).optional(),
  password: z.string().min(12).max(256).optional(),
  state: z.enum(["active", "suspended", "revoked"]).optional(),
  rotate: z.boolean().optional(),
}).strict();

function credentialInput(value, { create = false } = {}) {
  const result = (create ? fields : fields.partial()).safeParse(value);
  if (!result.success) {
    throw Object.assign(new Error("Invalid credential fields"), { status: 400 });
  }
  return result.data;
}

module.exports = { credentialInput };
