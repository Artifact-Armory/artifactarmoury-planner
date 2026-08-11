import React from 'react'
import { cn } from '../../utils/cn'

interface LogoProps {
  className?: string
}

/**
 * Artifact Armoury emblem — a shield outline with an inner rivet mark, drawn
 * with `currentColor` so it inherits whatever text color it's placed in
 * (unlike the old `<img src="/logo.svg">`, this adapts across the
 * light/dark theme toggle for free). Replaces the old placeholder
 * `<rect>+"Artifact"` box logo files.
 */
const Logo: React.FC<LogoProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={cn('h-7 w-7', className)}
    aria-hidden="true"
  >
    <path
      d="M12 2.25 20 5.25V11c0 5.25-3.6 9.25-8 10.75C7.6 20.25 4 16.25 4 11V5.25L12 2.25Z"
      fill="currentColor"
      fillOpacity="0.16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M12 7 15 8.5V11.5C15 13.9 13.7 15.9 12 16.75 10.3 15.9 9 13.9 9 11.5V8.5L12 7Z"
      fill="currentColor"
    />
  </svg>
)

export default Logo
