import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import { Button } from '../ui';
import { cn } from '../../lib/utils';

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Fallback for links that cannot be embedded — counts visible watch time only.
 * No skip: timer pauses when the tab is hidden.
 */
export function ExternalWatchTimer({
  url,
  requiredSeconds,
  startAt = 0,
  onProgress,
  onComplete,
  className,
}) {
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(Math.max(0, Number(startAt) || 0));
  const elapsedRef = useRef(Math.max(0, Number(startAt) || 0));
  const required = Math.max(1, Number(requiredSeconds) || 1);
  const completed = elapsed >= required - 1;

  useEffect(() => {
    elapsedRef.current = Math.max(0, Number(startAt) || 0);
    setElapsed(elapsedRef.current);
  }, [url, startAt, requiredSeconds]);

  useEffect(() => {
    if (!started || completed) return undefined;

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      onProgress?.(elapsedRef.current);
      if (elapsedRef.current >= required) {
        onComplete?.(required);
      }
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [started, completed, required, onProgress, onComplete]);

  const pct = Math.min(100, (elapsed / required) * 100);

  return (
    <div className={cn('p-8 text-center space-y-5 max-w-lg mx-auto', className)}>
      <ExternalLink className="h-10 w-10 text-primary mx-auto" />
      <div>
        <p className="text-sm font-medium text-fg">External lesson</p>
        <p className="text-sm text-fg-muted mt-1">
          This video opens outside the player. Keep this tab open and watch the full lesson — skipping is not allowed.
        </p>
      </div>

      {!started && !completed ? (
        <div className="space-y-3">
          <Button icon={Play} onClick={() => setStarted(true)}>Start watching</Button>
          <Button variant="outline" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
            Open lesson link
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-fg-muted tabular-nums">
            {completed ? 'Lesson complete' : `${formatTime(elapsed)} / ${formatTime(required)} watched`}
          </p>
          {!completed && (
            <p className="text-xs text-fg-subtle">Timer pauses if you switch tabs.</p>
          )}
          <Button variant="outline" size="sm" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
            Open lesson link
          </Button>
        </div>
      )}
    </div>
  );
}
