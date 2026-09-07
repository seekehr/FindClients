import { ImageResponse } from 'next/og'

export const alt =
  'FindClients — a self-hosted lead finder for freelancers'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const GRAPHITE = '#232322'
const GRAPHITE_LINE = '#3a3a37'
const GOLD = '#dfb44e'
const TEXT = '#f0efec'
const MUTED = '#a7a5a0'

/**
 * Generated from the same palette as the app, so a shared link and the running
 * product look like the same product. No binary asset to keep in sync.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: GRAPHITE,
          padding: '72px 80px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 16,
              border: `2px solid ${GOLD}55`,
              background: `${GOLD}1f`,
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke={GOLD}
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <circle cx="10.5" cy="10.5" r="6" />
              <path d="M15 15.2 19.5 19.7" />
            </svg>
          </div>
          <div style={{ display: 'flex', fontSize: 36, color: TEXT }}>
            FindClients
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            marginTop: 48,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 54,
              lineHeight: 1.18,
              color: TEXT,
              maxWidth: 1040,
            }}
          >
            Freelance work that matches your keywords, found while you work.
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              lineHeight: 1.4,
              color: MUTED,
              maxWidth: 880,
            }}
          >
            Watches Upwork and Twitter with your own accounts and scores every
            post against your criteria.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 'auto',
            paddingTop: 28,
            borderTop: `2px solid ${GRAPHITE_LINE}`,
            fontSize: 24,
            color: MUTED,
          }}
        >
          <div
            style={{
              display: 'flex',
              width: 10,
              height: 10,
              borderRadius: 999,
              background: GOLD,
            }}
          />
          Self-hosted · no account · no data leaves your computer
        </div>
      </div>
    ),
    size,
  )
}
