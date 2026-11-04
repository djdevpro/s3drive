// Logo de l'appli : dossier stylisé au trait dans une tuile `.ud-logo`
// (tuile sombre en clair, teintée en sombre), point d'accent. Décoratif : le nom l'accompagne.
export function AppLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className={className ? `ud-logo shrink-0 ${className}` : 'ud-logo shrink-0'}>
      <rect className="ud-logo-tile" x="0.5" y="0.5" width="31" height="31" rx="8" />
      <path
        className="ud-logo-ink"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 11.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.2h7a1.5 1.5 0 0 1 1.5 1.5v7.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 21.5z"
      />
      <circle className="ud-logo-dot" cx="23.5" cy="9" r="3" strokeWidth="1.5" />
    </svg>
  );
}
