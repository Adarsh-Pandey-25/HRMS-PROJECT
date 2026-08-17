import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Maximize, Minimize, Pause, Play, Lock,
} from 'lucide-react';
import { Button, Card, Skeleton } from '../../components/ui';
import { YouTubeAntiSkipPlayer } from '../../components/training/YouTubeAntiSkipPlayer';
import { ExternalWatchTimer } from '../../components/training/ExternalWatchTimer';
import { useCourseDetail, useTrainingMutations } from '../../hooks/useTraining';
import { fetchLessonVideoUrlApi } from '../../api/training.api';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Extract YouTube video id from common URL shapes. */
function getYouTubeVideoId(url) {
  if (!url) return null;
  const raw = String(url).trim();
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') {
        return parts[1] || null;
      }
    }
  } catch {
    const m = raw.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
    return m?.[1] || null;
  }
  return null;
}

/** Max seconds the timeline can jump ahead per interaction. */
const SEEK_AHEAD_BUFFER = 0.5;

/**
 * Anti-skip player: 70% video / 30% lesson sidebar.
 * Custom controls + timeline (scrub only within already-watched range).
 */
export default function CoursePlayer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: course, isLoading, refetch } = useCourseDetail(id);
  const { updateProgress, enroll } = useTrainingMutations();
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const progressRef = useRef({ maxWatched: 0 });

  const [activeLessonId, setActiveLessonId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [videoSrc, setVideoSrc] = useState(null);
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [maxWatched, setMaxWatched] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const lessons = useMemo(() => {
    if (course?.lessons?.length) return course.lessons;
    return (course?.chapters || []).flatMap((ch) => ch.lessons || []);
  }, [course]);

  useEffect(() => {
    if (!course || course.enrollment) return;
    enroll.mutateAsync(id).then(() => refetch()).catch(() => {});
  }, [course?.id]);

  useEffect(() => {
    if (!lessons.length) return;
    if (activeLessonId && lessons.some((l) => l.id === activeLessonId)) return;
    const firstOpen = lessons.find((l) => !l.locked) || lessons[0];
    setActiveLessonId(firstOpen?.id || null);
  }, [lessons, activeLessonId]);

  const activeLesson = lessons.find((l) => l.id === activeLessonId) || null;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeLesson) {
        setVideoSrc(null);
        return;
      }
      if (activeLesson.type === 'EXTERNAL_LINK') {
        setVideoSrc(null);
        return;
      }
      setLoadingSrc(true);
      setCurrentTime(0);
      setDuration(Number(activeLesson.videoDuration || 0));
      const saved = Number(
        activeLesson.progress?.watchedSeconds
          ?? activeLesson.progress?.watched_seconds
          ?? 0
      );
      setMaxWatched(saved);
      progressRef.current.maxWatched = saved;
      try {
        const fromLesson = activeLesson.playbackUrl || activeLesson.videoUrl;
        if (fromLesson && /^https?:\/\//i.test(fromLesson)) {
          if (!cancelled) setVideoSrc(fromLesson);
        } else {
          const res = await fetchLessonVideoUrlApi(activeLesson.id);
          if (!cancelled) setVideoSrc(res.videoUrl || null);
        }
      } catch (err) {
        if (!cancelled) {
          setVideoSrc(null);
          toast.error(err.message || 'Could not load video');
        }
      } finally {
        if (!cancelled) setLoadingSrc(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeLesson?.id, activeLesson?.type]);

  useEffect(() => {
    if (!activeLesson || activeLesson.type !== 'VIDEO_UPLOAD') return undefined;
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) {
        updateProgress.mutate({ lessonId: activeLesson.id, watchedSeconds: v.currentTime });
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [activeLesson?.id, activeLesson?.type]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (activeLesson?.type === 'EXTERNAL_LINK' || !videoRef.current) return;
      e.preventDefault();
      const v = videoRef.current;
      if (v.paused) {
        v.play();
        setPlaying(true);
      } else {
        v.pause();
        setPlaying(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeLesson?.type]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeLesson || activeLesson.type !== 'VIDEO_UPLOAD') return undefined;

    const resume = progressRef.current.maxWatched || 0;

    const onLoaded = () => {
      if (v.duration && Number.isFinite(v.duration)) setDuration(v.duration);
      if (resume > 0 && resume < (v.duration || Infinity)) {
        v.currentTime = resume;
        setCurrentTime(resume);
      }
    };

    const onTime = () => {
      const t = v.currentTime || 0;
      setCurrentTime(t);
      if (t > progressRef.current.maxWatched) {
        progressRef.current.maxWatched = t;
        setMaxWatched(t);
      }
    };

    const onSeeking = () => {
      const allowed = progressRef.current.maxWatched + SEEK_AHEAD_BUFFER;
      if (v.currentTime > allowed) {
        v.currentTime = allowed;
      }
    };

    const onSeeked = () => {
      const allowed = progressRef.current.maxWatched + SEEK_AHEAD_BUFFER;
      if (v.currentTime > allowed) {
        v.currentTime = allowed;
        setCurrentTime(allowed);
      }
    };

    const onRateChange = () => {
      if (v.playbackRate !== 1) v.playbackRate = 1;
    };

    const blockContextMenu = (e) => e.preventDefault();

    v.playbackRate = 1;
    v.disablePictureInPicture = true;

    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onLoaded);
    v.addEventListener('seeking', onSeeking);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('ratechange', onRateChange);
    v.addEventListener('contextmenu', blockContextMenu);
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onLoaded);
      v.removeEventListener('seeking', onSeeking);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('ratechange', onRateChange);
      v.removeEventListener('contextmenu', blockContextMenu);
    };
  }, [activeLesson?.id, videoSrc]);

  const enableNextLesson = useCallback(async () => {
    await refetch();
    const idx = lessons.findIndex((l) => l.id === activeLessonId);
    const next = lessons[idx + 1];
    if (next) setActiveLessonId(next.id);
  }, [lessons, activeLessonId, refetch]);

  const saveProgress = useCallback((watchedSeconds, { completeToast = false } = {}) => {
    if (!activeLesson) return;
    updateProgress.mutate(
      { lessonId: activeLesson.id, watchedSeconds },
      {
        onSuccess: (data) => {
          if (completeToast && data?.isCompleted) {
            toast.success('Lesson completed');
            enableNextLesson();
          }
        },
      },
    );
  }, [activeLesson, updateProgress, enableNextLesson]);

  const handleLessonComplete = useCallback((watchedSeconds) => {
    if (!activeLesson) return;
    const endAt = watchedSeconds || activeLesson.videoDuration || 0;
    progressRef.current.maxWatched = endAt;
    setMaxWatched(endAt);
    updateProgress.mutate(
      { lessonId: activeLesson.id, watchedSeconds: endAt, forceComplete: true },
      {
        onSuccess: () => {
          toast.success('Lesson completed');
          enableNextLesson();
        },
      },
    );
  }, [activeLesson, updateProgress, enableNextLesson]);

  const handleExternalProgress = useCallback((seconds) => {
    saveProgress(seconds);
  }, [saveProgress]);

  const handleVideoEnd = () => {
    const v = videoRef.current;
    if (!activeLesson || !v) return;
    handleLessonComplete(v.duration || activeLesson.videoDuration || 0);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const toggleFullscreen = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      toast.error('Fullscreen not available');
    }
  };

  const seekFromEvent = useCallback((clientX, trackEl) => {
    const v = videoRef.current;
    if (!v || !trackEl || !duration) return;
    const rect = trackEl.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const target = ratio * duration;
    const allowed = progressRef.current.maxWatched + SEEK_AHEAD_BUFFER;
    const next = Math.min(target, allowed);
    v.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  const onTimelinePointer = (e) => {
    const track = e.currentTarget;
    seekFromEvent(e.clientX, track);

    const move = (ev) => seekFromEvent(ev.clientX, track);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const externalSavedProgress = Number(
    activeLesson?.progress?.watchedSeconds
      ?? activeLesson?.progress?.watched_seconds
      ?? 0
  );

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const unlockedPct = duration > 0 ? (maxWatched / duration) * 100 : 0;

  const externalUrl = activeLesson?.externalLink || activeLesson?.playbackUrl || '';
  const youtubeId = activeLesson?.type === 'EXTERNAL_LINK' ? getYouTubeVideoId(externalUrl) : null;
  const externalDuration = Number(activeLesson?.videoDuration || 0);

  if (isLoading) {
    return (
      <div className="p-6"><Skeleton className="h-[78vh] w-full rounded-card" /></div>
    );
  }

  if (!course) {
    return (
      <Card className="p-8 m-6">
        <p className="text-sm text-fg-muted">Course not found.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/training/catalog')}>Back to catalog</Button>
      </Card>
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      {!isFullscreen && (
        <button type="button" onClick={() => navigate('/training/catalog')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back to catalog
        </button>
      )}

      <div className={cn('flex flex-col lg:flex-row gap-4', isFullscreen ? 'fixed inset-0 z-50 bg-black p-0 gap-0' : 'min-h-[78vh]')}>
        {/* Player shell — 70% (100% in fullscreen) */}
        <div
          ref={shellRef}
          className={cn(
            'flex flex-col bg-black overflow-hidden',
            isFullscreen ? 'w-full h-full' : 'lg:w-[70%] rounded-card border border-border'
          )}
        >
          {!isFullscreen && (
            <div className="px-4 py-3 bg-surface border-b border-border shrink-0">
              <p className="text-xs text-fg-subtle">{course.title}</p>
              <p className="text-sm font-semibold text-fg">{activeLesson?.title || 'Select a lesson'}</p>
            </div>
          )}

          <div
            className={cn(
              'relative flex-1 bg-black flex items-center justify-center group',
              isFullscreen ? 'h-full' : 'min-h-[52vh] lg:min-h-[68vh]'
            )}
          >
            {activeLesson?.type === 'EXTERNAL_LINK' ? (
              !externalDuration ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-white/70">This lesson has no duration configured. Ask your HR admin to set the video length.</p>
                </div>
              ) : youtubeId ? (
                <div className="relative w-full h-full flex flex-col min-h-[52vh] lg:min-h-[68vh]">
                  <YouTubeAntiSkipPlayer
                    videoId={youtubeId}
                    startAt={externalSavedProgress}
                    duration={externalDuration}
                    onProgress={handleExternalProgress}
                    onComplete={handleLessonComplete}
                    className={isFullscreen ? 'min-h-full' : undefined}
                  />
                  <div className="shrink-0 px-4 py-2 bg-black/80 border-t border-white/10">
                    <p className="text-xs text-white/60">
                      Watch the full video — skipping ahead is disabled.
                    </p>
                  </div>
                </div>
              ) : (
                <ExternalWatchTimer
                  url={externalUrl}
                  requiredSeconds={externalDuration}
                  startAt={externalSavedProgress}
                  onProgress={handleExternalProgress}
                  onComplete={handleLessonComplete}
                />
              )
            ) : loadingSrc ? (
              <p className="text-sm text-white/70">Loading video…</p>
            ) : videoSrc ? (
              <>
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className={cn(
                    'w-full object-contain bg-black',
                    isFullscreen ? 'h-full max-h-full' : 'h-full max-h-[68vh] lg:max-h-[72vh]'
                  )}
                  playsInline
                  controls={false}
                  controlsList="nodownload noremoteplayback"
                  disablePictureInPicture
                  onClick={togglePlay}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={handleVideoEnd}
                />

                {/* Large bottom control bar with timeline */}
                <div
                  className={cn(
                    'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent',
                    'px-4 sm:px-6 pt-10 pb-4 sm:pb-5 transition-opacity',
                    playing && !isFullscreen ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                  )}
                >
                  {isFullscreen && (
                    <p className="text-white/90 text-sm font-medium mb-3 truncate">
                      {course.title} · {activeLesson?.title}
                    </p>
                  )}

                  {/* Timeline */}
                  <div
                    role="slider"
                    aria-label="Video progress"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(duration)}
                    aria-valuenow={Math.round(currentTime)}
                    tabIndex={0}
                    onPointerDown={onTimelinePointer}
                    className="relative h-2.5 sm:h-3 rounded-full bg-white/25 cursor-pointer touch-none mb-3"
                  >
                    {/* Unlocked (already watched) range */}
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-white/35"
                      style={{ width: `${Math.min(100, unlockedPct)}%` }}
                    />
                    {/* Current playhead fill */}
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary"
                      style={{ width: `${Math.min(100, progressPct)}%` }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-white shadow border-2 border-primary"
                      style={{ left: `calc(${Math.min(100, progressPct)}% - 10px)` }}
                    />
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="p-2.5 sm:p-3 rounded-full text-white bg-white/10 hover:bg-white/20"
                      aria-label={playing ? 'Pause' : 'Play'}
                    >
                      {playing ? <Pause className="h-6 w-6 sm:h-7 sm:w-7" /> : <Play className="h-6 w-6 sm:h-7 sm:w-7" />}
                    </button>

                    <span className="text-white text-sm sm:text-base font-medium tabular-nums min-w-[7.5rem] flex-1">
                      {formatTime(currentTime)} / {formatTime(duration || activeLesson?.videoDuration || 0)}
                    </span>

                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="p-2.5 sm:p-3 rounded-full text-white bg-white/10 hover:bg-white/20"
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                    >
                      {isFullscreen
                        ? <Minimize className="h-6 w-6 sm:h-7 sm:w-7" />
                        : <Maximize className="h-6 w-6 sm:h-7 sm:w-7" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-white/70">No video available for this lesson.</p>
            )}
          </div>
        </div>

        {/* Sidebar — hide in fullscreen for proper large screen */}
        {!isFullscreen && (
          <aside className="lg:w-[30%] rounded-card border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-fg mb-3">Lessons</p>
            <ul className="space-y-1 max-h-[72vh] overflow-y-auto">
              {lessons.map((l, i) => {
                const done = l.isCompleted || l.progress?.isCompleted;
                const locked = l.locked && !done;
                const active = l.id === activeLessonId;
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => !locked && setActiveLessonId(l.id)}
                      className={cn(
                        'w-full text-left rounded-lg px-3 py-2.5 text-sm flex items-start gap-2 transition-colors',
                        active ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-muted',
                        locked && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <span className="mt-0.5 shrink-0">
                        {done ? <CheckCircle2 className="h-4 w-4 text-success" /> : locked ? <Lock className="h-4 w-4" /> : <span className="text-xs text-fg-subtle">{i + 1}</span>}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium truncate">{l.title}</span>
                        <span className="text-[11px] text-fg-subtle">
                          {l.type === 'EXTERNAL_LINK'
                            ? (getYouTubeVideoId(l.externalLink || l.playbackUrl) ? 'YouTube' : 'External link')
                            : formatTime(l.videoDuration || 0)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
