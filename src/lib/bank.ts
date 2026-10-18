/** The business's bank account for direct transfers. Fictional (Ironbark Electrical is a demo business); set BANK_* to change them. */
export interface BankDetails {
  accountName: string;
  bsb: string;
  accountNumber: string;
}

export function bankDetails(env: Record<string, string | undefined> = process.env): BankDetails {
  return {
    accountName: env.BANK_ACCOUNT_NAME || "Ironbark Electrical Pty Ltd",
    bsb: env.BANK_BSB || "123-456",
    accountNumber: env.BANK_ACCOUNT_NUMBER || "1234 5678",
  };
}

/** The "how to pay by bank transfer" block for an email (the template markup: bold and line breaks). The invoice number is the payment reference. */
export function bankTransferBlock(reference: string, details: BankDetails = bankDetails()): string {
  return `**Pay by direct bank transfer**\nAccount name: ${details.accountName}\nBSB: ${details.bsb}\nAccount number: ${details.accountNumber}\nReference: ${reference}`;
}
