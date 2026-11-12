// Runs once when the server starts: hands this business's hooks to the shared
// console (see @kabosh-digital/m-street-kit's README, "configureKit").
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configureKit } = await import("@kabosh-digital/m-street-kit/config");
  type NavBadge = import("@kabosh-digital/m-street-kit/config").NavBadge;
  const { registerStepMetadata } = await import("@kabosh-digital/workflow-temporal/catalog");
  const { ironSparkStepDefs, ironSparkAssistantSteps } = await import("./src/steps/defs");
  const { ironbarkAppAssistantTools } = await import("./src/automation/appAssistantTools");
  registerStepMetadata(ironSparkStepDefs);
  configureKit({
    nav: [
      {
        title: "Customers",
        items: [
          { href: "/clients", label: "Clients", icon: "contact", roles: ["ADMIN", "EDITOR", "VIEWER"] },
          { href: "/requests", label: "Requests", icon: "inbox", roles: ["ADMIN", "EDITOR"] },
        ],
      },
      {
        title: "Work",
        items: [
          { href: "/quotes", label: "Quotes", icon: "file-text", roles: ["ADMIN", "EDITOR", "VIEWER"] },
          { href: "/jobs", label: "Jobs", icon: "briefcase", roles: ["ADMIN", "EDITOR", "VIEWER"] },
          { href: "/schedule", label: "Schedule", icon: "calendar", roles: ["ADMIN", "EDITOR", "VIEWER"] },
          { href: "/invoices", label: "Invoices", icon: "receipt", roles: ["ADMIN", "EDITOR", "VIEWER"] },
        ],
      },
      { title: "IT", items: [{ href: "/it", label: "IT", icon: "settings", roles: ["ADMIN", "EDITOR", "OPERATOR", "VIEWER"] }] },
      { title: "Insights", items: [{ href: "/reports", label: "Reports", icon: "bar-chart", roles: ["ADMIN", "EDITOR", "VIEWER"] }] },
      { title: "About this demo", items: [{ href: "/works-for", label: "Works for...", icon: "building", roles: ["ADMIN", "EDITOR", "VIEWER"] }] },
      { title: "Field", items: [{ href: "/my-day", label: "My day", icon: "wrench", roles: ["OPERATOR"] }] },
      { title: "Setup", items: [{ href: "/pricing", label: "Price list", icon: "banknote", roles: ["ADMIN", "EDITOR"] }, { href: "/email-templates", label: "Email templates", icon: "mail", roles: ["ADMIN", "EDITOR"] }] },
    ],
    navBadges: async ({ roles }): Promise<Record<string, NavBadge>> => {
      if (!roles.some((r) => ["ADMIN", "EDITOR", "VIEWER"].includes(r))) return {};
      const { appDb } = await import("./src/db/app");
      const { receivablesSummary } = await import("./src/domain/invoicing");
      const [newRequests, toSchedule, money] = await Promise.all([appDb.request.count({ where: { status: "NEW" } }), appDb.job.count({ where: { status: "UNSCHEDULED" } }), receivablesSummary()]);
      return {
        "/requests": { count: newRequests, label: "new enquiries" },
        "/schedule": { count: toSchedule, label: "jobs to schedule" },
        "/invoices": { count: money.overdue.length, tone: "bad" as const, label: "overdue invoices" },
      };
    },
    roleLabels: { ADMIN: "Owner", EDITOR: "Office", OPERATOR: "Technician", VIEWER: "Bookkeeper" },
    // Workflows, connected apps and users are the Owner's (requirements section 7).
    assistantSteps: ironSparkAssistantSteps,
    appAssistantTools: ironbarkAppAssistantTools,
    policy: { DEFINITIONS_AND_INSTANCES: ["ADMIN"], CONNECTORS: ["ADMIN"] },
  });
}

// Next calls this for every error thrown while serving a request: pages, route handlers, server actions and
// middleware. It only records and, when switched on, hands the error to the IT assistant; it must never throw.
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string; renderSource?: string; revalidateReason?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./src/domain/it");
  await reportError(error, {
    source: context.routeType === "action" ? "action" : "request",
    // The route pattern (/quotes/[id]), not the URL: it carries no ids and groups the same bug together.
    route: context.routePath || request.path,
    context: { method: request.method, routeType: context.routeType, routerKind: context.routerKind, renderSource: context.renderSource, revalidateReason: context.revalidateReason },
  });
}
