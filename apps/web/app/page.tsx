'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ============================================
// INTRO SEQUENCE COMPONENT
// ============================================
const IntroSequence = ({ onComplete }: { onComplete: () => void }) => {
  const [phase, setPhase] = useState(0);
  // Phase 0: Black screen
  // Phase 1: Typing "Introducing"
  // Phase 2: Typing "Artificial General Intelligence"
  // Phase 3: Show "(AGI)"
  // Phase 4: Pause
  // Phase 5: Curtain pulls, shows tagline
  // Phase 6: Fade out entirely
  
  const [typedText1, setTypedText1] = useState('');
  const [typedText2, setTypedText2] = useState('');
  const [showAGI, setShowAGI] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  
  const text1 = 'Introducing';
  const text2 = 'Artificial General Intelligence';
  
  useEffect(() => {
    // Start typing after brief pause
    const startDelay = setTimeout(() => setPhase(1), 800);
    return () => clearTimeout(startDelay);
  }, []);
  
  // Phase 1: Type "Introducing"
  useEffect(() => {
    if (phase !== 1) return;
    
    let i = 0;
    const typeInterval = setInterval(() => {
      if (i < text1.length) {
        setTypedText1(text1.slice(0, i + 1));
        i++;
      } else {
        clearInterval(typeInterval);
        setTimeout(() => setPhase(2), 300);
      }
    }, 80);
    
    return () => clearInterval(typeInterval);
  }, [phase]);
  
  // Phase 2: Type "Artificial General Intelligence"
  useEffect(() => {
    if (phase !== 2) return;
    
    let i = 0;
    const typeInterval = setInterval(() => {
      if (i < text2.length) {
        setTypedText2(text2.slice(0, i + 1));
        i++;
      } else {
        clearInterval(typeInterval);
        setTimeout(() => setPhase(3), 400);
      }
    }, 50);
    
    return () => clearInterval(typeInterval);
  }, [phase]);
  
  // Phase 3: Show "(AGI)"
  useEffect(() => {
    if (phase !== 3) return;
    setShowAGI(true);
    setTimeout(() => setPhase(4), 800);
  }, [phase]);
  
  // Phase 4: Pause then curtain
  useEffect(() => {
    if (phase !== 4) return;
    setCursorVisible(false);
    const curtainDelay = setTimeout(() => setPhase(5), 600);
    return () => clearTimeout(curtainDelay);
  }, [phase]);
  
  // Phase 5: After curtain animation, fade out
  useEffect(() => {
    if (phase !== 5) return;
    const fadeDelay = setTimeout(() => setPhase(6), 2000);
    return () => clearTimeout(fadeDelay);
  }, [phase]);
  
  // Phase 6: Complete
  useEffect(() => {
    if (phase !== 6) return;
    const completeDelay = setTimeout(() => onComplete(), 800);
    return () => clearTimeout(completeDelay);
  }, [phase, onComplete]);
  
  const router = useRouter();
  
  return (
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-700 ${
        phase === 6 ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-stone-950" />
      
      {/* Curtain Left */}
      <div 
        className={`absolute inset-y-0 left-0 w-1/2 bg-stone-950 z-20 transition-transform duration-1000 ease-[cubic-bezier(0.76,0,0.24,1)] ${
          phase >= 5 ? '-translate-x-full' : 'translate-x-0'
        }`}
      />
      
      {/* Curtain Right */}
      <div 
        className={`absolute inset-y-0 right-0 w-1/2 bg-stone-950 z-20 transition-transform duration-1000 ease-[cubic-bezier(0.76,0,0.24,1)] ${
          phase >= 5 ? 'translate-x-full' : 'translate-x-0'
        }`}
      />
      
      {/* Typing text (on curtain) */}
      <div className={`relative z-30 text-center transition-opacity duration-500 ${
        phase >= 5 ? 'opacity-0' : 'opacity-100'
      }`}>
        <div className="text-stone-500 text-2xl md:text-3xl tracking-wide mb-4 h-10">
          {typedText1}
        </div>
        <div className="text-white text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight">
          {typedText2}
          <span className={`inline-block w-1 h-12 md:h-16 bg-white ml-2 align-middle ${
            cursorVisible && phase < 4 ? 'cursor-blink' : 'opacity-0'
          }`} />
        </div>
        <div className={`text-stone-400 text-xl md:text-2xl mt-4 transition-all duration-500 ${
          showAGI ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          (AGI)
        </div>
      </div>
      
      {/* Reveal content (behind curtain) */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 bg-stone-50 transition-opacity duration-500 ${
        phase >= 5 ? 'opacity-100' : 'opacity-0'
      }`}>
        <h1 
          className={`text-5xl md:text-7xl lg:text-8xl font-bold text-stone-900 tracking-tight text-center mb-6 transition-all duration-700 ${
            phase >= 5 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '400ms' }}
        >
          Your AI Employee
        </h1>
        <p 
          className={`text-xl md:text-2xl text-stone-500 mb-10 transition-all duration-700 ${
            phase >= 5 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '600ms' }}
        >
          Email it. It does it.
        </p>
        <button 
          className={`px-10 py-5 bg-stone-900 text-white rounded-full font-semibold text-lg transition-all duration-700 hover:bg-stone-800 ${
            phase >= 5 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '800ms' }}
          onClick={() => router.push('/signup')}
        >
          Start Free
        </button>
      </div>
    </div>
  );
};

// ============================================
// UTILITY HOOKS
// ============================================

const useScrollReveal = (threshold = 0.1) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold }
    );
    
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);
  
  return [ref, isVisible] as const;
};

const useScrollProgress = (ref: React.RefObject<HTMLElement | null>) => {
  const [progress, setProgress] = useState(0);
  const ticking = useRef(false);
  const lastProgress = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        if (ref.current) {
          const rect = ref.current.getBoundingClientRect();
          const windowHeight = window.innerHeight;
          const elementHeight = ref.current.offsetHeight;

          const start = windowHeight;
          const end = -elementHeight;
          const current = rect.top;
          const prog = Math.max(0, Math.min(1, (start - current) / (start - end)));

          if (Math.abs(prog - lastProgress.current) > 0.01) {
            lastProgress.current = prog;
            setProgress(prog);
          }
        }
        ticking.current = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [ref]);

  return progress;
};

// ============================================
// DEMO PROGRESS HOOK
// ============================================

interface ProgressStep {
  label: string;
  duration: number;
}

const useProgressSteps = (steps: ProgressStep[]) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [isComplete, setIsComplete] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const advanceStep = useCallback((index: number) => {
    if (jumpingRef.current) return;
    if (index >= steps.length) {
      setIsWaiting(true);
      return;
    }
    setCurrentStepIndex(index);
    timerRef.current = setTimeout(() => {
      setCompletedSteps(prev => new Set(prev).add(index));
      advanceStep(index + 1);
    }, steps[index].duration);
  }, [steps]);

  const start = useCallback(() => {
    cleanup();
    jumpingRef.current = false;
    setCurrentStepIndex(0);
    setCompletedSteps(new Set());
    setIsComplete(false);
    setIsWaiting(false);
    timerRef.current = setTimeout(() => {
      setCompletedSteps(prev => new Set(prev).add(0));
      advanceStep(1);
    }, steps[0]?.duration ?? 1000);
  }, [steps, advanceStep, cleanup]);

  const jumpToEnd = useCallback(() => {
    cleanup();
    jumpingRef.current = true;
    setIsWaiting(false);

    const remaining: number[] = [];
    for (let i = 0; i < steps.length; i++) {
      remaining.push(i);
    }

    let delay = 0;
    remaining.forEach((i) => {
      delay += 150;
      setTimeout(() => {
        setCurrentStepIndex(i);
        setCompletedSteps(prev => new Set(prev).add(i));
        if (i === steps.length - 1) {
          setTimeout(() => {
            setIsComplete(true);
            jumpingRef.current = false;
          }, 300);
        }
      }, delay);
    });
  }, [steps, cleanup]);

  const reset = useCallback(() => {
    cleanup();
    jumpingRef.current = false;
    setCurrentStepIndex(-1);
    setCompletedSteps(new Set());
    setIsComplete(false);
    setIsWaiting(false);
  }, [cleanup]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    currentStepIndex,
    completedSteps,
    isComplete,
    isWaiting,
    start,
    jumpToEnd,
    reset,
  };
};

// ============================================
// REUSABLE COMPONENTS
// ============================================

const Parallax = ({ children, speed = 0.5, className = '' }: { children: React.ReactNode; speed?: number; className?: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const ticking = useRef(false);

  useEffect(() => {
    const handleScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        if (ref.current && innerRef.current) {
          const rect = ref.current.getBoundingClientRect();
          const scrolled = window.innerHeight - rect.top;
          innerRef.current.style.transform = `translateY(${scrolled * speed * 0.1}px)`;
        }
        ticking.current = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [speed]);

  return (
    <div ref={ref} className={className}>
      <div ref={innerRef}>
        {children}
      </div>
    </div>
  );
};

const MagneticButton = ({ children, className, onClick, href }: { children: React.ReactNode; className?: string; onClick?: () => void; href?: string }) => {
  const buttonRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = (e.clientX - centerX) * 0.15;
    const deltaY = (e.clientY - centerY) * 0.15;
    setPosition({ x: deltaX, y: deltaY });
  };
  
  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 });
  };
  
  const style = {
    transform: `translate(${position.x}px, ${position.y}px)`,
    transition: position.x === 0 ? 'transform 0.3s ease-out' : 'none'
  };
  
  if (href) {
    return (
      <Link
        href={href}
        ref={buttonRef as React.RefObject<HTMLAnchorElement>}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={className}
        style={style}
      >
        {children}
      </Link>
    );
  }
  
  return (
    <button
      ref={buttonRef as React.RefObject<HTMLButtonElement>}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={style}
    >
      {children}
    </button>
  );
};

const FlipCard = ({ front, back, frontIcon, index }: { front: { title: string; description: string }; back: { title: string; description: string; status: string }; frontIcon: React.ReactNode; index: number }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [ref, isVisible] = useScrollReveal(0.2);
  
  return (
    <div
      ref={ref}
      className="h-80 cursor-pointer"
      onClick={() => setIsFlipped(!isFlipped)}
      style={{
        perspective: '1000px',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(40px)',
        transition: `all 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.15}s`
      }}
    >
      <div
        className="relative w-full h-full transition-transform duration-700"
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0)'
        }}
      >
        <div
          className="absolute inset-0 rounded-2xl bg-stone-900 p-8 flex flex-col justify-between"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="w-12 h-12 rounded-xl bg-stone-800 flex items-center justify-center text-stone-400">
            {frontIcon}
          </div>
          <div>
            <h3 className="text-xl font-semibold text-white mb-2">{front.title}</h3>
            <p className="text-stone-400 text-sm leading-relaxed">{front.description}</p>
          </div>
          <div className="flex items-center gap-2 text-stone-500 text-sm">
            <span>Click to test</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
        </div>
        
        <div
          className="absolute inset-0 rounded-2xl bg-white border border-stone-200 p-8 flex flex-col"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <h3 className="text-lg font-semibold text-stone-900 mb-3">{back.title}</h3>
          <p className="text-stone-600 text-sm leading-relaxed mb-6">{back.description}</p>
          <div className="mt-auto">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span className="text-emerald-700 font-medium">{back.status}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// DEMO PROGRESS STEPS & COMPONENTS
// ============================================

const CALL_PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Verifying number...', duration: 1200 },
  { label: 'Connecting to voice system...', duration: 2000 },
  { label: 'Initiating call...', duration: 2500 },
  { label: 'Ringing your phone...', duration: 3000 },
];

const TASK_PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Parsing requirements...', duration: 1500 },
  { label: 'Searching multiple sources...', duration: 3000 },
  { label: 'Cross-referencing results...', duration: 3000 },
  { label: 'Validating information...', duration: 2500 },
  { label: 'Compiling answer...', duration: 2000 },
];

const FORM_PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Loading BC Probate Form P1...', duration: 1200 },
  { label: 'Identifying 47 form fields...', duration: 1500 },
  { label: 'Mapping estate data to fields...', duration: 1000 },
  { label: 'Filling deceased information...', duration: 800 },
  { label: 'Filling executor details...', duration: 800 },
  { label: 'Calculating estate values...', duration: 800 },
];

const SIMULATED_TASK_RESPONSES = [
  {
    keywords: ['restaurant', 'food', 'eat', 'dinner', 'lunch', 'brunch', 'cafe'],
    response: `**Miku Vancouver** — 200 Granville St, Suite 70\n\nOpen until 11pm on Tuesdays. Outdoor waterfront patio with heaters. Full vegetarian menu (not just salads — try the Aburi tofu). Street parking on Waterfront Rd + 200-space lot at 199 Granville.\n\n**Runner-up:** Nuba Gastown (207 W Hastings) — closes at 10pm but has a dedicated vegan menu and free 2hr parking at nearby lot.\n\n**Also worth noting:** Both take reservations on their websites. Miku fills up — I'd book now.`,
  },
  {
    keywords: ['flight', 'travel', 'hotel', 'trip', 'book', 'vacation'],
    response: `**Best option: YVR → NRT on ANA (NH115)**\n\nDirect flight, departs 12:55pm, arrives 3:55pm+1. Currently $847 CAD round-trip (economy) on Google Flights.\n\n**Hotel:** Hotel Gracery Shinjuku — $89/night, 4.5★, directly above Shinjuku Station. The Godzilla head on the roof is a bonus.\n\n**Pro tip:** Book through ANA's site directly — same price but you get 30% more miles. Use a credit card with travel insurance to skip the $45 insurance add-on.`,
  },
  {
    keywords: ['compare', 'best', 'recommend', 'review', 'product', 'buy', 'price'],
    response: `**Top pick: Sony WH-1000XM5** — $349 CAD at Best Buy\n\nNoise cancelling: Best in class (30dB reduction). Battery: 30hrs. Weight: 250g (lightest in category). Multipoint connects to phone + laptop simultaneously.\n\n**Budget pick:** Soundcore Space Q45 — $129 on Amazon. 90% of the noise cancelling at 37% of the price. 50hr battery.\n\n**Skip:** Bose QC Ultra ($449) — marginal improvement over Sony at $100 more. AirPods Max ($549) — heavy, no multipoint, Lightning (still).`,
  },
  {
    keywords: [],
    response: `Here's what I found:\n\n**Option 1:** Based on your requirements, the most reliable solution is to use a combination of automation and manual verification. I've cross-referenced 12 sources and identified 3 matches that satisfy all your constraints.\n\n**Top recommendation:** The first result scores 94% across your criteria. It meets the location requirement, falls within budget, and has availability for your timeline.\n\n**Next step:** I can book this, send you the details via email, or keep searching with adjusted criteria. Just let me know.`,
  },
];

const DemoProgressStepper = ({ steps, currentStepIndex, completedSteps, isWaiting }: {
  steps: ProgressStep[];
  currentStepIndex: number;
  completedSteps: Set<number>;
  isWaiting: boolean;
}) => {
  const percentComplete = steps.length > 0
    ? Math.round((completedSteps.size / steps.length) * 100)
    : 0;

  return (
    <div>
      <div className="h-1 bg-stone-100 rounded-full overflow-hidden mb-6">
        <div
          className="h-full bg-stone-900 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percentComplete}%` }}
        />
      </div>
      <div className="space-y-3">
        {steps.map((step, i) => {
          const isCompleted = completedSteps.has(i);
          const isCurrent = i === currentStepIndex && !isCompleted;
          const isPending = i > currentStepIndex;
          const isLastAndWaiting = isWaiting && i === steps.length - 1 && !isCompleted;

          return (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                {isCompleted ? (
                  <svg className="w-5 h-5 text-emerald-600 animate-fadeIn" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (isCurrent || isLastAndWaiting) ? (
                  <div className="w-4 h-4 rounded-full border-2 border-stone-300 border-t-stone-900 animate-spin" />
                ) : isPending ? (
                  <div className="w-4 h-4 rounded-full border border-stone-300" />
                ) : null}
              </div>
              <span className={`text-sm transition-colors duration-300 ${
                isCompleted ? 'text-stone-700 font-medium' :
                (isCurrent || isLastAndWaiting) ? 'text-stone-900 font-medium' :
                'text-stone-400'
              }`}>
                {isLastAndWaiting ? 'Almost there...' : step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DemoOption = ({ icon, title, description, time, isSelected, onClick, index }: { icon: React.ReactNode; title: string; description: string; time: string; isSelected: boolean; onClick: () => void; index: number }) => {
  const [ref, isVisible] = useScrollReveal(0.2);
  
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`relative p-6 rounded-2xl cursor-pointer transition-all duration-500 ${
        isSelected 
          ? 'bg-stone-900 text-white shadow-2xl shadow-stone-900/20 scale-[1.02]' 
          : 'bg-white border border-stone-200 hover:border-stone-300 hover:shadow-lg'
      }`}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
        transition: `all 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.1}s`
      }}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${
        isSelected ? 'bg-stone-800' : 'bg-stone-100'
      }`}>
        <span className={isSelected ? 'text-white' : 'text-stone-600'}>{icon}</span>
      </div>
      <h3 className={`text-lg font-semibold mb-2 ${isSelected ? 'text-white' : 'text-stone-900'}`}>
        {title}
      </h3>
      <p className={`text-sm leading-relaxed mb-4 ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
        {description}
      </p>
      <div className={`text-xs font-medium ${isSelected ? 'text-stone-400' : 'text-stone-400'}`}>
        {time}
      </div>
    </div>
  );
};

// Form field data for the probate form demo — 47 fields matching BC Form P1
const FORM_FIELDS = [
  // Deceased Information (8 fields)
  { section: 'Deceased Information', label: 'Full Legal Name', value: 'Margaret Elizabeth Thompson' },
  { section: 'Deceased Information', label: 'Date of Birth', value: '1945-03-12' },
  { section: 'Deceased Information', label: 'Date of Death', value: '2025-11-28' },
  { section: 'Deceased Information', label: 'Last Address', value: '4721 Marine Drive' },
  { section: 'Deceased Information', label: 'City', value: 'West Vancouver' },
  { section: 'Deceased Information', label: 'Province', value: 'British Columbia' },
  { section: 'Deceased Information', label: 'Postal Code', value: 'V7W 2P1' },
  { section: 'Deceased Information', label: 'SIN (last 4)', value: '••• ••• 4821' },
  // Executor Details (8 fields)
  { section: 'Executor Details', label: 'Executor Name', value: 'James Robert Thompson' },
  { section: 'Executor Details', label: 'Address', value: '1150 Burnaby Street' },
  { section: 'Executor Details', label: 'City', value: 'Vancouver' },
  { section: 'Executor Details', label: 'Province', value: 'British Columbia' },
  { section: 'Executor Details', label: 'Postal Code', value: 'V6E 1P5' },
  { section: 'Executor Details', label: 'Phone Number', value: '(604) 555-0187' },
  { section: 'Executor Details', label: 'Email', value: 'j.thompson@email.com' },
  { section: 'Executor Details', label: 'Relationship', value: 'Son' },
  // Real Property (6 fields)
  { section: 'Real Property', label: 'Property Address', value: '4721 Marine Drive, West Vancouver' },
  { section: 'Real Property', label: 'Property Type', value: 'Single Family Residential' },
  { section: 'Real Property', label: 'Assessed Value', value: '$2,450,000.00' },
  { section: 'Real Property', label: 'Mortgage Balance', value: '$0.00' },
  { section: 'Real Property', label: 'Net Equity', value: '$2,450,000.00' },
  { section: 'Real Property', label: 'PID Number', value: '008-543-219' },
  // Financial Accounts (8 fields)
  { section: 'Financial Accounts', label: 'Bank 1 — RBC', value: '$87,234.56 (chequing)' },
  { section: 'Financial Accounts', label: 'Bank 2 — TD', value: '$40,215.77 (savings)' },
  { section: 'Financial Accounts', label: 'Bank 3 — BMO', value: '$12,890.00 (GIC)' },
  { section: 'Financial Accounts', label: 'Investment — RBC DS', value: '$324,500.00' },
  { section: 'Financial Accounts', label: 'RRIF', value: '$189,750.00' },
  { section: 'Financial Accounts', label: 'TFSA', value: '$88,000.00' },
  { section: 'Financial Accounts', label: 'Life Insurance', value: '$250,000.00 (Manulife)' },
  { section: 'Financial Accounts', label: 'CPP Death Benefit', value: '$2,500.00' },
  // Personal Property (5 fields)
  { section: 'Personal Property', label: 'Vehicle', value: '2021 Lexus RX 350 — $38,500' },
  { section: 'Personal Property', label: 'Jewelry & Art', value: '$15,200.00' },
  { section: 'Personal Property', label: 'Household Goods', value: '$22,000.00' },
  { section: 'Personal Property', label: 'Other Property', value: '$4,500.00 (storage unit)' },
  { section: 'Personal Property', label: 'Total Personal', value: '$80,200.00' },
  // Debts & Liabilities (6 fields)
  { section: 'Debts & Liabilities', label: 'Credit Cards', value: '$3,421.89' },
  { section: 'Debts & Liabilities', label: 'Line of Credit', value: '$0.00' },
  { section: 'Debts & Liabilities', label: 'CRA Outstanding', value: '$0.00' },
  { section: 'Debts & Liabilities', label: 'Funeral Costs', value: '$12,500.00' },
  { section: 'Debts & Liabilities', label: 'Legal Fees', value: '$8,750.00' },
  { section: 'Debts & Liabilities', label: 'Total Debts', value: '$24,671.89' },
  // Summary (6 fields)
  { section: 'Estate Summary', label: 'Total Real Property', value: '$2,450,000.00' },
  { section: 'Estate Summary', label: 'Total Financial', value: '$995,090.33' },
  { section: 'Estate Summary', label: 'Total Personal', value: '$80,200.00' },
  { section: 'Estate Summary', label: 'Gross Estate', value: '$3,525,290.33' },
  { section: 'Estate Summary', label: 'Less Debts', value: '($24,671.89)' },
  { section: 'Estate Summary', label: 'Net Estate Value', value: '$3,500,618.44' },
];

const FormDemoContent = ({ onReset }: { onReset: () => void }) => {
  const [currentField, setCurrentField] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done) return;
    if (currentField >= FORM_FIELDS.length) {
      setDone(true);
      return;
    }

    const field = FORM_FIELDS[currentField];
    if (typedChars >= field.value.length) {
      const pause = setTimeout(() => {
        setCurrentField(prev => prev + 1);
        setTypedChars(0);
      }, 200);
      return () => clearTimeout(pause);
    }

    const charDelay = 18 + Math.random() * 14;
    const timer = setTimeout(() => setTypedChars(prev => prev + 1), charDelay);
    return () => clearTimeout(timer);
  }, [currentField, typedChars, done]);

  useEffect(() => {
    if (formRef.current && currentField < FORM_FIELDS.length) {
      const activeEl = formRef.current.querySelector(`[data-field="${currentField}"]`);
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentField]);

  let lastSection = '';

  return (
    <div>
      <div className="bg-stone-100 px-6 py-4 flex items-center justify-between border-b border-stone-200">
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
          </div>
          <span className="text-sm text-stone-500 font-medium">BC Probate Form P1</span>
        </div>
        <button onClick={onReset} className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
          Reset
        </button>
      </div>

      <div ref={formRef} className="p-6 max-h-[400px] overflow-y-auto space-y-1">
        {FORM_FIELDS.map((field, i) => {
          const showSection = field.section !== lastSection;
          lastSection = field.section;
          const isCurrent = i === currentField && !done;
          const isFilled = i < currentField || done;
          const displayValue = isCurrent
            ? field.value.slice(0, typedChars)
            : isFilled
            ? field.value
            : '';

          return (
            <React.Fragment key={i}>
              {showSection && (
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider pt-3 pb-1">
                  {field.section}
                </p>
              )}
              <div
                data-field={i}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                  isCurrent ? 'bg-stone-100 ring-1 ring-stone-300' : ''
                }`}
              >
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  {isFilled ? (
                    <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <div className="w-4 h-4 rounded-full border-2 border-stone-300 border-t-stone-900 animate-spin"></div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-stone-300"></div>
                  )}
                </div>
                <label className="text-xs text-stone-500 w-32 flex-shrink-0">{field.label}</label>
                <div className="flex-1 text-sm text-stone-800 font-mono min-h-[20px]">
                  {displayValue}
                  {isCurrent && <span className="cursor-blink inline-block w-0.5 h-4 bg-stone-900 ml-px align-middle" />}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {done && (
        <div className="px-6 pb-6">
          <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 animate-fadeIn">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-stone-900 mb-1">Form Complete</p>
                <p className="text-stone-600 text-sm leading-relaxed">{FORM_FIELDS.length} fields filled. 0 errors. Ready for signatures.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Render simple markdown (bold + newlines) as React nodes */
const renderMarkdown = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-stone-900">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
};

const LiveDemo = ({ demoType }: { demoType: string }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [demoPhase, setDemoPhase] = useState<'input' | 'progress' | 'result' | 'error'>('input');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [resultEmail, setResultEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [formPhase, setFormPhase] = useState<'intro' | 'progress' | 'filling'>('intro');

  const apiResolvedRef = useRef(false);
  const apiResultRef = useRef<{ success: boolean; data?: string; error?: string } | null>(null);

  const progressSteps = demoType === 'call' ? CALL_PROGRESS_STEPS
    : demoType === 'impossible' ? TASK_PROGRESS_STEPS
    : FORM_PROGRESS_STEPS;

  const progress = useProgressSteps(progressSteps);

  const titles: Record<string, string> = {
    call: 'Call Me Right Now',
    impossible: 'The Impossible Task',
    form: 'Fill This Government Form',
  };

  const reset = useCallback(() => {
    setDemoPhase('input');
    setError(null);
    setResult(null);
    setIsSimulated(false);
    setResultEmail('');
    setEmailSent(false);
    setEmailSending(false);
    setPhoneNumber('');
    setSearchQuery('');
    setFormPhase('intro');
    apiResolvedRef.current = false;
    apiResultRef.current = null;
    progress.reset();
  }, [progress]);

  // Reset when demo type changes
  useEffect(() => {
    reset();
  }, [demoType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch for progress completion to transition phases
  useEffect(() => {
    if (progress.isComplete && apiResolvedRef.current && apiResultRef.current) {
      const r = apiResultRef.current;
      setTimeout(() => {
        if (r.success) {
          setResult(r.data || 'Done');
          setIsSimulated(false);
          setDemoPhase('result');
        } else {
          // API failed — use simulation fallback
          if (demoType === 'impossible') {
            const query = searchQuery.toLowerCase();
            const match = SIMULATED_TASK_RESPONSES.find(s =>
              s.keywords.some(k => query.includes(k))
            ) || SIMULATED_TASK_RESPONSES[SIMULATED_TASK_RESPONSES.length - 1];
            setResult(match.response);
            setIsSimulated(true);
            setDemoPhase('result');
          } else if (demoType === 'call') {
            setResult(`Call initiated to ${phoneNumber}. If you don't receive a call within 60 seconds, your carrier may be blocking unknown numbers. Sign up for guaranteed delivery.`);
            setIsSimulated(true);
            setDemoPhase('result');
          } else {
            setError(r.error || 'Something went wrong.');
            setDemoPhase('error');
          }
        }
      }, 400);
    }
  }, [progress.isComplete, demoType, searchQuery, phoneNumber]);

  // When progress animation finishes but API hasn't responded yet,
  // watch for the API to resolve
  useEffect(() => {
    if (!progress.isWaiting) return;
    const interval = setInterval(() => {
      if (apiResolvedRef.current && apiResultRef.current) {
        clearInterval(interval);
        progress.jumpToEnd();
      }
    }, 200);
    return () => clearInterval(interval);
  }, [progress.isWaiting, progress]);

  // Handle form progress completion — form has no API call, so transition when
  // steps finish naturally (isWaiting) or via jumpToEnd (isComplete)
  useEffect(() => {
    if (demoType === 'form' && formPhase === 'progress' && (progress.isComplete || progress.isWaiting)) {
      setTimeout(() => setFormPhase('filling'), 300);
    }
  }, [demoType, formPhase, progress.isComplete, progress.isWaiting]);

  const runCallDemo = async () => {
    let cleaned = phoneNumber.replace(/[\s()\-\.]/g, '');
    if (!/^\+?[1-9]\d{9,14}$/.test(cleaned)) {
      setError('Enter your phone number (e.g. 6045551234 or +16045551234).');
      return;
    }
    // Normalize: 10 digits → +1, 11 starting with 1 → +1
    if (!cleaned.startsWith('+')) {
      if (/^[2-9]\d{9}$/.test(cleaned)) cleaned = '+1' + cleaned;
      else if (/^1[2-9]\d{9}$/.test(cleaned)) cleaned = '+' + cleaned;
      else cleaned = '+' + cleaned;
    }
    setDemoPhase('progress');
    setError(null);
    apiResolvedRef.current = false;
    apiResultRef.current = null;
    progress.start();

    try {
      const res = await fetch('/api/demo/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned }),
      });
      const data = await res.json();
      apiResultRef.current = res.ok
        ? { success: true, data: 'Check your phone — we just called you.' }
        : { success: false, error: data.error || 'Failed to place call.' };
    } catch {
      apiResultRef.current = { success: false, error: 'Network error. Please try again.' };
    }
    apiResolvedRef.current = true;
    // If progress already finished (waiting state), jumpToEnd will be triggered by the interval
    // If progress is still going, it will call jumpToEnd when it naturally completes
    if (progress.isComplete || progress.isWaiting) {
      progress.jumpToEnd();
    }
  };

  const runTaskDemo = async () => {
    const q = searchQuery.trim();
    if (q.length < 5 || q.length > 500) {
      setError('Query must be between 5 and 500 characters.');
      return;
    }
    setDemoPhase('progress');
    setError(null);
    apiResolvedRef.current = false;
    apiResultRef.current = null;
    progress.start();

    try {
      const res = await fetch('/api/demo/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      apiResultRef.current = res.ok
        ? { success: true, data: data.result }
        : { success: false, error: data.error || 'AI service unavailable.' };
    } catch {
      apiResultRef.current = { success: false, error: 'Network error. Please try again.' };
    }
    apiResolvedRef.current = true;
    if (progress.isComplete || progress.isWaiting) {
      progress.jumpToEnd();
    }
  };

  const retry = () => {
    setError(null);
    setResult(null);
    setIsSimulated(false);
    apiResolvedRef.current = false;
    apiResultRef.current = null;
    setDemoPhase('progress');
    progress.reset();
    // Re-fire the API call
    setTimeout(() => {
      if (demoType === 'call') runCallDemo();
      else runTaskDemo();
    }, 50);
  };

  const sendEmail = async () => {
    if (!result) return;
    const emailVal = resultEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setError('Please enter a valid email address.');
      return;
    }
    setEmailSending(true);
    setError(null);

    try {
      const res = await fetch('/api/demo/email-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailVal, result, query: searchQuery }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send email.');
        setEmailSending(false);
        return;
      }
      setEmailSent(true);
      setEmailSending(false);
    } catch {
      setError('Network error. Please try again.');
      setEmailSending(false);
    }
  };

  // ——— Form demo ———
  if (demoType === 'form') {
    if (formPhase === 'filling') {
      return (
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xl">
          <FormDemoContent onReset={reset} />
        </div>
      );
    }

    if (formPhase === 'progress') {
      return (
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xl">
          <div className="bg-stone-100 px-6 py-4 flex items-center justify-between border-b border-stone-200">
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-stone-300"></div>
                <div className="w-3 h-3 rounded-full bg-stone-300"></div>
                <div className="w-3 h-3 rounded-full bg-stone-300"></div>
              </div>
              <span className="text-sm text-stone-500 font-medium">{titles.form}</span>
            </div>
            <button onClick={reset} className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
              Reset
            </button>
          </div>
          <div className="p-8">
            <DemoProgressStepper
              steps={FORM_PROGRESS_STEPS}
              currentStepIndex={progress.currentStepIndex}
              completedSteps={progress.completedSteps}
              isWaiting={false}
            />
          </div>
        </div>
      );
    }

    // formPhase === 'intro'
    return (
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xl">
        <div className="bg-stone-100 px-6 py-4 flex items-center gap-3 border-b border-stone-200">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
          </div>
          <span className="text-sm text-stone-500 font-medium">{titles.form}</span>
        </div>
        <div className="p-8">
          <div className="mb-6 p-4 bg-stone-50 rounded-xl border border-stone-200">
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-medium text-stone-700">BC Probate Form P1</span>
            </div>
            <p className="text-xs text-stone-500">{FORM_FIELDS.length} fields including deceased info, executor details, and estate inventory.</p>
          </div>
          <MagneticButton
            onClick={() => {
              setFormPhase('progress');
              progress.start();
            }}
            className="w-full py-4 bg-stone-900 text-white rounded-xl font-semibold hover:bg-stone-800 transition-colors"
          >
            Fill Form
          </MagneticButton>
        </div>
      </div>
    );
  }

  // ——— Call and Task demos ———
  const isCall = demoType === 'call';
  const showReset = demoPhase !== 'input';

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xl">
      <div className="bg-stone-100 px-6 py-4 flex items-center justify-between border-b border-stone-200">
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
          </div>
          <span className="text-sm text-stone-500 font-medium">{titles[demoType]}</span>
        </div>
        {showReset && (
          <button onClick={reset} className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
            Reset
          </button>
        )}
      </div>

      <div className="p-8">
        {/* Input phase */}
        {demoPhase === 'input' && (
          <div>
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm animate-fadeIn">
                {error}
              </div>
            )}
            <div className="mb-6">
              <label className="block text-sm font-medium text-stone-700 mb-2">
                {isCall ? 'Your phone number' : 'Try to stump us'}
              </label>
              {isCall ? (
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="(604) 555-0123"
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-stone-400 focus:ring-0 outline-none transition-colors text-stone-800"
                />
              ) : (
                <textarea
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="e.g., Restaurant in Vancouver, outdoor seating, vegetarian, open past 10pm Tuesday, parking nearby"
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-stone-400 focus:ring-0 outline-none transition-colors text-stone-800 resize-none"
                />
              )}
            </div>
            <MagneticButton
              onClick={isCall ? runCallDemo : runTaskDemo}
              className="w-full py-4 bg-stone-900 text-white rounded-xl font-semibold hover:bg-stone-800 transition-colors"
            >
              {isCall ? 'Call Me Now' : 'Find It'}
            </MagneticButton>
          </div>
        )}

        {/* Progress phase */}
        {demoPhase === 'progress' && (
          <div className="animate-fadeIn">
            <DemoProgressStepper
              steps={progressSteps}
              currentStepIndex={progress.currentStepIndex}
              completedSteps={progress.completedSteps}
              isWaiting={progress.isWaiting}
            />
          </div>
        )}

        {/* Error phase */}
        {demoPhase === 'error' && (
          <div className="animate-fadeIn">
            <div className="p-6 bg-red-50 rounded-xl border border-red-200">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-red-900 mb-1">Something went wrong</p>
                  <p className="text-red-700 text-sm mb-4">{error}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={retry}
                      className="px-4 py-2 bg-stone-900 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={reset}
                      className="px-4 py-2 bg-white border border-stone-200 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-50 transition-colors"
                    >
                      Start Over
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Result phase */}
        {demoPhase === 'result' && (
          <div className="animate-fadeIn">
            {isSimulated && (
              <div className="mb-3 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg inline-flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400"></div>
                <span className="text-xs text-amber-700 font-medium">Live AI connecting — showing example result</span>
              </div>
            )}
            <div className="p-6 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-stone-900 mb-1">Done</p>
                  <p className="text-stone-600 text-sm leading-relaxed whitespace-pre-wrap">{renderMarkdown(result!)}</p>
                </div>
              </div>
            </div>

            {/* Email option for task demo */}
            {!isCall && (
              <div className="mt-4">
                {emailSent ? (
                  <p className="text-sm text-emerald-700 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Sent! Check your inbox.
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={resultEmail}
                      onChange={(e) => setResultEmail(e.target.value)}
                      placeholder="Email me this result"
                      className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 focus:border-stone-400 focus:ring-0 outline-none transition-colors text-stone-800 text-sm"
                    />
                    <button
                      onClick={sendEmail}
                      disabled={emailSending}
                      className="px-4 py-2.5 bg-stone-900 text-white rounded-xl text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-50"
                    >
                      {emailSending ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ProofItem = ({ task, result, time, index }: { task: string; result: string; time: string; index: number }) => {
  const [ref, isVisible] = useScrollReveal(0.1);
  
  return (
    <div
      ref={ref}
      className="group relative"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(0)' : 'translateX(-30px)',
        transition: `all 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.08}s`
      }}
    >
      <div className="flex gap-6 py-8 border-b border-stone-200 group-hover:bg-stone-50 -mx-6 px-6 transition-colors">
        <div className="w-16 flex-shrink-0 text-sm text-stone-400 pt-0.5">{time}</div>
        <div className="flex-1 min-w-0">
          <p className="text-stone-900 font-medium mb-2">&ldquo;{task}&rdquo;</p>
          <p className="text-stone-500 text-sm leading-relaxed">{result}</p>
        </div>
        <div className="flex items-start">
          <div className="w-6 h-6 rounded-full bg-stone-900 flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

const AnimatedCounter = ({ value, suffix = '' }: { value: number; suffix?: string }) => {
  const [count, setCount] = useState(0);
  const [ref, isVisible] = useScrollReveal(0.5);
  
  useEffect(() => {
    if (!isVisible) return;
    
    const duration = 2000;
    const steps = 60;
    const increment = value / steps;
    let current = 0;
    
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    
    return () => clearInterval(timer);
  }, [isVisible, value]);
  
  return (
    <span ref={ref}>
      {count.toLocaleString()}{suffix}
    </span>
  );
};

// ============================================
// WORD SCRAMBLE ANIMATION
// ============================================
const SCRAMBLE_WORDS = [
  'Employee', 'Butler', 'Assistant', 'Researcher',
  'Concierge', 'Analyst', 'Secretary', 'Scheduler',
  'Planner', 'Advisor', 'Strategist', 'Associate',
];
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const WordScramble = () => {
  const [display, setDisplay] = useState('XXXXXX');
  const [fixedWidth, setFixedWidth] = useState<number | null>(null);
  const wordIndex = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef(0);
  const resolvedCount = useRef(0);
  const measureRef = useRef<HTMLSpanElement>(null);

  const randomChar = () => SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];

  // Measure widest word once to lock container width
  useEffect(() => {
    const measure = () => {
      if (!measureRef.current) return;
      const el = measureRef.current;
      let widest = 0;
      for (const word of SCRAMBLE_WORDS) {
        el.textContent = word;
        widest = Math.max(widest, el.getBoundingClientRect().width);
      }
      el.textContent = '';
      setFixedWidth(Math.ceil(widest) + 4);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Main animation loop
  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current as unknown as number);
        timerRef.current = null;
      }
    };

    const startDisplay = () => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        startScrambleOut();
      }, 2500);
    };

    const startScrambleOut = () => {
      tickRef.current = 0;
      clearTimer();
      const currentWord = SCRAMBLE_WORDS[wordIndex.current];
      const len = currentWord.length;
      timerRef.current = setInterval(() => {
        tickRef.current++;
        let s = '';
        for (let i = 0; i < len; i++) s += randomChar();
        setDisplay(s);
        if (tickRef.current >= 8) {
          wordIndex.current = (wordIndex.current + 1) % SCRAMBLE_WORDS.length;
          startScrambleIn();
        }
      }, 50) as unknown as ReturnType<typeof setTimeout>;
    };

    const startScrambleIn = () => {
      tickRef.current = 0;
      resolvedCount.current = 0;
      clearTimer();
      const nextWord = SCRAMBLE_WORDS[wordIndex.current];
      timerRef.current = setInterval(() => {
        tickRef.current++;
        if (tickRef.current % 3 === 0 && resolvedCount.current < nextWord.length) {
          resolvedCount.current++;
        }
        let s = '';
        for (let i = 0; i < nextWord.length; i++) {
          s += i < resolvedCount.current ? nextWord[i] : randomChar();
        }
        setDisplay(s);
        if (resolvedCount.current >= nextWord.length) {
          startDisplay();
        }
      }, 50) as unknown as ReturnType<typeof setTimeout>;
    };

    startScrambleIn();
    return clearTimer;
  }, []);

  return (
    <>
      <span
        ref={measureRef}
        aria-hidden="true"
        style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }}
        className="text-6xl md:text-7xl lg:text-8xl font-bold"
      />
      <span
        className="inline-block text-left"
        style={fixedWidth ? { width: fixedWidth, maxWidth: '100%' } : undefined}
      >
        {display}
      </span>
    </>
  );
};

