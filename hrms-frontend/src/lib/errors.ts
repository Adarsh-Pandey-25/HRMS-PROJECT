export function getErrorMessage(error: unknown, fallback = 'Something went wrong') {
  const e = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string }
  return e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback
}
