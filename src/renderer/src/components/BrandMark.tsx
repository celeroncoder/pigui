export function BrandMark({ size = 24 }: { readonly size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 28 28" fill="none">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="#E9A868" />
      <path d="M7.5 9.25h13M10.1 9.25v9.5M17.9 9.25v9.5M8.4 18.75h3.4M16.2 18.75h3.4" stroke="#171310" strokeWidth="2.15" strokeLinecap="round" />
    </svg>
  )
}
