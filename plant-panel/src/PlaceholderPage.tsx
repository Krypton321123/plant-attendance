/**
 * Temporary placeholder for pages not yet built.
 * Replace with your real page component — just swap it in the router.
 */
interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export default function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm">
        <svg
          className="text-zinc-300"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
      </div>
      <h1 className="text-lg font-semibold text-zinc-800">{title}</h1>
      <p className="max-w-xs text-sm text-zinc-400">
        {description ?? 'This page is under construction. Replace this component in your router.'}
      </p>
    </div>
  );
}