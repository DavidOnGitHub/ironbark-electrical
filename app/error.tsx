"use client";

import { Button } from "@kabosh-digital/m-street-kit/ui/button";

/** Something failed while loading a page: say so plainly, change nothing, offer a retry. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 flex max-w-md flex-col items-start gap-3 rounded-md border bg-card p-6">
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">This page could not be loaded. Nothing has been changed. Try again, and if it keeps happening let the office know.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
