import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * State that outlives a page load within this tab. A finder's
 * shortlist survives the clean boot a trip to another galaxy needs,
 * so the next candidate is still there when you arrive.
 */
export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable: the state lasts as long as the page.
    }
  }, [key, value]);
  return [value, setValue];
}
