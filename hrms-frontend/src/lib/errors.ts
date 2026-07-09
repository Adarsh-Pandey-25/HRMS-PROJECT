export function getErrorMessage(error: unknown, fallback = 'Something went wrong') {
  const e = error as {
    response?: {
      data?: {
        error?: { message?: string; details?: Array<{ field?: string; message?: string }> }
        message?: string
      }
    }
    message?: string
  }

  const details = e?.response?.data?.error?.details
  if (Array.isArray(details) && details.length) {
    return details.map((d) => `${d.field || 'field'}: ${d.message}`).join(', ')
  }

  return e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback
}
