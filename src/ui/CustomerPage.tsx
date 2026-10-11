import type { ReactNode } from "react";

/** The frame for pages a customer sees (quote link, payment thank-you). They have no account, and the console's
 * layout adds its sidebar and header to every page, so this covers them with a plain, centred page. */
export function CustomerPage({ children, width = "max-w-xl" }: { children: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background px-4" data-testid="customer-page">
      <div className={`mx-auto flex ${width} flex-col gap-4 py-8`}>{children}</div>
    </div>
  );
}
