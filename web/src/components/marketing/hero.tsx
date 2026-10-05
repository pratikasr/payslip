import Link from "next/link";
import { cn } from "cn";
import { Initials } from "@/components/ds/avatar";
import { Button } from "@/components/ui/button";
import { formatHeight } from "@/lib/format";
import { REHEARSALS } from "@/components/marketing/data";
import { GoldDot, TxLink } from "@/components/marketing/parts";
import { lp } from "@/components/marketing/classes";

const RUN = REHEARSALS[0];
const SHOWN = RUN.lines.slice(0, 4);
const REST = RUN.lines.slice(4);

/**
 * Mercury's cinematic hero at dusk. The card is a real testnet payroll (rehearsal 1): the names
 * come from Payslip's own run records, the amounts stay sealed, and every row opens the
 * transaction in the explorer, which shows neither.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="dark relative isolate overflow-hidden bg-background text-[#ededf3]"
    >
      <Sky />
      <div className="relative mx-auto max-w-5xl px-4 pt-[112px] pb-12 text-center sm:px-6 sm:pt-[140px] sm:pb-14">
        <h1
          id="hero-title"
          className="text-[2.625rem] leading-[1.02] font-[480] tracking-[-0.03em] text-balance text-[#f4f3f8] sm:text-[3.5rem] lg:text-[4rem]"
        >
          Radically private payroll
        </h1>
        <p className="mx-auto mt-4 max-w-[34rem] text-[1.0625rem] leading-[1.45] text-pretty text-[#dcd9e6] sm:mt-5 sm:text-[1.1875rem]">
          Pay contractors anywhere in shielded Zcash. Each person gets a key to their own payslips, and your accountant
          gets the books.
        </p>
        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="h-11 px-6 text-[15px]">
            <Link href="/console">Try the live demo</Link>
          </Button>
          <Link
            href="/verify"
            className="inline-flex h-11 items-center justify-center rounded-full border border-white/25 bg-white/[0.06] px-6 text-[15px] text-[#ededf3] backdrop-blur-sm transition-colors hover:bg-white/[0.12]"
          >
            Check a payslip
          </Link>
        </div>

        <SealedRun />

        <p className="mx-auto mt-8 w-fit max-w-full rounded-[10px] bg-[rgba(23,23,33,0.72)] px-4 py-2.5 text-xs leading-relaxed text-[#dddde5] backdrop-blur-sm">
          Payslip is open-source software, not a bank. Payments settle on Zcash; USDC funding swaps run through NEAR
          Intents.
        </p>
      </div>
    </section>
  );
}

function SealedRun() {
  return (
    <figure
      aria-labelledby="sealed-title"
      className="mx-auto mt-12 w-full max-w-[35rem] rounded-2xl border border-white/10 bg-[rgba(23,23,33,0.74)] px-4 pt-4 pb-3 text-left shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] backdrop-blur-md sm:mt-14 sm:px-5 sm:pt-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="sealed-title" className="text-[15px] text-[#ededf3]">
            {RUN.period} payroll
          </p>
          <p className="mt-0.5 text-xs text-[#a6a6b2]">
            Run {RUN.runId.slice(0, 8)} on Zcash testnet<span className="hidden sm:inline">, {RUN.date}</span>
          </p>
        </div>
        <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[4px] bg-[rgba(244,183,40,0.16)] px-2 text-xs text-[#ededf3]">
          <GoldDot className="size-1.5" />
          Shielded
        </span>
      </div>

      <ul className="mt-2">
        {SHOWN.map((l, i) => (
          <li
            key={l.txid}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.07] py-[11px] text-sm"
          >
            <Initials name={l.name} className="bg-white/[0.08] text-[#dddde5]" />
            <span className="truncate text-[#ededf3]">{l.name}</span>
            <span className="flex items-center gap-4">
              <span
                className={cn(lp.bar, "w-16 sm:w-[86px]")}
                style={{ ["--sheen-delay" as string]: `${700 + i * 140}ms` }}
              >
                <span className="sr-only">Amount sealed</span>
              </span>
              <TxLink
                txid={l.txid}
                className="hidden text-xs text-[#a6a6b2] hover:text-[#f4b728] sm:inline-flex"
                head={6}
                tail={4}
              />
            </span>
          </li>
        ))}
        <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-[11px] text-sm">
          <Initials text={`+${REST.length}`} className="bg-white/[0.08] text-[#dddde5]" />
          <span className="truncate text-[#c3c3cc]">{REST.map((l) => l.name).join(" and ")}</span>
          <span className="hidden text-xs text-[#a6a6b2] sm:inline">Amounts sealed</span>
        </li>
      </ul>

      <figcaption className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/[0.08] pt-3 text-[13px] text-[#dddde5]">
        <span className="inline-flex items-center gap-2">
          <GoldDot />
          {RUN.lines.length} payments at heights {formatHeight(RUN.lines[0].height)} to{" "}
          {formatHeight(RUN.lines[RUN.lines.length - 1].height)}
        </span>
        <a href="#proof" className="rounded-sm text-[#f4b728] underline-offset-4 hover:underline">
          Check them yourself
        </a>
      </figcaption>
    </figure>
  );
}

/** Dusk sky, haze and three ridges of hills. Decorative. */
function Sky() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className={cn(lp.sky, "absolute inset-0")} />
      <div className={cn(lp.rays, "absolute inset-0")} />
      <svg
        className="absolute inset-x-0 bottom-0 h-[320px] w-full sm:h-[400px]"
        viewBox="0 0 1440 400"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
          <linearGradient id="ridge-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8a5f6c" stopOpacity="0.78" />
            <stop offset="1" stopColor="#4b3349" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="ridge-mid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a3347" />
            <stop offset="1" stopColor="#2a2034" />
          </linearGradient>
          <linearGradient id="ridge-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#261d2e" />
            <stop offset="0.7" stopColor="#171721" />
          </linearGradient>
          <radialGradient id="mist" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff3e2" stopOpacity="0.16" />
            <stop offset="1" stopColor="#fff3e2" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path
          fill="url(#ridge-far)"
          d="M0 132 C60 120 110 96 180 102 C250 108 290 132 360 124 C440 114 480 70 560 66 C640 62 690 100 760 108 C840 116 900 86 980 84 C1060 82 1100 118 1180 112 C1260 106 1320 74 1380 78 C1410 80 1430 90 1440 94 V400 H0 Z"
        />
        <ellipse cx="380" cy="176" rx="420" ry="46" fill="url(#mist)" />
        <ellipse cx="1120" cy="168" rx="380" ry="40" fill="url(#mist)" />
        <path
          fill="url(#ridge-mid)"
          d="M0 206 C80 190 150 168 230 176 C320 186 360 214 450 204 C540 194 600 160 690 166 C780 172 820 206 910 210 C1000 214 1060 180 1150 182 C1240 184 1300 212 1380 204 C1410 201 1430 196 1440 196 V400 H0 Z"
        />
        <ellipse cx="760" cy="236" rx="520" ry="40" fill="url(#mist)" />
        <path
          fill="url(#ridge-near)"
          d="M0 286 C120 262 220 250 330 262 C440 274 520 296 640 288 C760 280 840 252 960 256 C1080 260 1160 290 1280 286 C1360 284 1410 272 1440 268 V400 H0 Z"
        />
      </svg>
    </div>
  );
}
