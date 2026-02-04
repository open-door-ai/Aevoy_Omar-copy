"use client";

import { useState } from "react";
import Link from "next/link";

const capabilities = [
  {
    id: "booking",
    title: "Bookings & Reservations",
    subtitle: "Restaurants, hotels, flights, appointments",
    icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5",
    steps: [
      "You email: \"Book a table for 4 at Miku on Saturday at 7pm\"",
      "AI opens the restaurant's booking system in a real browser",
      "Selects date, time, party size — handles waitlists if needed",
      "Confirms the reservation and sends you booking details + confirmation number",
    ],
    example:
      "\"I need a pet-friendly hotel in Portland, under $200/night, close to downtown, with free parking. Check-in Friday, check-out Sunday.\"",
  },
  {
    id: "research",
    title: "Research & Analysis",
    subtitle: "Compare options, find information, analyze data",
    icon: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z",
    steps: [
      "You email: \"Compare CRM tools for law firms under $200/month\"",
      "AI searches multiple sources, reads reviews, checks pricing pages",
      "Compiles a comparison with pricing, features, pros/cons",
      "Sends you a formatted report you can act on immediately",
    ],
    example:
      "\"What are the tax implications of selling my rental property in BC? I bought it in 2019 for $650K, it's now worth $950K, and I've been renting it the whole time.\"",
  },
  {
    id: "forms",
    title: "Forms & Applications",
    subtitle: "Government forms, insurance claims, visa applications",
    icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
    steps: [
      "You email: \"Fill out BC Probate Form P1 with the estate details I sent\"",
      "AI opens the form, maps your data to the correct fields",
      "Fills all 47 fields with accurate information, validates each entry",
      "Sends you the completed PDF, highlighting fields that need signatures",
    ],
    example:
      "\"Complete the IRCC visitor visa application for my parents. I'll send their passport info and financial docs.\"",
  },
  {
    id: "email",
    title: "Email Management",
    subtitle: "Draft, reply, organize, unsubscribe",
    icon: "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75",
    steps: [
      "You email: \"Draft a follow-up to the Morrison estate beneficiaries\"",
      "AI uses your communication style and context from previous emails",
      "Drafts a professional email matching your tone and the legal context",
      "Sends you the draft for approval before sending",
    ],
    example:
      "\"Go through my inbox and unsubscribe me from anything that looks like marketing. Don't touch anything from actual people.\"",
  },
  {
    id: "calls",
    title: "Phone Calls",
    subtitle: "Make calls, navigate phone menus, get callbacks",
    icon: "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z",
    steps: [
      "You email: \"Call me at 3pm to remind me about the Morrison file\"",
      "At 3pm sharp, your AI calls you",
      "Provides a brief: case details, deadlines, pending items",
      "You can ask follow-up questions or request more research",
    ],
    example:
      "\"Check if my prescription is ready at Shoppers Drug Mart on Davie St. If it is, ask them to hold it until tomorrow.\"",
  },
  {
    id: "shopping",
    title: "Shopping & Monitoring",
    subtitle: "Price tracking, purchases, comparisons",
    icon: "M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z",
    steps: [
      "You email: \"Monitor Sony WH-1000XM5, alert me when under $350\"",
      "AI checks multiple retailers periodically",
      "Price drops to $329 at Amazon — AI sends you an instant alert",
      "Includes purchase link, price history, and how long the deal might last",
    ],
    example:
      "\"Find the cheapest flight to Toronto for next Friday, under $400, direct preferred. Compare WestJet, Air Canada, and Flair.\"",
  },
];

