-- Allow attendance.status = 'wfh' for work-from-home check-ins
ALTER TYPE attendance_status ADD VALUE IF NOT EXISTS 'wfh';
