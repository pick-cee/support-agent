// Plain line icons, drawn inline so nothing loads from elsewhere. Decorative
// only: every icon sits beside words that say the same thing, so each is
// hidden from assistive technology.

type IconProps = { size?: number; className?: string };

function Svg({ size = 20, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </Svg>
  );
}

export function EndCallIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 14.5c4.7-4 12.3-4 17 0l-1.8 2.3a1 1 0 0 1-1.3.2l-2.4-1.5a1 1 0 0 1-.4-.9l.1-1.3a11 11 0 0 0-5.4 0l.1 1.3a1 1 0 0 1-.4.9L6.6 17a1 1 0 0 1-1.3-.2z" />
    </Svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" />
    </Svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h13" />
      <path d="M13 6l6 6-6 6" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l7 2.5v5.5c0 4.3-2.9 7.9-7 9-4.1-1.1-7-4.7-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

export function SearchDocIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h5" />
      <path d="M14 3.5L18.5 8v3" />
      <circle cx="16.5" cy="16" r="3" />
      <path d="M18.7 18.2L20.5 20" />
    </Svg>
  );
}

export function HeadsetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="3.5" y="13.5" width="4" height="6" rx="1.5" />
      <rect x="16.5" y="13.5" width="4" height="6" rx="1.5" />
      <path d="M18.5 19.5c0 1.1-1.3 1.5-3 1.5H13" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.75v.01" />
    </Svg>
  );
}
