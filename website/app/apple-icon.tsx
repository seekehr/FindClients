import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** Same mark as app/icon.svg, at the size iOS pins to a home screen. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#232322',
        }}
      >
        <svg
          width="104"
          height="104"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#dfb44e"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15.2 19.5 19.7" />
        </svg>
      </div>
    ),
    size,
  )
}
