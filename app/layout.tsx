import type { ReactNode } from "react";
import { KitRootLayout } from "@kabosh-digital/m-street-kit/layout";
import packageJson from "../package.json";
import { StepCatalogSetup } from "./StepCatalogSetup";
import "./globals.css";

export { generateMetadata } from "@kabosh-digital/m-street-kit/layout";

// Every page needs live branding/session/pending-task state - see the kit's layout.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <KitRootLayout appVersion={packageJson.version}>
      <StepCatalogSetup />
      {children}
    </KitRootLayout>
  );
}
