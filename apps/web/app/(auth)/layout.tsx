import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* Left panel — Aurora (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-stone-950 overflow-hidden items-center justify-center">
        {/* Aurora blobs */}
        <div
          className="absolute w-[500px] h-[500px] rounded-full opacity-30 blur-[120px] animate-aurora"
          style={{ background: "oklch(0.7 0.15 270)", top: "10%", left: "10%" }}
        />
        <div
          className="absolute w-[400px] h-[400px] rounded-full opacity-25 blur-[120px] animate-aurora"
          style={{
            background: "oklch(0.65 0.18 300)",
            bottom: "10%",
            right: "10%",
            animationDelay: "-5s",
          }}
        />
        <div
          className="absolute w-[350px] h-[350px] rounded-full opacity-20 blur-[120px] animate-aurora"
          style={{
            background: "oklch(0.6 0.12 240)",
            top: "40%",
            left: "40%",
            animationDelay: "-10s",
          }}
        />

        {/* Branding */}
        <div className="relative z-10 text-center px-12">
          <Link href="/" className="inline-block">
            <h1 className="text-5xl font-bold text-white tracking-tight">
              Aevoy
            </h1>
          </Link>
          <p className="mt-4 text-lg text-stone-400 max-w-sm mx-auto">
            Your AI Employee That Never Fails
          </p>
        </div>
      </div>

      {/* Right panel — Form */}
      <div className="flex-1 flex flex-col min-h-screen relative">
        {/* Mobile aurora background (subtle) */}
        <div className="absolute inset-0 lg:hidden overflow-hidden pointer-events-none">
          <div
            className="absolute w-[300px] h-[300px] rounded-full opacity-10 blur-[100px] animate-aurora"
            style={{ background: "oklch(0.7 0.15 270)", top: "-5%", right: "-10%" }}
          />
          <div
            className="absolute w-[250px] h-[250px] rounded-full opacity-8 blur-[100px] animate-aurora"
            style={{
              background: "oklch(0.65 0.18 300)",
              bottom: "10%",
              left: "-10%",
              animationDelay: "-5s",
            }}
          />
        </div>

        {/* Mobile header */}
        <header className="lg:hidden border-b bg-white/80 backdrop-blur-sm relative z-10">
          <div className="px-6 py-4">
            <Link href="/" className="text-2xl font-bold text-stone-900">
              Aevoy
            </Link>
          </div>
        </header>

        {/* Centered form */}
        <main className="flex-1 flex items-center justify-center p-6 relative z-10">
          <div className="w-full max-w-[400px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