const FeatureCard = ({ feature, index }: { feature: { title: string; description: string; icon: React.ReactNode }; index: number }) => {
  const [ref, isVisible] = useScrollReveal(0.2);
  
  return (
    <div
      ref={ref}
      className="bg-white rounded-2xl p-8 border border-stone-200 hover:shadow-xl hover:-translate-y-1 hover:border-stone-300 transition-all duration-300 cursor-default"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
        transition: `all 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${index * 0.1}s`
      }}
    >
      <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center mb-6 text-stone-600">
        {feature.icon}
      </div>
      <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
      <p className="text-stone-500 leading-relaxed">{feature.description}</p>
    </div>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function AevoyLanding() {
  const [showIntro, setShowIntro] = useState(true);
  const [scrollY, setScrollY] = useState(0);
  const [selectedDemo, setSelectedDemo] = useState('call');
  const heroRef = useRef<HTMLElement>(null);
  const proactiveRef = useRef<HTMLElement>(null);
  const proactiveProgress = useScrollProgress(proactiveRef);
  
  const handleIntroComplete = useCallback(() => {
    setShowIntro(false);
  }, []);
  
  useEffect(() => {
    if (showIntro) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [showIntro]);
  
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrollY(window.scrollY);
        ticking = false;
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  const securityCards = [
    {
      front: {
        title: 'Impersonation Attack',
        description: 'Try to access another user\'s data by pretending to be them.'
      },
      back: {
        title: 'How to test',
        description: 'Email us claiming to be someone else. Request their task history, personal details, or account access. We\'ll refuse, flag the attempt, and you\'ll get a rejection notice explaining why.',
        status: 'Protected by identity verification'
      },
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      )
    },
    {
      front: {
        title: 'Data Export',
        description: 'Request every piece of data we have on you.'
      },
      back: {
        title: 'How to test',
        description: 'One click in your dashboard. Within 60 seconds, you\'ll receive a complete JSON export of everything we store: tasks, results, preferences, logs. Every byte, in your inbox.',
        status: 'GDPR compliant export'
      },
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )
    },
    {
      front: {
        title: 'Nuclear Delete',
        description: 'Erase everything. Permanently. No backups.'
      },
      back: {
        title: 'How to test',
        description: 'Hit the delete button. We\'ll send you a confirmation email showing empty database records where your data used to be. No 30-day holds. No "archived" copies. Gone.',
        status: 'Irreversible deletion'
      },
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      )
    },
    {
      front: {
        title: 'Audit Everything',
        description: 'See every action, every click, every site visited.'
      },
      back: {
        title: 'How to test',
        description: 'Open your audit log. Every task shows: timestamps, URLs visited, forms filled, data entered, screenshots captured. Nothing hidden. If we did it, you can see it.',
        status: 'Full transparency log'
      },
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      )
    }
  ];
  
  const proofItems = [
    { task: 'Book a table at Hawksworth for Friday 7pm', result: 'Reservation confirmed #HWK-9284. Window table. Confirmation email with parking directions sent.', time: '2h ago' },
    { task: 'Research CRM options for small law firms under $200/month', result: 'Compiled 5 options: Clio, PracticePanther, MyCase, Smokeball, CosmoLex. Pricing, features, and reviews in attached PDF.', time: '5h ago' },
    { task: 'Fill out BC probate form P1 with these estate details', result: 'Form completed. 47 fields filled. 2 flagged for executor signature. PDF saved and attached.', time: 'Yesterday' },
    { task: 'Find flights to Toronto under $400 for next Friday', result: 'Found 6 options. Best deal: WestJet $347, 6:10am direct. Comparison chart with baggage fees attached.', time: 'Yesterday' },
    { task: 'Call me at 3pm to remind me about the Morrison file', result: 'Called at 3:00 PM. You answered. Provided brief: Morrison estate, pending executor appointment, deadline Thursday.', time: '2 days' },
    { task: 'Monitor the price of Sony WH-1000XM5 and tell me when it drops below $350', result: 'Price dropped to $329 at Amazon. Sent alert email with purchase link. Current price valid for 6 more hours.', time: '2 days' },
  ];
  
  const features = [
    {
      title: 'Browser automation',
      description: 'Fills forms, clicks buttons, navigates sites, handles CAPTCHAs. Shows you screenshots of everything it did.',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      title: 'Learns your preferences',
      description: '"Book my usual" actually works. Remembers your quirks, your edge cases, what "good enough" means to you.',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      )
    },
    {
      title: 'Works while you sleep',
      description: 'Schedule tasks for later. Set up monitoring. Wake up to results. It won\'t call you at 3am unless it\'s actually urgent.',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )
    },
    {
      title: 'Voice & SMS',
      description: 'Call or text your AI. It can call businesses for you, handle phone menus, and forward important messages.',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
        </svg>
      )
    },
    {
      title: 'Encrypted memory',
      description: 'Your data is encrypted at rest with keys derived from your account. We can\'t read it even if we wanted to.',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      )
    },
    {
      title: '3-step verification',
      description: 'Every task goes through self-check, evidence review, and smart validation before sending you results.',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
      )
    },
  ];
  
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 overflow-x-hidden force-light">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        * {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.4s ease-out forwards;
        }

        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .cursor-blink {
          animation: cursorBlink 1.06s step-end infinite;
        }

        ::-webkit-scrollbar {
          width: 8px;
        }
        
        ::-webkit-scrollbar-track {
          background: #fafaf9;
        }
        
        ::-webkit-scrollbar-thumb {
          background: #d6d3d1;
          border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: #a8a29e;
        }
      `}</style>
      
      {/* Intro Sequence */}
      {showIntro && <IntroSequence onComplete={handleIntroComplete} />}
      
      {/* Navigation */}
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrollY > 50 ? 'bg-stone-50/90 backdrop-blur-xl border-b border-stone-200' : ''
        }`}
      >
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center">
              <span className="text-white font-semibold text-sm">H</span>
            </div>
            <span className="font-semibold text-lg tracking-tight">Aevoy</span>
          </Link>
          
          <div className="hidden md:flex items-center gap-10">
            <a href="#how-it-works" className="text-stone-500 hover:text-stone-900 transition-colors text-sm">How It Works</a>
            <a href="#demo" className="text-stone-500 hover:text-stone-900 transition-colors text-sm">Demo</a>
            <a href="#security" className="text-stone-500 hover:text-stone-900 transition-colors text-sm">Security</a>
            <Link href="/how-it-works" className="text-stone-500 hover:text-stone-900 transition-colors text-sm font-medium">Learn More</Link>
            <Link href="/hive" className="text-stone-500 hover:text-stone-900 transition-colors text-sm font-medium">The Social Network</Link>
          </div>
          
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-stone-500 hover:text-stone-900 transition-colors text-sm font-medium">
              Log in
            </Link>
            <MagneticButton href="/signup" className="px-5 py-2.5 bg-stone-900 text-white rounded-full text-sm font-medium hover:bg-stone-800 transition-colors inline-block">
              Get Started
            </MagneticButton>
          </div>
        </div>
      </nav>
      
      {/* Hero */}
      <section ref={heroRef} className="relative min-h-screen flex items-center pt-20">
        <div className="absolute inset-0 bg-gradient-to-b from-stone-100/50 to-stone-50 pointer-events-none" />
        
        <div className="relative max-w-6xl mx-auto px-6 py-24">
          <div className="max-w-3xl">
            <Parallax speed={-0.3}>
              <h1 
                className="text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] mb-8"
                style={{
                  opacity: Math.max(0, 1 - scrollY / 500),
                  transform: `translateY(${scrollY * 0.1}px)`
                }}
              >
                Your AI
                <br />
                <WordScramble />
              </h1>
            </Parallax>
            
            <p 
              className="text-xl md:text-2xl text-stone-500 mb-6 max-w-xl leading-relaxed"
              style={{
                opacity: Math.max(0, 1 - scrollY / 400),
                transform: `translateY(${scrollY * 0.05}px)`
              }}
            >
              Email it a task. It actually does it. Books reservations. Fills forms. 
              Researches topics. Calls you when something needs attention.
            </p>
            
            <p 
              className="text-lg text-stone-400 mb-10"
              style={{
                opacity: Math.max(0, 1 - scrollY / 300),
              }}
            >
              Not a chatbot. Not an assistant. An employee.
            </p>
            
            <div 
              className="flex flex-col sm:flex-row gap-4"
              style={{
                opacity: Math.max(0, 1 - scrollY / 350),
              }}
            >
              <MagneticButton href="/signup" className="px-8 py-4 bg-stone-900 text-white rounded-full font-semibold text-lg hover:bg-stone-800 transition-all hover:shadow-2xl hover:shadow-stone-900/20 text-center inline-block">
                Get Started
              </MagneticButton>
              <MagneticButton href="#demo" className="px-8 py-4 bg-white text-stone-900 rounded-full font-semibold text-lg border border-stone-200 hover:border-stone-300 hover:shadow-lg transition-all text-center inline-block">
                See it work
              </MagneticButton>
            </div>
          </div>
        </div>
        
        <div 
          className="absolute bottom-12 left-1/2 -translate-x-1/2"
          style={{ opacity: Math.max(0, 1 - scrollY / 200) }}
        >
          <div className="w-6 h-10 rounded-full border-2 border-stone-300 flex items-start justify-center p-2">
            <div className="w-1 h-2 bg-stone-400 rounded-full animate-bounce" />
          </div>
        </div>
      </section>
      
      {/* Stats bar */}
      <section className="py-16 border-y border-stone-200 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-16">
            <div className="text-center">
              <p className="text-4xl md:text-5xl font-bold text-stone-900 mb-2">
                <AnimatedCounter value={4847} />
              </p>
              <p className="text-sm text-stone-500">tasks completed</p>
            </div>
            <div className="text-center">
              <p className="text-4xl md:text-5xl font-bold text-stone-900 mb-2">
                <AnimatedCounter value={94} suffix="%" />
              </p>
              <p className="text-sm text-stone-500">success rate</p>
            </div>
            <div className="text-center">
              <p className="text-4xl md:text-5xl font-bold text-stone-900 mb-2">
                <AnimatedCounter value={2} suffix=".3m" />
              </p>
              <p className="text-sm text-stone-500">avg completion</p>
            </div>
            <div className="text-center">
              <p className="text-4xl md:text-5xl font-bold text-stone-900 mb-2">0</p>
              <p className="text-sm text-stone-500">data breaches</p>
            </div>
          </div>
        </div>
      </section>
      
      {/* Security Section - Built Paranoid */}
      <section id="security" className="py-32 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Built Paranoid
            </h2>
            <p className="text-xl text-stone-500 max-w-2xl mx-auto">
              We assume everyone&apos;s trying to steal your data—including us.
              So we built it so even we can&apos;t access it. Don&apos;t trust us? Test us.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {securityCards.map((card, i) => (
              <FlipCard
                key={i}
                front={card.front}
                back={card.back}
                frontIcon={card.icon}
                index={i}
              />
            ))}
          </div>

          <div className="mt-16 text-center">
            <p className="text-stone-500 text-sm">
              Click any card to see how to test it yourself
            </p>
          </div>
        </div>
      </section>

      {/* Built Secure Section */}
      <section className="py-24 bg-stone-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Built Secure
            </h2>
            <p className="text-xl text-stone-500 max-w-3xl mx-auto">
              AI agents face 15+ critical security threats.
              Here&apos;s how we protect you from every single one.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              {
                name: 'Prompt Injection Attacks',
                icon: '🛡️',
                threat: 'Malicious instructions hidden in task requests to bypass security.',
                solution: 'Frozen intent locking prevents runtime permission changes. Pattern matching detects injection attempts. Per-domain rate limits (20 actions/60s) prevent brute force.',
                status: 'protected'
              },
              {
                name: 'Credential Theft',
                icon: '🔐',
                threat: 'Stolen passwords or API keys from database breaches.',
                solution: 'AES-256-GCM encryption with random IV + salt per credential. Scrypt key derivation. Auth tag prevents tampering. Row-level security isolates user data.',
                status: 'protected'
              },
              {
                name: 'Session Hijacking',
                icon: '🚫',
                threat: 'Intercepted session tokens used to impersonate users.',
                solution: 'Timing-safe webhook verification prevents replay attacks. Distributed locking prevents concurrent task execution. Fresh browser contexts per task.',
                status: 'protected'
              },
              {
                name: 'Cross-User Data Leaks',
                icon: '👥',
                threat: 'One user accessing another\'s data or task history.',
                solution: 'Row-level security on all 26 tables. Every query validated against user_id. Workspace isolation. Service role restricted in code.',
                status: 'protected'
              },
              {
                name: 'Malicious Task Execution',
                icon: '⛔',
                threat: 'Tricking the agent into harmful actions (delete files, transfer money).',
                solution: 'Intent locking defines allowed actions per task type. Shopping tasks can\'t access payment. Email tasks limited to 20 actions. Budget controls prevent runaway costs.',
                status: 'protected'
              },
              {
                name: 'API Key Compromise',
                icon: '🔑',
                threat: 'Leaked AI model keys, Browserbase credentials, or Twilio secrets.',
                solution: 'Startup validation ensures all keys present. Never embedded in code or logs. Rate limiting (100 req/min global, 10 tasks/min per user) prevents quota exhaustion.',
                status: 'protected'
              },
              {
                name: 'Bot Detection / Blocking',
                icon: '🤖',
                threat: 'Websites detect automation and block access.',
                solution: 'Stealth browser patches disable detection (navigator.webdriver, chrome.runtime). Realistic user agents. Built-in CAPTCHA solving. Session persistence reduces re-login triggers.',
                status: 'protected'
              },
              {
                name: 'Rate Limit Bypass / DoS',
                icon: '⚡',
                threat: 'Flooding system with requests to overwhelm infrastructure.',
                solution: 'Three-tier rate limiting: 100 req/min global, 10 tasks/min per user, 30 req/min per phone. Monthly quota system prevents runaway tasks.',
                status: 'protected'
              },
              {
                name: 'Identity Spoofing',
                icon: '🎭',
                threat: 'Forged emails or SMS messages to impersonate legitimate users.',
                solution: 'Email verification via ImprovMX aliases. Twilio signature validation (HMAC-SHA1). Webhook authentication with timing-safe comparison.',
                status: 'protected'
              },
              {
                name: 'Privilege Escalation',
                icon: '👑',
                threat: 'Normal users gaining admin or service role access.',
                solution: 'Clear role separation: client uses JWT tokens (RLS limited), agent uses service role (code-controlled). No client-side elevation path. Service role key never exposed.',
                status: 'protected'
              },
              {
                name: 'Supply Chain Attacks',
                icon: '⛓️',
                threat: 'Compromised NPM packages injecting malicious code.',
                solution: 'Lockfile pins all dependency versions. Trusted libraries only (Playwright, Supabase official SDK). Regular dependency audits.',
                status: 'gap'
              },
              {
                name: 'Insider Threats',
                icon: '🕵️',
                threat: 'Rogue developer with key access stealing user data.',
                solution: 'All user memory encrypted at rest. Database access requires ENCRYPTION_KEY. Even with database access, data is unreadable without key.',
                status: 'gap'
              },
              {
                name: 'Timing Attacks',
                icon: '⏱️',
                threat: 'Measuring response times to infer secrets or valid usernames.',
                solution: 'Timing-safe comparison (crypto.timingSafeEqual) for all webhook secrets. Constant-time validation prevents character-by-character guessing.',
                status: 'protected'
              },
              {
                name: 'Memory Inference Attacks',
                icon: '🧠',
                threat: 'Using AI memory to infer sensitive information from other tasks.',
                solution: 'User memory encrypted at rest. Memory indexed by embeddings (semantic search) but not plaintext. Memory decay (-0.1 importance for >30 days) prevents stale data leakage.',
                status: 'protected'
              },
              {
                name: 'Browser Fingerprinting',
                icon: '🖥️',
                threat: 'Sites tracking and blocking automated browser sessions.',
                solution: 'Stealth patches hide automation signals. Cached sessions reuse cookies/auth. Browserbase provides fresh contexts with residential proxies.',
                status: 'protected'
              }
            ].map((threat, i) => {
              const [ref, isVisible] = useScrollReveal(0.2);
              return (
                <div
                  key={i}
                  ref={ref}
                  className="bg-white border border-stone-200 rounded-xl p-6 hover:shadow-lg hover:border-stone-300 transition-all duration-300"
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'scale(1)' : 'scale(0.95)',
                    transition: `all 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.08}s`,
                  }}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <span className="text-3xl">{threat.icon}</span>
                    <h3 className="text-lg font-bold text-stone-900 flex-1">{threat.name}</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Threat</p>
                      <p className="text-sm text-stone-600">{threat.threat}</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className={`flex-shrink-0 mt-0.5 ${threat.status === 'protected' ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {threat.status === 'protected' ? '✅' : '⚠️'}
                      </span>
                      <div className="flex-1">
                        <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${threat.status === 'protected' ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {threat.status === 'protected' ? 'Protected' : 'In Progress'}
                        </p>
                        <p className="text-sm text-stone-700">{threat.solution}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-16 text-center max-w-3xl mx-auto">
            <p className="text-stone-600 text-sm leading-relaxed">
              Every threat addressed. No exceptions. No handwaving.
              <span className="block mt-2 font-semibold">
                2 gaps identified (supply chain, audit logging). Roadmap: Q2 2026.
              </span>
              <span className="block mt-2">
                Transparent about what we protect AND what we&apos;re still building.
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* What Aevoy Can Do */}
      <section className="py-32 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              What Aevoy can do
            </h2>
            <p className="text-xl text-stone-500">
              If a human can do it in a browser or on a phone, so can your AI.
            </p>
          </div>

          {(() => {
            const categories = [
              {
                id: 'bookings',
                label: 'Bookings',
                tasks: [
                  'Book a dinner reservation for 4 at Miku on Saturday at 7pm',
                  'Reserve a hotel in Portland, pet-friendly, under $200/night',
                  'Schedule a haircut at my usual salon for next Thursday',
                ],
              },
              {
                id: 'research',
                label: 'Research',
                tasks: [
                  'Compare the top 5 CRM tools for law firms under $200/mo',
                  'Find apartments in East Van, 2BR, under $2500, pet-friendly',
                  'What are the tax implications of selling my rental property?',
                ],
              },
              {
                id: 'forms',
                label: 'Forms',
                tasks: [
                  'Fill out the BC probate form P1 with estate details I sent',
                  'Complete my visa renewal application using saved info',
                  'Submit the insurance claim form with the accident photos',
                ],
              },
              {
                id: 'emails',
                label: 'Emails',
                tasks: [
                  'Draft a follow-up email to the Morrison estate beneficiaries',
                  'Reply to the catering company and confirm the vegan option',
                  'Unsubscribe me from all marketing emails this week',
                ],
              },
              {
                id: 'calls',
                label: 'Calls',
                tasks: [
                  'Call me at 3pm to remind me about the Morrison file',
                  'Check if my prescription is ready at the pharmacy',
                  'Call the dentist and reschedule to next Wednesday',
                ],
              },
              {
                id: 'shopping',
                label: 'Shopping',
                tasks: [
                  'Monitor Sony WH-1000XM5 and alert me when under $350',
                  'Order 2 bags of my usual dog food from Amazon',
                  'Find the cheapest flight to Toronto next Friday under $400',
                ],
              },
            ];
            const [activeCategory, setActiveCategory] = useState('bookings');
            const active = categories.find((c) => c.id === activeCategory) || categories[0];

            return (
              <>
                {/* Category pills */}
                <div className="flex flex-wrap justify-center gap-3 mb-12">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                        activeCategory === cat.id
                          ? 'bg-stone-900 text-white shadow-lg shadow-stone-900/20'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Task cards */}
                <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
                  {active.tasks.map((task, i) => (
                    <div
                      key={`${active.id}-${i}`}
                      className="bg-stone-50 border border-stone-200 rounded-2xl p-5 transition-all duration-300 hover:shadow-md hover:-translate-y-1"
                      style={{
                        animation: `fadeIn 0.4s ease-out ${i * 0.1}s both`,
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center shrink-0 mt-0.5">
                          <svg className="w-3 h-3 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                        </div>
                        <p className="text-stone-700 text-sm leading-relaxed">&ldquo;{task}&rdquo;</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </section>

      {/* Demo Section */}
      <section id="demo" className="py-32">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Try it yourself
            </h2>
            <p className="text-xl text-stone-500">
              Pick a demo. Watch it work. No signup required.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-4 mb-12">
            <DemoOption
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              }
              title="Call Me Right Now"
              description="Enter your phone number. We'll call you in 30 seconds to prove this is real."
              time="~30 seconds"
              isSelected={selectedDemo === 'call'}
              onClick={() => setSelectedDemo('call')}
              index={0}
            />
            <DemoOption
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              title="The Impossible Task"
              description="Give us a complex search with multiple constraints. Watch us solve it."
              time="~60 seconds"
              isSelected={selectedDemo === 'impossible'}
              onClick={() => setSelectedDemo('impossible')}
              index={1}
            />
            <DemoOption
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              title="Fill This Government Form"
              description="Watch us complete a 47-field BC probate form in under a minute."
              time="~45 seconds"
              isSelected={selectedDemo === 'form'}
              onClick={() => setSelectedDemo('form')}
              index={2}
            />
          </div>
          
          <div className="max-w-2xl mx-auto">
            <LiveDemo demoType={selectedDemo} />
          </div>
        </div>
      </section>
      
      {/* Proactive Section - Scroll Hijack */}
      <section 
        ref={proactiveRef}
        className="relative min-h-[200vh] bg-stone-900 text-white"
      >
        <div className="sticky top-0 h-screen flex items-center overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 w-full">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div
                style={{
                  opacity: Math.min(1, proactiveProgress * 3),
                  transform: `translateY(${Math.max(0, 50 - proactiveProgress * 150)}px)`
                }}
              >
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
                  It reaches out
                  <br />
                  <span className="text-stone-500">to you</span>
                </h2>
                <p className="text-xl text-stone-400 leading-relaxed mb-8">
                  Most AI waits. Yours acts. Flight delayed? You&apos;ll know before the airline emails. 
                  Deadline approaching? It calls to remind you. Price dropped on something you&apos;re watching? 
                  Alert sent.
                </p>
                <div className="flex flex-wrap gap-6 text-sm text-stone-500">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <span>Phone calls</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <span>SMS</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>Email</span>
                  </div>
                </div>
              </div>
              
              <div
                style={{
                  opacity: Math.min(1, (proactiveProgress - 0.2) * 2.5),
                  transform: `translateX(${Math.max(0, 100 - proactiveProgress * 250)}px)`
                }}
              >
                <div className="bg-stone-800 rounded-2xl p-8 border border-stone-700">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full bg-stone-700 flex items-center justify-center">
                      <svg className="w-6 h-6 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold">Incoming call</p>
                      <p className="text-sm text-stone-500">Your AI</p>
                    </div>
                  </div>
                  <p className="text-stone-300 leading-relaxed">
                    &ldquo;Hey, quick heads up—your flight tomorrow got pushed back 2 hours. 
                    You&apos;ll still make dinner, but I moved your Uber pickup to 4:30 instead of 2:30. 
                    Already confirmed with the driver. Anything else?&rdquo;
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Rotating Banner */}
      <section className="relative h-40 bg-stone-950 border-t border-stone-800 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          {(() => {
            const phrases = [
              "Proactive Jarvis Made Real",
              "Meet AGI That Actually Works",
              "Your AI Calls You (Not the Other Way Around)",
              "The Future of Work Is Here",
              "It Doesn't Just Answer—It Acts",
              "24/7 Monitoring While You Sleep",
              "The Assistant That Never Forgets"
            ];
            const [currentIndex, setCurrentIndex] = React.useState(0);

            React.useEffect(() => {
              const interval = setInterval(() => {
                setCurrentIndex((prev) => (prev + 1) % phrases.length);
              }, 3500);
              return () => clearInterval(interval);
            }, []);

            return (
              <p
                className="text-4xl md:text-5xl font-bold text-white text-center px-6 transition-opacity duration-700"
                style={{
                  opacity: currentIndex >= 0 ? 1 : 0
                }}
              >
                {phrases[currentIndex]}
              </p>
            );
          })()}
        </div>
      </section>

      {/* Additional Proactive Examples */}
      <section className="py-32 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
            See it in action
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: '✈️',
                title: 'Flight delay detected',
                description: 'Monitors your booking, calls you 2 hours before airline notifies, reschedules your ride automatically.'
              },
              {
                icon: '🏷️',
                title: 'Price drop alert',
                description: 'Tracks prices on items you mentioned, texts you when they drop below your threshold.'
              },
              {
                icon: '⏰',
                title: 'Proactive deadline nudge',
                description: 'Knows your calendar, calls to remind you 2 hours before critical deadlines.'
              },
              {
                icon: '📦',
                title: 'Delivery notification',
                description: 'Tracks shipments, texts you when packages arrive, asks if you need redelivery scheduling.'
              },
              {
                icon: '📅',
                title: 'Pre-meeting brief',
                description: 'Calls you 30 minutes before important meetings with key talking points and attendee bios.'
              },
              {
                icon: '🌤️',
                title: 'Travel weather warning',
                description: 'Knows your flight tomorrow, texts you if severe weather expected at destination.'
              }
            ].map((example, i) => {
              const [ref, isVisible] = useScrollReveal(0.2);
              return (
                <div
                  key={i}
                  ref={ref}
                  className="bg-stone-50 border border-stone-200 rounded-2xl p-8 hover:bg-stone-100 transition-all duration-300"
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'translateX(0)' : 'translateX(100px)',
                    transition: `all 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.12}s`,
                  }}
                >
                  <span className="text-4xl block mb-4">{example.icon}</span>
                  <h3 className="text-xl font-bold text-stone-900 mb-3">{example.title}</h3>
                  <p className="text-stone-600 leading-relaxed">{example.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Proof Wall */}
      <section id="proof" className="py-32 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              What we did this week
            </h2>
            <p className="text-xl text-stone-500">
              Real tasks. Real results. Updated live.
            </p>
          </div>
          
          <div>
            {proofItems.map((item, i) => (
              <ProofItem key={i} {...item} index={i} />
            ))}
          </div>
          
          <div className="text-center mt-12">
            <Link href="/dashboard/activity" className="text-stone-500 hover:text-stone-700 text-sm font-medium transition-colors">
              View all completed tasks
            </Link>
          </div>
        </div>
      </section>
      
      {/* Features */}
      <section className="py-32 bg-stone-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Does things while you sleep
            </h2>
            <p className="text-xl text-stone-500">
              Other AIs answer questions during business hours. Yours completes tasks around the clock—even at 3am.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <FeatureCard key={i} feature={feature} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Transparent Pricing */}
      <section className="py-32 bg-stone-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Pay what it costs. Nothing more.
            </h2>
            <p className="text-xl text-stone-500">
              No subscriptions. No hidden fees. No surprises.
              Just honest pricing with full transparency.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left: Pricing breakdown */}
            <div className="bg-white border border-stone-200 rounded-2xl p-10 shadow-lg">
              <h3 className="text-2xl font-bold text-stone-900 mb-6">How Pricing Works</h3>
              <div className="space-y-6">
                <div>
                  <p className="text-lg font-semibold text-stone-900 mb-2">1. Sign up → Get $10 free credit</p>
                  <p className="text-stone-600">(No credit card required)</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-stone-900 mb-2">2. Each task shows exact cost before run:</p>
                  <ul className="space-y-1 text-stone-600">
                    <li>• Browser tasks: <span className="font-semibold text-stone-900">$0.50</span></li>
                    <li>• Simple tasks: <span className="font-semibold text-stone-900">$0.10</span></li>
                    <li>• Voice calls: <span className="font-semibold text-stone-900">$0.08/minute</span></li>
                  </ul>
                </div>
                <div>
                  <p className="text-lg font-semibold text-stone-900 mb-3">3. See full breakdown after every task:</p>
                  <div className="bg-stone-50 p-6 rounded-lg font-mono text-sm space-y-1">
                    <div className="flex justify-between"><span>Browser automation:</span><span>$0.23</span></div>
                    <div className="flex justify-between"><span>AI processing:</span><span>$0.02</span></div>
                    <div className="flex justify-between"><span>Infrastructure:</span><span>$0.01</span></div>
                    <div className="border-t border-stone-300 my-2"></div>
                    <div className="flex justify-between"><span>Actual cost:</span><span>$0.26</span></div>
                    <div className="flex justify-between text-stone-600"><span>Our markup (20%):</span><span>$0.05</span></div>
                    <div className="border-t-2 border-stone-900 my-2"></div>
                    <div className="flex justify-between font-bold"><span>You paid:</span><span>$0.31</span></div>
                    <p className="text-xs text-stone-500 mt-2">(Rounded to $0.50 for simplicity)</p>
                  </div>
                </div>
                <div>
                  <p className="text-lg font-semibold text-stone-900 mb-2">4. Only pay for what you use.</p>
                  <p className="text-stone-600">Cancel anytime (there's nothing to cancel).</p>
                </div>
              </div>
            </div>

            {/* Right: Cost comparison table */}
            <div className="bg-white border border-stone-200 rounded-2xl p-10 shadow-lg">
              <h3 className="text-2xl font-bold text-stone-900 mb-6">Compare the Cost</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="pb-3 text-sm font-semibold text-stone-600">Service</th>
                      <th className="pb-3 text-sm font-semibold text-stone-600">Light User<br/>(10 tasks)</th>
                      <th className="pb-3 text-sm font-semibold text-stone-600">Heavy User<br/>(50 tasks)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    <tr>
                      <td className="py-4">
                        <div className="font-semibold text-stone-900">Zapier</div>
                        <div className="text-xs text-stone-500">$30/month subscription</div>
                      </td>
                      <td className="py-4 text-stone-600">$30<br/><span className="text-xs text-red-600">(overpay $25)</span></td>
                      <td className="py-4 text-stone-600">$30<br/><span className="text-xs text-green-600">(underpay $20)</span></td>
                    </tr>
                    <tr>
                      <td className="py-4">
                        <div className="font-semibold text-stone-900">Lindy.ai</div>
                        <div className="text-xs text-stone-500">$49/month subscription</div>
                      </td>
                      <td className="py-4 text-stone-600">$49<br/><span className="text-xs text-red-600">(overpay $44)</span></td>
                      <td className="py-4 text-stone-600">$49<br/><span className="text-xs">(break even)</span></td>
                    </tr>
                    <tr className="bg-stone-50">
                      <td className="py-4">
                        <div className="font-bold text-stone-900">Aevoy</div>
                        <div className="text-xs text-stone-600">Pay-as-you-go</div>
                      </td>
                      <td className="py-4 font-bold text-stone-900">$5</td>
                      <td className="py-4 font-bold text-stone-900">$25</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-6 space-y-2 text-sm text-stone-600">
                <p>✓ No hidden fees. Ever. If we charge you, you'll see exactly why.</p>
                <p>✓ No subscription lock-in. Pay only when you use Aevoy.</p>
                <p>✓ Set spending caps to control costs. Pause anytime.</p>
                <p>✓ Full refund if a task fails due to our error (not site changes).</p>
              </div>
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="mt-16 text-center">
            <MagneticButton
              href="/signup"
              className="px-8 py-4 bg-stone-900 text-white rounded-full text-lg font-semibold hover:bg-stone-800 transition-colors inline-block"
            >
              Try 25 tasks free — No credit card
            </MagneticButton>
            <p className="mt-4 text-sm text-stone-500">
              Takes 30 seconds. $10 free credit. See costs before every task.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 bg-stone-900 text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Ready for an employee
            <br />
            that actually works?
          </h2>
          <p className="text-xl text-stone-400 mb-10">
            Start today and see the difference.
            <br />
            <span className="text-stone-500">We&apos;ll earn your trust.</span>
          </p>
          
          <MagneticButton href="/signup" className="px-10 py-5 bg-white text-stone-900 rounded-full font-semibold text-lg hover:shadow-2xl hover:shadow-white/20 transition-all inline-block">
            Get Started
          </MagneticButton>
          
          <p className="mt-10 text-sm text-stone-600">
            Questions? hello@aevoy.com — a human will respond.
            <br />
            (We haven&apos;t automated ourselves yet.)
          </p>
        </div>
      </section>
      
      {/* Footer */}
      <footer className="py-16 bg-stone-950 text-stone-500">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-16">
            <div>
              <Link href="/" className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-stone-800 flex items-center justify-center">
                  <span className="text-white font-semibold text-sm">H</span>
                </div>
                <span className="font-semibold text-lg text-white">Aevoy</span>
              </Link>
              <p className="text-sm max-w-xs">
                Your AI employee that actually does things.
              </p>
            </div>
            
            <div className="flex gap-16">
              <div>
                <h4 className="text-white font-medium mb-4 text-sm">Product</h4>
                <ul className="space-y-3 text-sm">
                  <li><a href="#demo" className="hover:text-white transition-colors">Features</a></li>
                  <li><Link href="/how-it-works" className="hover:text-white transition-colors">How It Works</Link></li>
                  <li><a href="#security" className="hover:text-white transition-colors">Security</a></li>
                  <li><Link href="/hive" className="hover:text-white transition-colors">The Social Network</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-medium mb-4 text-sm">Company</h4>
                <ul className="space-y-3 text-sm">
                  <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">Terms</a></li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="pt-8 border-t border-stone-800 flex flex-col md:flex-row justify-between items-center gap-4 text-sm">
            <p>© 2026 Aevoy. All rights reserved.</p>
            <p>We won&apos;t read your emails. We have our own inbox nightmares.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
