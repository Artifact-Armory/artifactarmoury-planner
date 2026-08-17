import { useEffect, useState } from 'react';

// matchMedia is the right tool for a breakpoint check: it fires only on actual
// crossings of the threshold (not on every pixel of a resize), so no debounce
// or manual resize-listener bookkeeping is needed.
export function useIsDesktop(minWidth: number): boolean | null {
  // null = "haven't checked yet" — callers should render nothing in that gap
  // rather than guess, to avoid a flash of the wrong content.
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${minWidth}px)`);
    setIsDesktop(mql.matches);

    const handleChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [minWidth]);

  return isDesktop;
}
