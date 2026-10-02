import { auth } from "@kabosh-digital/m-street-kit/auth";
import RunPage from "@kabosh-digital/m-street-kit/pages/instances/[id]";
import { reviewsForInstance } from "../../../src/domain/approvals";
import { TaskReview } from "../../../src/ui/TaskReview";

export const dynamic = "force-dynamic";

/** The console's run page, with what the run is waiting for approval on shown above it. */
export default async function InstancePage(props: Parameters<typeof RunPage>[0]) {
  const { id } = await props.params;
  const session = await auth();
  const reviews = session?.user?.id ? await reviewsForInstance(id, { id: session.user.id, roles: (session.user.roles ?? []) as string[] }) : [];
  return (
    <>
      {reviews.length > 0 ? (
        <div className="mb-5 rounded-md border border-l-4 border-l-hivis bg-card p-4" data-testid="run-approval">
          <p className="text-lg font-bold">Waiting for your approval</p>
          {reviews.map((r) => (
            <TaskReview key={r.taskId} review={r.review} />
          ))}
          <p className="mt-3 text-sm text-muted-foreground">Approve or reject it under <a href="/tasks" className="font-semibold underline">Tasks</a>.</p>
        </div>
      ) : null}
      <RunPage {...props} />
    </>
  );
}
