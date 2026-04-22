// ── BIN-646 (PR-B4): payment-request (deposit/withdraw-kø) ─────────────────

import { z } from "zod";
import { IsoDateString } from "./_shared.js";

export const PaymentRequestKindSchema = z.enum(["deposit", "withdraw"]);
export const PaymentRequestStatusSchema = z.enum(["PENDING", "ACCEPTED", "REJECTED"]);
export const PaymentRequestDestinationTypeSchema = z.enum(["bank", "hall"]);

export const PaymentRequestSchema = z.object({
  id: z.string(),
  kind: PaymentRequestKindSchema,
  userId: z.string(),
  walletId: z.string(),
  amountCents: z.number().int(),
  hallId: z.string().nullable(),
  submittedBy: z.string().nullable(),
  status: PaymentRequestStatusSchema,
  rejectionReason: z.string().nullable(),
  acceptedBy: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  rejectedBy: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  walletTransactionId: z.string().nullable(),
  destinationType: PaymentRequestDestinationTypeSchema.nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});

export type PaymentRequestKindT = z.infer<typeof PaymentRequestKindSchema>;
export type PaymentRequestStatusT = z.infer<typeof PaymentRequestStatusSchema>;
export type PaymentRequestDestinationTypeT = z.infer<typeof PaymentRequestDestinationTypeSchema>;
export type PaymentRequestT = z.infer<typeof PaymentRequestSchema>;
