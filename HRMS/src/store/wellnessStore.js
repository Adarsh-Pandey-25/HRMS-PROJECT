import { create } from 'zustand';
import { persist } from 'zustand/middleware';

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** Local daily mood check-in (client-only until a pulse API exists). */
export const useWellnessStore = create(
  persist(
    (set) => ({
      myCheckins: {}, // { [date]: moodKey }
      checkIn: (moodKey) => {
        const day = todayKey();
        set((s) => ({ myCheckins: { ...s.myCheckins, [day]: moodKey } }));
      },
    }),
    { name: 'zenith-wellness' }
  )
);

export function getWellnessToday() {
  return todayKey();
}

/** @deprecated use getWellnessToday() — kept for older imports */
export const WELLNESS_TODAY = todayKey();
