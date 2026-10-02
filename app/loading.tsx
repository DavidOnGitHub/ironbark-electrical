/** Skeleton shown while a page loads, so the layout does not jump. */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading</span>
      <div className="h-9 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
    </div>
  );
}
