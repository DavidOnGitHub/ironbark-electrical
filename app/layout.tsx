import type { ReactNode } from "react";
import { KitRootLayout } from "@kabosh-digital/m-street-kit/layout";
import { Barlow, Barlow_Condensed } from "next/font/google";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <KitRootLayout appVersion={packageJson.version}>
      <StepCatalogSetup />
      {children}
    </KitRootLayout>
  );
}
