import { AppHeader } from "@/components/app/app-header";
import { HealthProvider } from "@/components/app/health-provider";

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <HealthProvider>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8">
        {children}
      </main>
    </HealthProvider>
  );
}
