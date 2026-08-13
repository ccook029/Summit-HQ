// ---------------------------------------------------------------------------
// GET /api/org/bank-accounts — the Books bank/credit-card accounts, so the
// owner can say which one a statement belongs to before it's reconciled.
// Ids and names only; behind the login wall like everything else.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { fetchBankAccounts } from "@/lib/zoho-books";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accounts = await fetchBankAccounts();
    return NextResponse.json({
      accounts: accounts.map((a) => ({
        account_id: a.account_id,
        account_name: a.account_name,
        account_type: a.account_type,
      })),
    });
  } catch (err) {
    // Not fatal — the uploader falls back to inferring the account.
    return NextResponse.json({
      accounts: [],
      error: err instanceof Error ? err.message : "unknown error",
    });
  }
}
