import { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

let ytApiPromise = null;

function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

/**
 * YouTube embed with IFrame API — snaps back if user scrubs ahead of max watched time.
 */
export function YouTubeAntiSkipPlayer({
  videoId,
  startAt = 0,
  duration = 0,
  onProgress,
  onComplete,
  className,
}) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const maxWatchedRef = useRef(Math.max(0, Number(startAt) || 0));
  const guardRef = useRef(null);
  const progressRef = useRef(null);
  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onProgressRef.current = onProgress;
    onCompleteRef.current = onComplete;
  }, [onProgress, onComplete]);

  useEffect(() => {
    let cancelled = false;
    maxWatchedRef.current = Math.max(0, Number(startAt) || 0);

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || !videoId) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          disablekb: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            const player = event.target;
            const resume = maxWatchedRef.current;
            if (resume > 0) player.seekTo(resume, true);

            guardRef.current = window.setInterval(() => {
              if (!player?.getCurrentTime) return;
              const t = player.getCurrentTime() || 0;
              const max = maxWatchedRef.current;
              if (t > max + 1.25) {
                player.seekTo(max, true);
              } else if (t > max) {
                maxWatchedRef.current = t;
                onProgressRef.current?.(t);
              }
            }, 400);

            progressRef.current = window.setInterval(() => {
              onProgressRef.current?.(maxWatchedRef.current);
            }, 8000);
          },
          onStateChange: (event) => {
            if (event.data !== window.YT.PlayerState.ENDED) return;
            const player = event.target;
            const endAt = player.getDuration?.() || duration || maxWatchedRef.current;
            maxWatchedRef.current = endAt;
            onCompleteRef.current?.(endAt);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (guardRef.current) window.clearInterval(guardRef.current);
      if (progressRef.current) window.clearInterval(progressRef.current);
      guardRef.current = null;
      progressRef.current = null;
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId, startAt, duration]);

  return (
    <div
      ref={containerRef}
      className={cn('w-full h-full min-h-[52vh] lg:min-h-[64vh]', className)}
    />
  );
}