const faqs = [
  {
    q: "Is this a chatbot?",
    a: "No. Chatbots answer questions. Aevoy does things. It opens a real browser, navigates real websites, fills real forms, and makes real phone calls. You get results, not responses.",
  },
  {
    q: "How does it access my accounts?",
    a: "You share login credentials securely during onboarding. All credentials are encrypted at rest with AES-256-GCM using keys derived from your account. We never log or store them in plaintext.",
  },
  {
    q: "What if it needs a 2FA code?",
    a: "Two options: (1) Free — your AI emails you asking for the code, you reply with it. (2) $1/month — get a virtual phone number that automatically receives SMS codes.",
  },
  {
    q: "Can it make purchases?",
    a: "Only if you enable the Agent Card — a virtual prepaid card you fund and control. You set transaction limits, monthly caps, and can freeze it anytime. Your personal card is never used.",
  },
  {
    q: "What AI models does it use?",
    a: "Multiple models optimized for cost and capability: DeepSeek V3.2 for most tasks ($0.25/1M tokens), Kimi K2 for complex agentic work, Gemini Flash for validation, and Claude for reasoning. Average task cost: under $0.10.",
  },
  {
    q: "Is my data safe?",
    a: "All user data is encrypted at rest. Row-level security on all database tables. Every task is scoped by intent locking — your AI can only do what the task requires. Full audit logs. GDPR-compliant data export and deletion.",
  },
];

