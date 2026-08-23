import { Link } from "react-router-dom";
import { Logo } from "../../components/logo.js";
import { RazorpayLogo } from "../../components/brand-logos.js";

export function Hero() {
  return (
    <div className="min-h-screen bg-white font-jakarta">
      {/* Logo */}
      <header className="w-full px-4 pt-6 sm:px-8">
        <Link
          to="/"
          className="flex items-center justify-center rounded-lg py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#151515]"
        >
          <Logo className="text-2xl !text-[#151515]" />
        </Link>
      </header>

      {/* Hero */}
      <section className="w-full overflow-hidden px-4 py-10 sm:px-8 sm:py-16">
        <div className="mx-auto max-w-6xl">
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-[#f5f5f5] py-1.5 pl-2 pr-3.5 text-[13px] font-semibold text-[#151515] sm:gap-2.5 sm:pr-4 sm:text-[16px]">
              <span className="flex items-center">
                <span className="h-3.5 w-3.5 rounded-full bg-[#f0577c] ring-2 ring-[#f5f5f5] sm:h-4 sm:w-4" />
                <span className="-ml-1.5 h-3.5 w-3.5 rounded-full bg-[#f5a524] ring-2 ring-[#f5f5f5] sm:h-4 sm:w-4" />
                <span className="-ml-1.5 h-3.5 w-3.5 rounded-full bg-[#a8e05f] ring-2 ring-[#f5f5f5] sm:h-4 sm:w-4" />
              </span>
              Trusted by finance teams
            </span>
          </div>

          <h1 className="mx-auto mt-8 max-w-3xl text-center text-[34px] font-semibold leading-[1.15] tracking-[-0.6px] [text-wrap:balance] sm:mt-10 sm:text-[48px] sm:leading-[1.1] sm:tracking-[-1.2px]">
            <span className="text-[#151515]">Recover failed payments</span>
            <br />
            <span className="text-[#151515]/45">before you write them off</span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-center text-[15px] font-normal leading-[24px] text-[#3f3f3f] [text-wrap:pretty] sm:mt-7 sm:text-[16px] sm:leading-[28px]">
            Riko watches every charge around the clock, works out why it failed, and emails the customer
            to fix it — looping in humans only when it actually matters.
          </p>

          <div className="mt-8 flex justify-center sm:mt-10">
            <Link
              to="/dashboard/connections"
              className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#2f7cf6] px-7 py-3.5 text-[16px] font-semibold text-white [box-shadow:inset_0_2px_0_rgba(255,255,255,0.3),inset_0_-2px_0_rgba(0,0,0,0.15),0_4px_0_#1c5fd0,0_8px_16px_-4px_rgba(47,124,246,0.5)] transition-[background-color,box-shadow,transform] duration-100 ease-out hover:bg-[#1c68e6] hover:[box-shadow:inset_0_2px_0_rgba(255,255,255,0.3),inset_0_-2px_0_rgba(0,0,0,0.15),0_4px_0_#1756bd,0_10px_20px_-4px_rgba(47,124,246,0.55)] active:translate-y-[4px] active:[box-shadow:inset_0_2px_0_rgba(255,255,255,0.25),inset_0_-2px_0_rgba(0,0,0,0.15),0_0_0_#1c5fd0,0_4px_10px_-4px_rgba(47,124,246,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f7cf6]"
            >
              Connect
              <RazorpayLogo className="h-4 w-auto brightness-0 invert" />
            </Link>
          </div>

          {/* Dashboard preview */}
          <div className="relative mt-12 overflow-hidden rounded-[20px] bg-[#3b4ff0] p-3 shadow-[0_20px_60px_-25px_rgba(59,79,240,0.45)] sm:mt-20 sm:rounded-[40px] sm:p-8 sm:shadow-[0_40px_100px_-30px_rgba(59,79,240,0.45)]">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(60% 70% at 8% 6%, rgba(190,200,255,0.95) 0%, transparent 60%), radial-gradient(70% 80% at 95% 100%, rgba(30,40,220,0.85) 0%, transparent 65%)",
              }}
            />
            <div className="relative overflow-hidden rounded-lg border-2 border-white/20 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.5)]">
              <img
                src="/hero-dashboard.png"
                alt="Riko dashboard overview showing recovered payments, decisions, and recent case activity"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full px-4 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <Logo className="text-lg !text-[#151515]" />
          <p className="text-[13px] text-[#3f3f3f]">© {new Date().getFullYear()} Riko. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
