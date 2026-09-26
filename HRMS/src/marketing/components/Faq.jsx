import { ChevronDown } from 'lucide-react';

/** Native <details> so answers are in the HTML (for search engines) and work without JS. */
export function Faq({ items }) {
  return (
    <div className="mx-auto max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {items.map((item) => (
        <details key={item.q} className="group px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-medium text-ink [&::-webkit-details-marker]:hidden">
            {item.q}
            <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <p className="pb-5 -mt-1 text-slate-600 leading-relaxed">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
