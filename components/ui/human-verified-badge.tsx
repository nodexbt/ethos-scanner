interface HumanVerifiedBadgeProps {
  size?: number;
  className?: string;
}

export function HumanVerifiedBadge({ size = 15, className }: HumanVerifiedBadgeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Human verified"
    >
      <title>Human verified</title>
      <path d="M14.8447 7.08498L13.1983 5.2024L13.4277 2.71254L10.9918 2.15923L9.71655 0L7.42236 0.98515L5.12818 0L3.85288 2.15249L1.417 2.69904L1.64641 5.19566L0 7.08498L1.64641 8.96757L1.417 11.4642L3.85288 12.0175L5.12818 14.17L7.42236 13.1781L9.71655 14.1632L10.9918 12.0107L13.4277 11.4574L13.1983 8.96757L14.8447 7.08498Z" fill="#C1C0B6" />
      <rect x="5.79932" y="5.04688" width="2.62997" height="2.62997" rx="1.31498" transform="rotate(-45 5.79932 5.04688)" fill="#2D2D29" />
      <rect x="6.2605" y="9.76367" width="5.63564" height="1.9744" transform="rotate(-45 6.2605 9.76367)" fill="#2D2D29" />
      <rect x="3.6731" y="7.17383" width="1.91283" height="5.63564" transform="rotate(-45 3.6731 7.17383)" fill="#2D2D29" />
    </svg>
  );
}
