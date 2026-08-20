'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { scrapeApi, type CaptchaChallenge } from '@/lib/api'

const POLL_MS = 3_000

export default function CaptchaModal() {
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null)
  const [screenshot, setScreenshot] = useState<string>('')
  const [clicking, setClicking] = useState(false)
  const [solved, setSolved] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const { challenge: c } = await scrapeApi.captcha()
        if (cancelled) return
        if (c) {
          setChallenge(c)
          setScreenshot(c.screenshot)
          setSolved(false)
        } else {
          setChallenge(null)
        }
      } catch {
        /* offline */
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS)
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!challenge || clicking) return
      const img = imgRef.current
      if (!img) return

      const rect = img.getBoundingClientRect()
      const scaleX = challenge.width / rect.width
      const scaleY = challenge.height / rect.height
      const x = Math.round((e.clientX - rect.left) * scaleX)
      const y = Math.round((e.clientY - rect.top) * scaleY)

      setClicking(true)
      try {
        const result = await scrapeApi.captchaClick(challenge.sessionId, x, y)
        setScreenshot(result.screenshot)
        if (result.solved) {
          setSolved(true)
          setTimeout(() => {
            setChallenge(null)
            setSolved(false)
          }, 2000)
        }
      } catch {
        /* session expired */
        setChallenge(null)
      } finally {
        setClicking(false)
      }
    },
    [challenge, clicking],
  )

  const handleDismiss = useCallback(async () => {
    if (!challenge) return
    await scrapeApi.captchaDismiss(challenge.sessionId).catch(() => undefined)
    setChallenge(null)
  }, [challenge])

  if (!challenge) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            <span className="font-semibold">
              CAPTCHA — {challenge.platform}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {clicking && <Loader2 className="w-4 h-4 animate-spin text-foreground/50" />}
            {solved && (
              <span className="text-sm text-green-500 font-medium">Solved!</span>
            )}
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-4 overflow-auto flex-1">
          <p className="text-sm text-foreground/60 mb-3">
            Click on the image below to solve the CAPTCHA. Your clicks are relayed to the scraper browser.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={`data:image/png;base64,${screenshot}`}
            alt="CAPTCHA challenge"
            className={`max-w-full rounded-lg border border-border cursor-crosshair ${clicking ? 'opacity-70' : ''}`}
            onClick={handleClick}
            draggable={false}
          />
        </div>
      </div>
    </div>
  )
}
