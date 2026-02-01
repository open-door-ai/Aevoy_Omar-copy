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
  const [showCursor, setShowCursor] = useState(true);
  
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
    setShowCursor(false);
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
  
  // Cursor blink
  useEffect(() => {
    if (!showCursor || phase >= 4) return;
    const blinkInterval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 530);
    return () => clearInterval(blinkInterval);
  }, [phase]);
  
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
            showCursor && phase < 4 ? 'opacity-100' : 'opacity-0'
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
  
  useEffect(() => {
    const handleScroll = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const elementHeight = ref.current.offsetHeight;
      
      const start = windowHeight;
      const end = -elementHeight;
      const current = rect.top;
      const prog = Math.max(0, Math.min(1, (start - current) / (start - end)));
      
      setProgress(prog);
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [ref]);
  
  return progress;
};

// ============================================
// REUSABLE COMPONENTS
// ============================================

const Parallax = ({ children, speed = 0.5, className = '' }: { children: React.ReactNode; speed?: number; className?: string }) => {
  const [offset, setOffset] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleScroll = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const scrolled = window.innerHeight - rect.top;
      setOffset(scrolled * speed * 0.1);
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [speed]);
  
  return (
    <div ref={ref} className={className}>
      <div style={{ transform: `translateY(${offset}px)` }}>
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

interface DemoStep {
  action: string;
  duration: number;
}

interface Demo {
  title: string;
  inputLabel: string;
  inputPlaceholder: string | null;
  steps: DemoStep[];
  result: string;
}

const LiveDemo = ({ demoType }: { demoType: string }) => {
  const [step, setStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  const demos: Record<string, Demo> = {
    call: {
      title: 'Call Me Right Now',
      inputLabel: 'Your phone number',
      inputPlaceholder: '+1 (604) 555-0123',
      steps: [
        { action: 'Verifying number...', duration: 800 },
        { action: 'Connecting to voice system...', duration: 1000 },
        { action: 'Initiating call...', duration: 600 },
        { action: 'Call connected', duration: 0 }
      ],
      result: 'Check your phone. We just called you.'
    },
    impossible: {
      title: 'The Impossible Task',
      inputLabel: 'Try to stump us',
      inputPlaceholder: 'e.g., Restaurant in Vancouver, outdoor seating, vegetarian, open past 10pm Tuesday, parking nearby',
      steps: [
        { action: 'Parsing requirements...', duration: 600 },
        { action: 'Searching 847 restaurants...', duration: 1200 },
        { action: 'Cross-referencing hours, menus, parking...', duration: 1500 },
        { action: 'Validating availability...', duration: 800 },
        { action: 'Found 3 matches', duration: 0 }
      ],
      result: 'Nuba on Seymour. Vegetarian-friendly Lebanese, rooftop patio, open until 11pm, street parking on Richards.'
    },
    form: {
      title: 'Fill This Government Form',
      inputLabel: 'Watch us work',
      inputPlaceholder: null,
      steps: [
        { action: 'Loading BC Form P1...', duration: 800 },
        { action: 'Identifying 47 fields...', duration: 600 },
        { action: 'Filling deceased information...', duration: 900 },
        { action: 'Filling executor details...', duration: 900 },
        { action: 'Calculating estate values...', duration: 700 },
        { action: 'Validating all fields...', duration: 500 },
        { action: 'Form complete', duration: 0 }
      ],
      result: 'Form P1 filled. 47 fields completed. 0 errors. Ready for signatures.'
    }
  };
  
  const demo = demos[demoType];
  
  const runDemo = () => {
    setIsRunning(true);
    setStep(0);
    
    let currentStep = 0;
    const runStep = () => {
      if (currentStep < demo.steps.length) {
        setStep(currentStep + 1);
        if (demo.steps[currentStep].duration > 0) {
          setTimeout(runStep, demo.steps[currentStep].duration);
        }
        currentStep++;
      } else {
        setIsRunning(false);
      }
    };
    
    setTimeout(runStep, 300);
  };
  
  const reset = () => {
    setStep(0);
    setIsRunning(false);
    setPhoneNumber('');
    setSearchQuery('');
  };
  
  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xl">
      <div className="bg-stone-100 px-6 py-4 flex items-center justify-between border-b border-stone-200">
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
            <div className="w-3 h-3 rounded-full bg-stone-300"></div>
          </div>
          <span className="text-sm text-stone-500 font-medium">{demo.title}</span>
        </div>
        {step > 0 && (
          <button 
            onClick={reset}
            className="text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      
      <div className="p-8">
        {step === 0 ? (
          <div>
            {demo.inputPlaceholder && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-stone-700 mb-2">
                  {demo.inputLabel}
                </label>
                {demoType === 'call' ? (
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder={demo.inputPlaceholder}
                    className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-stone-400 focus:ring-0 outline-none transition-colors text-stone-800"
                  />
                ) : (
                  <textarea
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={demo.inputPlaceholder}
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-stone-400 focus:ring-0 outline-none transition-colors text-stone-800 resize-none"
                  />
                )}
              </div>
            )}
            
            {demoType === 'form' && (
              <div className="mb-6 p-4 bg-stone-50 rounded-xl border border-stone-200">
                <div className="flex items-center gap-3 mb-3">
                  <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm font-medium text-stone-700">BC Probate Form P1</span>
                </div>
                <p className="text-xs text-stone-500">47 fields including deceased info, executor details, estate inventory, and notarization sections.</p>
              </div>
            )}
            
            <MagneticButton
              onClick={runDemo}
              className="w-full py-4 bg-stone-900 text-white rounded-xl font-semibold hover:bg-stone-800 transition-colors"
            >
              {demoType === 'call' ? 'Call Me Now' : demoType === 'impossible' ? 'Find It' : 'Fill Form'}
            </MagneticButton>
          </div>
        ) : (
          <div>
            <div className="space-y-3 mb-8">
              {demo.steps.slice(0, step).map((s, i) => (
                <div 
                  key={i}
                  className="flex items-center gap-3 animate-fadeIn"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  {i < step - 1 || !isRunning ? (
                    <div className="w-5 h-5 rounded-full bg-stone-900 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-stone-300 border-t-stone-900 animate-spin flex-shrink-0"></div>
                  )}
                  <span className={`text-sm ${i < step - 1 || !isRunning ? 'text-stone-700' : 'text-stone-500'}`}>
                    {s.action}
                  </span>
                </div>
              ))}
            </div>
            
            {!isRunning && step === demo.steps.length && (
              <div className="p-6 bg-stone-50 rounded-xl border border-stone-200 animate-fadeIn">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-stone-900 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-stone-900 mb-1">Done</p>
                    <p className="text-stone-600 text-sm leading-relaxed">{demo.result}</p>
                  </div>
                </div>
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

const FeatureCard = ({ feature, index }: { feature: { title: string; description: string; icon: React.ReactNode }; index: number }) => {
  const [ref, isVisible] = useScrollReveal(0.2);
  
  return (
    <div
      ref={ref}
      className="bg-white rounded-2xl p-8 border border-stone-200"
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
    const handleScroll = () => setScrollY(window.scrollY);
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
    }
  ];
  
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 overflow-x-hidden">
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
        
        html {
          scroll-behavior: smooth;
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
            <a href="#demo" className="text-stone-500 hover:text-stone-900 transition-colors text-sm">Demo</a>
            <a href="#proof" className="text-stone-500 hover:text-stone-900 transition-colors text-sm">Results</a>
            <a href="#security" className="text-stone-500 hover:text-stone-900 transition-colors text-sm">Security</a>
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
                Employee
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
              Does things. Wild concept.
            </h2>
            <p className="text-xl text-stone-500">
              Other AIs answer questions. Yours completes tasks.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <FeatureCard key={i} feature={feature} index={i} />
            ))}
          </div>
        </div>
      </section>
      
      {/* Security Section */}
      <section id="security" className="py-32 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Built Paranoid
            </h2>
            <p className="text-xl text-stone-500 max-w-2xl mx-auto">
              We assume everyone&apos;s trying to steal your data—including us. 
              That&apos;s why we built it so we can&apos;t. Don&apos;t take our word for it. Test us.
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
            Questions? hello@aevoy.ai — a human will respond.
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
                  <li><a href="#security" className="hover:text-white transition-colors">Security</a></li>
                  <li><Link href="/signup" className="hover:text-white transition-colors">Pricing</Link></li>
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
