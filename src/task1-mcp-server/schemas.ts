import { z } from "zod";

// CUST- followed by exactly five digits. Anchored so "xCUST-12345" or "CUST-123456" fail.
export const CustomerId = z.string().regex(/^CUST-\d{5}$/, "customer_id must match CUST-XXXXX (five digits)");

export const GetCustomerRecordInput = z.strictObject({
  customer_id: CustomerId,
});

export const TriggerRefundInput = z.strictObject({
  customer_id: CustomerId,
  // JSON has no float type; any finite positive number is accepted. No string coercion.
  // finite() rejects 1e999, which JSON.parse turns into Infinity.
  amount: z.number().positive("amount must be greater than 0").finite("amount must be finite"),
  // Trim first so ten spaces do not count as a reason. Upper bound caps payload size.
  reason: z.string().trim().min(10, "reason must be at least 10 characters").max(1000, "reason must be at most 1000 characters"),
});

export const TOOLS = {
  get_customer_record: {
    description: "Fetch a customer record by id (format CUST-XXXXX).",
    schema: GetCustomerRecordInput,
  },
  trigger_refund: {
    description: "Issue a refund to a customer. amount must be positive; reason needs at least 10 characters.",
    schema: TriggerRefundInput,
  },
} as const;

export type ToolName = keyof typeof TOOLS;

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

/** Flattens Zod issues into a stable shape for JSON-RPC error.data. */
export function issuesOf(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
}
