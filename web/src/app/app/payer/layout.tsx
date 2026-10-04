import { PayerNav } from "@/components/payer/payer-nav";

export default function PayerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PayerNav />
      {children}
    </>
  );
}
