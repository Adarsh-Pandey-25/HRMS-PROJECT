import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Lock, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchCourse,
  fetchLessonVideoUrl,
  flattenLessons,
  isLessonLocked,
  updateLessonProgress,
} from '../../lib/training.api'
import { getErrorMessage } from '../../lib/errors'
import { Button, LoadingState } from '../../components/ui'
import ExternalVideoPlayer from '../../components/training/ExternalVideoPlayer'
import type { Course, Lesson, LessonProgress } from '../../types'

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function CoursePlayerPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const maxWatchedRef = useRef(0)
  const lastSentRef = useRef(0)

  const [activeLessonId, setActiveLessonId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>({})

  const lastProgressBucketRef = useRef(-1)

  const course = useQuery({
    queryKey: ['courses', id],
    queryFn: () => fetchCourse(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  })

  const progressMutation = useMutation({
    mutationFn: ({ lessonId, seconds }: { lessonId: string; seconds: number }) =>
      updateLessonProgress(lessonId, seconds),
    onSuccess: (data) => {
      qc.setQueryData<Course>(['courses', id], (old) => {
        if (!old) return old
        const lessonProgress = [...(old.enrollment?.lessonProgress || [])]
        const idx = lessonProgress.findIndex((p) => p.lessonId === data.lessonId)
        const entry: LessonProgress = {
          id: data.enrollmentId,
          lessonId: data.lessonId,
          watchedSeconds: data.watchedSeconds,
          isCompleted: data.isCompleted,
        }
        if (idx >= 0) lessonProgress[idx] = { ...lessonProgress[idx], ...entry }
        else lessonProgress.push(entry)

        const totalLessons = old.totalLessons || 0
        const completedLessons = lessonProgress.filter((p) => p.isCompleted).length
        const progressPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0

        return {
          ...old,
          progressPercent,
          enrollment: {
            id: data.enrollmentId,
            status: data.enrollmentStatus,
            enrolledAt: old.enrollment?.enrolledAt,
            completedAt: data.completedAt || old.enrollment?.completedAt,
            progressPercent,
            lessonProgress,
          },
        }
      })
      if (data.enrollmentStatus === 'COMPLETED') {
        qc.invalidateQueries({ queryKey: ['courses', 'employee'] })
      }
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const chapters = course.data?.chapters || []
  const allLessons = useMemo(() => flattenLessons(chapters), [chapters])

  const progressMap = useMemo(() => {
    const map = new Map<string, LessonProgress>()
    for (const p of course.data?.enrollment?.lessonProgress || []) {
      map.set(p.lessonId, p)
    }
    return map
  }, [course.data?.enrollment?.lessonProgress])

  const activeLesson: Lesson | undefined = allLessons.find((l) => l.id === activeLessonId)
    || allLessons.find((l) => !progressMap.get(l.id)?.isCompleted)
    || allLessons[0]

  const lessonVideo = useQuery({
    queryKey: ['lesson-video', activeLesson?.id],
    queryFn: () => fetchLessonVideoUrl(activeLesson!.id),
    enabled: Boolean(activeLesson?.id && activeLesson.type === 'VIDEO_UPLOAD'),
    staleTime: 60 * 60_000,
  })

  useEffect(() => {
    if (activeLesson && !activeLessonId) setActiveLessonId(activeLesson.id)
  }, [activeLesson, activeLessonId])

  useEffect(() => {
    if (!chapters.length) return
    setOpenChapters((prev) => {
      const next = { ...prev }
      for (const ch of chapters) next[ch.id] = true
      return next
    })
  }, [chapters])

  useEffect(() => {
    const watched = progressMap.get(activeLesson?.id || '')?.watchedSeconds || 0
    maxWatchedRef.current = watched
    lastSentRef.current = watched
    lastProgressBucketRef.current = -1
    setCurrentTime(watched)
    setDuration(activeLesson?.videoDuration || 0)

    if (videoRef.current && activeLesson?.type === 'VIDEO_UPLOAD') {
      videoRef.current.currentTime = watched
    }
  }, [activeLesson?.id, activeLesson?.type, activeLesson?.videoDuration, progressMap])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const goToNextLesson = useCallback(() => {
    const idx = allLessons.findIndex((l) => l.id === activeLesson?.id)
    if (idx >= 0 && idx < allLessons.length - 1) {
      setActiveLessonId(allLessons[idx + 1].id)
      setPlaying(false)
    }
  }, [activeLesson?.id, allLessons])

  const sendProgress = useCallback((lessonId: string, seconds: number, final = false) => {
    if (!lessonId) return
    const capped = Math.min(seconds, activeLesson?.videoDuration || seconds)
    if (!final && capped - lastSentRef.current < 4) return
    lastSentRef.current = capped
    maxWatchedRef.current = Math.max(maxWatchedRef.current, capped)
    progressMutation.mutate({ lessonId, seconds: capped })
  }, [activeLesson?.videoDuration, progressMutation])

  const onTimeUpdate = () => {
    const video = videoRef.current
    if (!video || !activeLesson) return
    const t = video.currentTime
    if (t > maxWatchedRef.current + 2) {
      video.currentTime = maxWatchedRef.current
      setCurrentTime(maxWatchedRef.current)
      return
    }
    maxWatchedRef.current = Math.max(maxWatchedRef.current, t)
    setCurrentTime(t)
    if (video.duration && !Number.isNaN(video.duration)) {
      setDuration(video.duration)
    }
    const bucket = Math.floor(t / 5)
    if (bucket > lastProgressBucketRef.current) {
      lastProgressBucketRef.current = bucket
      sendProgress(activeLesson.id, t)
    }
  }

  const onLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    const d = video.duration
    if (d && !Number.isNaN(d)) setDuration(d)
  }

  const seekTo = (clientX: number, track: HTMLDivElement) => {
    const video = videoRef.current
    const total = duration || activeLesson?.videoDuration || 0
    if (!video || !total) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const target = ratio * total
    const capped = Math.min(target, maxWatchedRef.current)
    video.currentTime = capped
    setCurrentTime(capped)
  }

  const lessonDuration = duration || activeLesson?.videoDuration || 0
  const savedWatched = progressMap.get(activeLesson?.id || '')?.watchedSeconds || 0
  const watchedSeconds = Math.max(savedWatched, currentTime)
  const playPercent = lessonDuration ? (currentTime / lessonDuration) * 100 : 0
  const watchedPercent = lessonDuration ? (watchedSeconds / lessonDuration) * 100 : 0
  const isUploadedVideo = activeLesson?.type === 'VIDEO_UPLOAD' && Boolean(lessonVideo.data)

  const onVideoEnded = () => {
    if (!activeLesson) return
    const duration = activeLesson.videoDuration || videoRef.current?.duration || 0
    sendProgress(activeLesson.id, duration, true)
    setPlaying(false)
    goToNextLesson()
  }

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)) return
      if (activeLesson?.type !== 'VIDEO_UPLOAD') return
      e.preventDefault()
      togglePlay()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeLesson?.type, togglePlay])

  const toggleFullscreen = async () => {
    const el = playerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      toast.error('Fullscreen is not available on this device')
    }
  }

  if (course.isLoading) return <div className="p-6"><LoadingState /></div>
  if (!course.data) return <div className="p-6 text-slate-500">Course not found</div>

  const progressPercent = course.data.progressPercent || 0

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white flex flex-col">
      <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" className="text-white hover:bg-slate-800" onClick={() => navigate('/training')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">{course.data.title}</h1>
          <p className="text-xs text-slate-400">{progressPercent}% complete</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row min-h-0">
        <div
          ref={playerRef}
          className={`lg:w-3/4 bg-black flex flex-col relative min-h-[280px] lg:min-h-0 ${isFullscreen ? 'w-full h-full' : ''}`}
        >
          <div
            className={`flex-1 flex items-center justify-center relative min-h-0 ${isUploadedVideo ? 'cursor-pointer' : ''}`}
            onClick={isUploadedVideo ? togglePlay : undefined}
            role={isUploadedVideo ? 'button' : undefined}
            aria-label={isUploadedVideo ? (playing ? 'Pause video' : 'Play video') : undefined}
          >
          {activeLesson?.type === 'VIDEO_UPLOAD' ? (
            <>
              {lessonVideo.isLoading ? (
                <div className="text-slate-400 text-sm">Loading video…</div>
              ) : lessonVideo.data ? (
              <video
                ref={videoRef}
                key={activeLesson.id}
                src={lessonVideo.data}
                className="max-h-full max-w-full w-full h-full object-contain pointer-events-none"
                preload="metadata"
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onLoadedMetadata}
                onEnded={onVideoEnded}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                muted={muted}
                playsInline
              />
              ) : (
                <div className="text-slate-400 text-sm">Video unavailable</div>
              )}
              {!playing ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35 pointer-events-none">
                  <div className="rounded-full bg-black/55 p-6 backdrop-blur-sm border border-white/10">
                    <Play className="h-14 w-14 text-white fill-white" strokeWidth={1.5} />
                  </div>
                </div>
              ) : null}
            </>
          ) : activeLesson?.type === 'EXTERNAL_LINK' && activeLesson.externalLink ? (
            <ExternalVideoPlayer
              key={activeLesson.id}
              externalLink={activeLesson.externalLink}
              lessonId={activeLesson.id}
              startAt={savedWatched}
              duration={activeLesson.videoDuration || 0}
              onProgress={(seconds, final) => sendProgress(activeLesson.id, seconds, final)}
              onEnded={() => {
                setPlaying(false)
                goToNextLesson()
              }}
              onTick={(seconds, isPlaying) => {
                setCurrentTime(seconds)
                setPlaying(isPlaying)
              }}
            />
          ) : (
            <p className="text-slate-400">Select a lesson to begin</p>
          )}
          </div>

          {activeLesson && lessonDuration > 0 ? (
            <div className="bg-slate-900/95 border-t border-slate-800 px-4 py-3 space-y-2">
              <div
                className={`relative h-2 rounded-full bg-slate-700 ${isUploadedVideo ? 'cursor-pointer group' : ''}`}
                onClick={isUploadedVideo ? (e) => seekTo(e.clientX, e.currentTarget) : undefined}
                role="slider"
                aria-valuenow={currentTime}
                aria-valuemin={0}
                aria-valuemax={lessonDuration}
                aria-label="Video progress"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-slate-500/60"
                  style={{ width: `${Math.min(watchedPercent, 100)}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${Math.min(playPercent, 100)}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow border-2 border-primary"
                  style={{ left: `calc(${Math.min(playPercent, 100)}% - 7px)` }}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isUploadedVideo ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); togglePlay() }}>
                        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setMuted((m) => !m) }}>
                        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                      </Button>
                    </>
                  ) : null}
                  <span className="text-xs text-slate-300 tabular-nums">
                    {formatTime(currentTime)} / {formatTime(lessonDuration)}
                  </span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-slate-500 truncate hidden sm:inline">{activeLesson.title}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  >
                    {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="lg:w-1/4 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900 overflow-y-auto">
          <div className="p-4 border-b border-slate-800">
            <div className="text-sm font-medium mb-2">Course progress</div>
            <div className="h-2 rounded-full bg-slate-700">
              <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-1">{progressPercent}% Complete</p>
          </div>

          <div className="p-2 space-y-1">
            {chapters.map((chapter) => (
              <div key={chapter.id}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 rounded-lg"
                  onClick={() => setOpenChapters((p) => ({ ...p, [chapter.id]: !p[chapter.id] }))}
                >
                  {chapter.title}
                </button>
                {openChapters[chapter.id] ? (
                  <div className="ml-2 space-y-0.5 pb-2">
                    {(chapter.lessons || []).map((lesson) => {
                      const locked = isLessonLocked(lesson, allLessons, progressMap)
                      const done = progressMap.get(lesson.id)?.isCompleted
                      const isActive = lesson.id === activeLesson?.id
                      return (
                        <button
                          key={lesson.id}
                          type="button"
                          disabled={locked}
                          onClick={() => !locked && setActiveLessonId(lesson.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-left ${
                            isActive ? 'bg-primary/20 text-white' : locked ? 'text-slate-500 cursor-not-allowed' : 'text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                          ) : locked ? (
                            <Lock className="h-4 w-4 shrink-0" />
                          ) : (
                            <span className="h-4 w-4 rounded-full border border-slate-500 shrink-0" />
                          )}
                          <span className="truncate">{lesson.title}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
