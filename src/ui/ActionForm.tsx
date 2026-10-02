"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";
import { Button } from "@kabosh-digital/m-street-kit/ui/button";
import { cn } from "@kabosh-digital/m-street-kit/format";
import type { ActionState } from "../actions/shared";

/** A form wired to a server action: pending state, validation errors, success
 * note, and the "possible duplicate" confirmation used when creating clients. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving...",
  successMessage,
  className,
  variant = "default",
  resetOnSuccess = false,
  buttonClassName,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  successMessage?: string;
  className?: string;
  variant?: "default" | "outline" | "secondary";
  resetOnSuccess?: boolean;
  /** Extra classes for the submit button (e.g. a bigger tap target on phones). */
  buttonClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const next = await action(prev, formData);
      return next;
    },
    { error: null } as ActionState,
  );

  // React 19 resets uncontrolled fields after every form action - including ones that
  // return an error, which would wipe what the person typed (and make "Book anyway" /
  // "Create anyway" submit empty fields). Submitting manually keeps the values; forms
  // that should clear on success do so explicitly through the `key` below.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };

  return (
    <form
      onSubmit={onSubmit}
      key={resetOnSuccess && state.ok ? "done" : "form"}
      className={cn("flex flex-col gap-3", className)}
    >
      {children}
      {state.duplicates && state.duplicates.length > 0 ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">This looks like someone you already have:</p>
          <ul className="mt-1 list-disc pl-5">
            {state.duplicates.map((d) => (
              <li key={d.client.id}>
                <Link href={`/clients/${d.client.id}`} className="underline">
                  {d.client.name}
                </Link>{" "}
                <span className="text-xs">(same {d.reasons.join(" and ")})</span>
              </li>
            ))}
          </ul>
          <Button type="submit" name="ignoreDuplicates" value="yes" variant="outline" size="sm" className="mt-2" disabled={pending}>
            Create anyway
          </Button>
        </div>
      ) : null}
      {state.conflict ? (
        <div>
          <Button type="submit" name="allowConflict" value="yes" variant="outline" size="sm" disabled={pending}>
            Book anyway
          </Button>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      ) : null}
      {state.ok && successMessage ? <p className="text-sm text-green-700 dark:text-green-400">{successMessage}</p> : null}
      <div>
        <Button type="submit" variant={variant} disabled={pending} className={buttonClassName}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
