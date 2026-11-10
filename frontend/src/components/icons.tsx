/** 统一 SVG 图标集：16×16 线性图标，stroke=currentColor，风格对齐 DeepSeek */
type IconProps = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  'aria-hidden': true as const,
})

export function IconBolt({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9.05 1.4 4.1 9.05h3.1l-.45 5.55 5.3-7.7H8.75L9.05 1.4Z" fill="currentColor" />
    </svg>
  )
}

export function IconBook({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.6 2.8h3.2c.9 0 1.6.7 1.6 1.6v8.4c0-.7-.6-1.3-1.3-1.3H2.6V2.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M13.4 2.8H10.2c-.9 0-1.6.7-1.6 1.6v8.4c0-.7.6-1.3 1.3-1.3h3.5V2.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function IconApi({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="1.9" y="2.8" width="12.2" height="10.4" rx="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="m4.9 6.3 2.1 2.1-2.1 2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.7 10.8h2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function IconSearch({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconGlobe({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.7 8h12.6M8 1.7c1.9 1.8 2.9 4 2.9 6.3S9.9 12.5 8 14.3C6.1 12.5 5.1 10.3 5.1 8S6.1 3.5 8 1.7z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function IconUpload({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 10.4V2.6M5.2 5.2 8 2.4l2.8 2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.6 10.2v2.1c0 .7.6 1.3 1.3 1.3h8.2c.7 0 1.3-.6 1.3-1.3v-2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconPencil({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m10.6 2.6 2.8 2.8M3.2 12.8l.5-2.9 7-7 2.8 2.8-7 7-3.3.1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function IconLink({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6.6 9.4a2.6 2.6 0 0 1 0-3.7l1.9-1.9a2.6 2.6 0 0 1 3.7 3.7l-.8.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9.4 6.6a2.6 2.6 0 0 1 0 3.7l-1.9 1.9a2.6 2.6 0 0 1-3.7-3.7l.8-.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function IconImport({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2.6v7.8M5.2 7.6 8 10.4l2.8-2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.6 10.4v1.9c0 .7.6 1.3 1.3 1.3h8.2c.7 0 1.3-.6 1.3-1.3v-1.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconFile({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 1.8h4.8L12.6 5.6v8.6H4V1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8.6 1.9v3.8h3.9M5.9 8.6h4.3M5.9 11h4.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function IconX({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconWrench({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M10.2 2.4a3.4 3.4 0 0 0-3.9 4.4L2.5 10.6a1.6 1.6 0 0 0 2.3 2.3l3.8-3.8a3.4 3.4 0 0 0 4.4-3.9l-2 2-2.1-.5-.5-2.1 1.8-2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function IconDatabase({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <ellipse cx="8" cy="3.9" rx="4.9" ry="1.9" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.1 3.9v4.1c0 1 2.2 1.9 4.9 1.9s4.9-.9 4.9-1.9V3.9" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.1 8v4.1c0 1 2.2 1.9 4.9 1.9s4.9-.9 4.9-1.9V8" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function IconSparkle({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 1.8c.4 2.9 1.4 3.9 4.3 4.3-2.9.4-3.9 1.4-4.3 4.3-.4-2.9-1.4-3.9-4.3-4.3 2.9-.4 3.9-1.4 4.3-4.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M12.3 10.4c.2 1.4.7 1.9 2.1 2.1-1.4.2-1.9.7-2.1 2.1-.2-1.4-.7-1.9-2.1-2.1 1.4-.2 1.9-.7 2.1-2.1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m3.2 8.4 3.1 3.1 6.5-6.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconAlert({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2.2 14.4 13H1.6L8 2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.3v3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r="0.75" fill="currentColor" />
    </svg>
  )
}

export function IconChevron({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m6 3.8 4.2 4.2L6 12.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCopy({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} fill="none">
      <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.8 5V3.4A1.4 1.4 0 0 0 9.4 2H3.4A1.4 1.4 0 0 0 2 3.4v6a1.4 1.4 0 0 0 1.4 1.4H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function IconRefresh({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} fill="none">
      <path d="M13.6 8a5.6 5.6 0 1 1-1.64-3.96" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13.8 1.8v2.6h-2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconThumbUp({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} fill="none">
      <path d="M4.6 7.2 7.4 2c.8 0 1.6.7 1.6 1.6v2.6h3.4c.9 0 1.6.8 1.4 1.7l-.9 4.4c-.2.8-.9 1.3-1.7 1.3H4.6M4.6 7.2v6.4M4.6 7.2H2.6v6.4h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconThumbDown({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} fill="none" style={{ transform: 'rotate(180deg)' }}>
      <path d="M4.6 7.2 7.4 2c.8 0 1.6.7 1.6 1.6v2.6h3.4c.9 0 1.6.8 1.4 1.7l-.9 4.4c-.2.8-.9 1.3-1.7 1.3H4.6M4.6 7.2v6.4M4.6 7.2H2.6v6.4h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconSpeaker({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} fill="none">
      <path d="M2.4 6.2v3.6h2.4L8.6 13V3L4.8 6.2H2.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function IconDownload({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} fill="none">
      <path d="M8 2.4v7.8M8 10.2 5 7.4M8 10.2l3-2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.6 13.4h10.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** 对话气泡（首页「开始对话」入口等） */
export function IconChat({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} fill="none">
      <path
        d="M8 2.2C4.4 2.2 1.7 4.7 1.7 7.8c0 1.7.8 3.2 2.1 4.3l-.5 2.2 2.5-1c.7.2 1.4.3 2.2.3 3.6 0 6.3-2.5 6.3-5.8S11.6 2.2 8 2.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}