export default function HowItWorksPage() {
  const [activeCap, setActiveCap] = useState("booking");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const active = capabilities.find((c) => c.id === activeCap) || capabilities[0];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Nav */}
      <nav className="bg-stone-50/90 backdrop-blur-xl border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center">
              <span className="text-white font-semibold text-sm">H</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">Aevoy</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-stone-500 hover:text-stone-900 transition-colors text-sm font-medium"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="px-5 py-2.5 bg-stone-900 text-white rounded-full text-sm font-medium hover:bg-stone-800 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-24 md:py-32">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
            How Aevoy Works
          </h1>
          <p className="text-xl md:text-2xl text-stone-500 max-w-2xl mx-auto">
            Your AI employee that opens a browser, navigates the web, and
            completes real tasks — just like a human would.
          </p>
        </div>
      </section>

      {/* Three-step overview */}
      <section className="py-20 bg-white border-y border-stone-200">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-12 md:gap-8">
            {[
              {
                num: "01",
                title: "Send a task",
                text: "Email, text, or call your AI. Use plain language — no special format needed.",
              },
              {
                num: "02",
                title: "AI does the work",
                text: "Your AI opens a real browser, navigates websites, fills forms, makes calls.",
              },
              {
                num: "03",
                title: "Get results back",
                text: "Receive confirmation with proof — screenshots, booking numbers, completed PDFs.",
              },
            ].map((step) => (
              <div key={step.num} className="text-center md:text-left">
                <div className="text-5xl font-bold text-stone-200 mb-4">
                  {step.num}
                </div>
                <h3 className="text-xl font-bold text-stone-900 mb-2">
                  {step.title}
                </h3>
                <p className="text-stone-500">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capability walkthroughs */}
      <section className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Capability Walkthroughs
            </h2>
            <p className="text-xl text-stone-500">
              See exactly how your AI handles each type of task
            </p>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap justify-center gap-3 mb-12">
            {capabilities.map((cap) => (
              <button
                key={cap.id}
                onClick={() => setActiveCap(cap.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  activeCap === cap.id
                    ? "bg-stone-900 text-white shadow-lg shadow-stone-900/20"
                    : "bg-white text-stone-600 border border-stone-200 hover:border-stone-400"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={cap.icon}
                  />
                </svg>
                {cap.title.split(" ")[0]}
              </button>
            ))}
          </div>

          {/* Active capability */}
          <div className="max-w-3xl mx-auto">
            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
              <div className="bg-stone-900 p-8 text-white">
                <h3 className="text-2xl font-bold mb-1">{active.title}</h3>
                <p className="text-stone-400">{active.subtitle}</p>
              </div>

              <div className="p-8">
                <h4 className="text-sm font-bold text-stone-400 uppercase tracking-widest mb-6">
                  Step by step
                </h4>
                <ol className="space-y-6">
                  {active.steps.map((step, i) => (
                    <li key={i} className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center shrink-0 text-sm font-bold text-stone-500">
                        {i + 1}
                      </div>
                      <p className="text-stone-700 pt-1">{step}</p>
                    </li>
                  ))}
                </ol>

                <div className="mt-8 bg-stone-50 border border-stone-200 rounded-xl p-5">
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">
                    Example task
                  </p>
                  <p className="text-stone-700 italic">
                    &ldquo;{active.example}&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security explanation */}
      <section className="py-24 md:py-32 bg-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Security by Design
            </h2>
            <p className="text-xl text-stone-400 max-w-2xl mx-auto">
              Every task is scoped, encrypted, and verified — because trust is
              earned, not declared.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Intent Locking",
                description:
                  "Before any task runs, it gets a locked scope: which sites it can visit, what actions it can take, and a budget cap. The scope is frozen and immutable — the AI can't expand it.",
                icon: "M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z",
              },
              {
                title: "Encrypted Memory",
                description:
                  "All your data — preferences, credentials, task history — is encrypted at rest with AES-256-GCM. Keys are derived from your account. Even we can't read your data.",
                icon: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
              },
              {
                title: "3-Step Verification",
                description:
                  "Every completed task goes through: (1) self-check — did the action succeed? (2) evidence review — screenshots and DOM state. (3) smart validation — a different AI model confirms the result.",
                icon: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="bg-stone-800 rounded-2xl p-8 border border-stone-700"
              >
                <div className="w-12 h-12 rounded-xl bg-stone-700 flex items-center justify-center mb-6">
                  <svg
                    className="w-6 h-6 text-stone-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={item.icon}
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                <p className="text-stone-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 md:py-32 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Pricing
          </h2>
          <p className="text-xl text-stone-500 mb-12">
            We&apos;re in beta. Everything is free.
          </p>

          <div className="max-w-md mx-auto bg-gradient-to-br from-stone-800 to-stone-900 rounded-3xl p-10 text-white">
            <div className="inline-block px-3 py-1 bg-white/10 rounded-full text-sm font-medium mb-6">
              Beta Access
            </div>
            <div className="text-6xl font-bold mb-2">$0</div>
            <p className="text-stone-400 mb-8">
              per month, while we&apos;re in beta
            </p>
            <ul className="text-left space-y-3 mb-10">
              {[
                "Unlimited tasks",
                "Email, SMS, and voice access",
                "Browser automation",
                "Encrypted memory",
                "Agent card (virtual prepaid)",
                "Full audit logs",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <svg
                    className="w-5 h-5 text-green-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                  <span className="text-stone-300">{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full py-4 bg-white text-stone-900 rounded-xl font-semibold text-lg hover:bg-stone-100 transition-colors text-center"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 md:py-32 bg-stone-50">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              FAQ
            </h2>
            <p className="text-xl text-stone-500">
              Common questions, straight answers.
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="bg-white border border-stone-200 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left"
                >
                  <span className="font-semibold text-stone-900 pr-4">
                    {faq.q}
                  </span>
                  <svg
                    className={`w-5 h-5 text-stone-400 shrink-0 transition-transform ${
                      openFaq === i ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m19.5 8.25-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5 -mt-1">
                    <p className="text-stone-600 leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 md:py-32 bg-stone-900 text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Ready to get started?
          </h2>
          <p className="text-xl text-stone-400 mb-10 max-w-2xl mx-auto">
            Sign up, set up your AI email, and send your first task. It&apos;s
            that simple.
          </p>
          <Link
            href="/signup"
            className="inline-block px-10 py-5 bg-white text-stone-900 rounded-full font-semibold text-lg hover:shadow-2xl hover:shadow-white/20 transition-all"
          >
            Get Started
          </Link>
          <p className="mt-10 text-sm text-stone-600">
            Questions? hello@aevoy.com — a human will respond.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-stone-950 text-stone-500">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm">
            <p>&copy; 2026 Aevoy. All rights reserved.</p>
            <div className="flex gap-6">
              <Link href="/" className="hover:text-white transition-colors">
                Home
              </Link>
              <Link
                href="/hive"
                className="hover:text-white transition-colors"
              >
                The Social Network
              </Link>
              <Link
                href="/signup"
                className="hover:text-white transition-colors"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
