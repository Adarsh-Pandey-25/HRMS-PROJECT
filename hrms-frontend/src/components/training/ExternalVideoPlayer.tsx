import { useEffect, useRef } from 'react'
import { parseVimeoVideoId, parseYouTubeVideoId, toEmbedUrl } from '../../lib/training.api'

type YTPlayer = {
  getCurrentTime: () => number
  getPlayerState: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  destroy: () => void
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: Record<string, unknown>,
      ) => YTPlayer
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

let youtubeApiPromise: Promise<void> | null = null

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve()
  if (youtubeApiPromise) return youtubeApiPromise

  youtubeApiPromise = new Promise((resolve) => {
    const done = () => resolve()
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      done()
    }
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    } else if (window.YT?.Player) {
      done()
    }
  })
  return youtubeApiPromise
}

type Props = {
  externalLink: string
  lessonId: string
  startAt: number
  duration: number
  onProgress: (seconds: number, final?: boolean) => void
  onEnded: () => void
  onTick: (seconds: number, playing: boolean) => void
}

export default function ExternalVideoPlayer({
  externalLink,
  lessonId,
  startAt,
  duration,
  onProgress,
  onEnded,
  onTick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const maxWatchedRef = useRef(startAt)
  const lastBucketRef = useRef(-1)
  const completedRef = useRef(false)
  const onProgressRef = useRef(onProgress)
  const onEndedRef = useRef(onEnded)
  const onTickRef = useRef(onTick)

  const youtubeId = parseYouTubeVideoId(externalLink)
  const vimeoId = parseVimeoVideoId(externalLink)

  onProgressRef.current = onProgress
  onEndedRef.current = onEnded
  onTickRef.current = onTick

  useEffect(() => {
    maxWatchedRef.current = startAt
    lastBucketRef.current = -1
    completedRef.current = false
    onTickRef.current(startAt, false)
  }, [lessonId, startAt])

  useEffect(() => {
    if (!youtubeId || !containerRef.current) return undefined

    let cancelled = false
    let pollId: ReturnType<typeof setInterval> | null = null

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT) return

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: youtubeId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          disablekb: 1,
          rel: 0,
          modestbranding: 1,
          fs: 1,
          iv_load_policy: 3,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: { target: YTPlayer }) => {
            if (startAt > 0) event.target.seekTo(startAt, true)
            maxWatchedRef.current = startAt
          },
          onStateChange: (event: { data: number; target: YTPlayer }) => {
            const playing = event.data === window.YT!.PlayerState.PLAYING
            onTickRef.current(event.target.getCurrentTime(), playing)
            if (event.data === window.YT!.PlayerState.ENDED) {
              if (completedRef.current) return
              completedRef.current = true
              const end = duration || event.target.getCurrentTime()
              onProgressRef.current(end, true)
              onEndedRef.current()
            }
          },
        },
      })

      pollId = setInterval(() => {
        const player = playerRef.current
        if (!player?.getCurrentTime) return

        let t = player.getCurrentTime()
        const playing = player.getPlayerState?.() === window.YT!.PlayerState.PLAYING

        if (t > maxWatchedRef.current + 2) {
          player.seekTo(maxWatchedRef.current, true)
          t = maxWatchedRef.current
        } else if (t > maxWatchedRef.current) {
          maxWatchedRef.current = t
        }

        onTickRef.current(t, playing)

        const bucket = Math.floor(t / 5)
        if (bucket > lastBucketRef.current) {
          lastBucketRef.current = bucket
          onProgressRef.current(t)
        }

        const total = duration || 0
        if (total && t >= total - 5 && !completedRef.current) {
          completedRef.current = true
          onProgressRef.current(total, true)
          onEndedRef.current()
        }
      }, 500)
    })

    return () => {
      cancelled = true
      if (pollId) clearInterval(pollId)
      playerRef.current?.destroy?.()
      playerRef.current = null
    }
  }, [youtubeId, lessonId, startAt, duration])

  // Vimeo / generic embed — timer-only fallback (cannot block native seek)
  useEffect(() => {
    if (youtubeId || !externalLink) return undefined

    maxWatchedRef.current = startAt
    let seconds = startAt
    const id = setInterval(() => {
      if (document.hidden) return
      seconds += 1
      if (seconds > maxWatchedRef.current) maxWatchedRef.current = seconds
      onTickRef.current(seconds, true)
      const bucket = Math.floor(seconds / 5)
      if (bucket > lastBucketRef.current) {
        lastBucketRef.current = bucket
        onProgressRef.current(seconds)
      }
      const total = duration || 0
      if (total && seconds >= total - 5 && !completedRef.current) {
        completedRef.current = true
        onProgressRef.current(total, true)
        onEndedRef.current()
      }
    }, 1000)

    return () => clearInterval(id)
  }, [youtubeId, externalLink, lessonId, startAt, duration])

  if (youtubeId) {
    return <div ref={containerRef} className="w-full h-full min-h-[280px] lg:min-h-[480px]" />
  }

  const embedSrc = vimeoId
    ? `https://player.vimeo.com/video/${vimeoId}?title=0&byline=0`
    : toEmbedUrl(externalLink)

  return (
    <iframe
      title="External lesson video"
      src={embedSrc}
      className="w-full h-full min-h-[280px] lg:min-h-[480px]"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  )
}
