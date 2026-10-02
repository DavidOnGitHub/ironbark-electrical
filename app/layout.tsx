import type { ReactNode } from "react";
import { KitRootLayout } from "@kabosh-digital/m-street-kit/layout";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { listTemplateOptions } from "../src/domain/emailTemplates";
import packageJson from "../package.json";
import { StepCatalogSetup } from "./StepCatalogSetup";
import "./globals.css";

export { generateMetadata } from "@kabosh-digital/m-street-kit/layout";

// Every page needs live branding/session/pending-task state - see the kit's layout.
// Loaded here so Next self-hosts them; globals.css refers to them by family name.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], display: "swap" });
void barlow;
void barlowCondensed;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The workflow builder offers these as the email step's template dropdown. Not signed in, or no database yet: no options.
  const templates = await listTemplateOptions().catch(() => []);
  return (
    <KitRootLayout appVersion={packageJson.version}>
      <StepCatalogSetup templateKeys={templates.map((t) => t.key)} />
      {children}
    </KitRootLayout>
  );
}
