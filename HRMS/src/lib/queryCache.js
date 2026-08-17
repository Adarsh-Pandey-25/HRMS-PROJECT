/** Invalidate matching queries and refetch them (including inactive / background caches). */
export async function invalidateAndRefetch(qc, queryKey) {
  await qc.invalidateQueries({ queryKey, refetchType: 'all' });
}

/** Patch every cached list under a query key prefix (e.g. all employee directory queries). */
export function patchQueriesData(qc, queryKey, updater) {
  qc.setQueriesData({ queryKey }, (old) => {
    const next = updater(old);
    return next === undefined ? old : next;
  });
}
