"use client";

import { Button } from "@kabosh-digital/m-street-kit/ui/button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
