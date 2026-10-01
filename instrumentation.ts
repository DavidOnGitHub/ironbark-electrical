// Runs once when the server starts: hands this business's hooks to the shared
// console (see @kabosh-digital/m-street-kit's README, "configureKit").
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configureKit } = await import("@kabosh-digital/m-street-kit/config");
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
      { title: "Field", items: [{ href: "/my-day", label: "My day", icon: "wrench", roles: ["OPERATOR"] }] },
      { title: "Setup", items: [{ href: "/pricing", label: "Price list", icon: "banknote", roles: ["ADMIN", "EDITOR"] }] },
    ],
    roleLabels: { ADMIN: "Owner", EDITOR: "Office", OPERATOR: "Technician", VIEWER: "Bookkeeper" },
    // Workflows, connected apps and users are the Owner's (requirements section 7).
    policy: { DEFINITIONS_AND_INSTANCES: ["ADMIN"], CONNECTORS: ["ADMIN"] },
  });
}
