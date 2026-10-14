'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GuestStepper } from '@/components/booking/Controls';
import { buttonClasses } from '@/components/ui/Button';
import { ArrowRight } from '@/components/ui/icons';
import { slotOrder, tours } from '@/lib/tours';

const times = slotOrder
  .map((slot) => tours.find((t) => t.timeSlot === slot)?.startTimeDisplay)
  .filter((t): t is string => Boolean(t))
  .map((t) => t.replace(':00', '').replace(' AM', 'am').replace(' PM', 'pm'));

/** The hero's booking bar: pick a group size, land on the calendar. */
export function HeroBooking() {
  const router = useRouter();
  const [guests, setGuests] = useState(2);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/book?guests=${guests}`);
      }}
      className="mt-10 grid gap-2 rounded-2xl border border-white/20 bg-black/30 p-2 backdrop-blur-xl sm:grid-cols-[1fr_auto] sm:items-center lg:grid-cols-[auto_1fr_auto]"
    >
      <div className="flex items-center justify-between gap-5 rounded-xl px-4 py-2.5 sm:justify-start">
        <span id="hero-guests-label" className="text-sm font-medium text-white/80">
          Guests
        </span>
        <GuestStepper value={guests} onChange={setGuests} tone="dark" id="hero-guests" />
      </div>
      <div className="hidden border-l border-white/15 px-6 lg:block">
        <p className="text-sm font-medium text-white/70">Departs daily</p>
        <p className="mt-0.5 font-semibold tabular-nums tracking-tight">{times.join(' · ')}</p>
      </div>
      <button type="submit" className={buttonClasses({ size: 'lg', className: 'w-full sm:w-auto' })}>
        Check availability
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
