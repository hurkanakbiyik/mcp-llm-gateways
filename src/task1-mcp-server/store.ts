// In-memory customer store. Stands in for a real CRM/billing backend.
export interface Customer {
  customer_id: string;
  name: string;
  email: string;
  tier: "standard" | "gold";
  balance: number;
}

export interface Refund {
  refund_id: string;
  customer_id: string;
  amount: number;
  reason: string;
  created_at: string;
}

const customers = new Map<string, Customer>([
  ["CUST-10001", { customer_id: "CUST-10001", name: "Ada Lovelace", email: "ada@example.com", tier: "gold", balance: 120.5 }],
  ["CUST-10002", { customer_id: "CUST-10002", name: "Alan Turing", email: "alan@example.com", tier: "standard", balance: 42 }],
  ["CUST-12345", { customer_id: "CUST-12345", name: "Grace Hopper", email: "grace@example.com", tier: "gold", balance: 300 }],
]);

const refunds: Refund[] = [];

export function getCustomer(id: string): Customer | undefined {
  return customers.get(id);
}

export function createRefund(customer_id: string, amount: number, reason: string): Refund {
  const refund: Refund = {
    refund_id: `RF-${String(refunds.length + 1).padStart(6, "0")}`,
    customer_id,
    amount,
    reason,
    created_at: new Date().toISOString(),
  };
  refunds.push(refund);
  return refund;
}

export function listRefunds(): readonly Refund[] {
  return refunds;
}
