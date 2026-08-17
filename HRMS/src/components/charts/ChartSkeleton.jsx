/** Shimmer placeholder shown while a chart (especially the lazy-loaded 3D ones)
 *  is still initialising — avoids a blank/collapsing card. */
export function ChartSkeleton({ height = 300 }) {
  return (
    <div
      className="animate-pulse rounded-2xl w-full bg-gradient-to-r from-muted via-muted/50 to-muted"
      style={{ height }}
    />
  );
}

export default ChartSkeleton;
