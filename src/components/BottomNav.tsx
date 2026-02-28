import { useAppStore } from '../store/appStore'

function NavIcon({ id, isActive }: { id: string; isActive: boolean }) {
  const sw = isActive ? '2' : '1.6'

  switch (id) {
    case 'events':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          {isActive && <circle cx="12" cy="16" r="1.5" fill="currentColor" />}
        </svg>
      )
    case 'zones':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      )
    case 'angle':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" fill={isActive ? 'currentColor' : 'none'} />
        </svg>
      )
    case 'first-person':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="3" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="12" y1="16" x2="8" y2="22" />
          <line x1="12" y1="16" x2="16" y2="22" />
        </svg>
      )
    case 'friends':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    case 'ar':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          {isActive ? <circle cx="12" cy="13" r="4" fill="currentColor" /> : <circle cx="12" cy="13" r="4" />}
        </svg>
      )
    case 'menu':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    default:
      return null
  }
}

export default function BottomNav() {
  const activePanel = useAppStore(state => state.activePanel)
  const setActivePanel = useAppStore(state => state.setActivePanel)
  const arMode = useAppStore(state => state.arMode)
  const setArMode = useAppStore(state => state.setArMode)
  const viewMode = useAppStore(state => state.viewMode)
  const setViewMode = useAppStore(state => state.setViewMode)
  const userLocation = useAppStore(state => state.userLocation)

  const buttons = [
    { id: 'events', label: 'События' },
    { id: 'zones', label: 'Зоны' },
    { id: 'angle', label: 'Обзор' },
    { id: 'ar', label: 'AR' },
    { id: 'friends', label: 'Друзья' },
    { id: 'menu', label: 'Ещё' },
  ]

  const handleClick = (id: string) => {
    if (id === 'ar') {
      setArMode(!arMode)
    } else if (id === 'angle' || id === 'first-person') {
      setViewMode(id as any)
      if (id === 'first-person' && userLocation) {
        useAppStore.getState().setCameraTarget(null)
      }
    } else {
      setActivePanel(activePanel === id ? null : id as any)
    }
  }

  return (
    <div className="flex justify-center pb-safe px-2 sm:px-0">
      <div className="mb-2 sm:mb-3 bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl w-full sm:w-auto sm:min-w-[420px] sm:max-w-[780px] mx-auto">
        <div className="flex justify-around sm:justify-center items-center gap-0 px-1 sm:px-2 py-2">
          {buttons.map(button => {
            const isActive = button.id === 'ar'
              ? arMode
              : (button.id === 'angle' || button.id === 'first-person')
                ? viewMode === button.id
                : activePanel === button.id

            return (
              <button
                key={button.id}
                onClick={() => handleClick(button.id)}
                className={`relative flex flex-col items-center gap-0.5 px-2 sm:px-4 py-1.5 rounded-xl transition-all duration-200 ${isActive
                  ? 'text-white'
                  : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-white/10 rounded-xl border border-white/10" />
                )}
                <div className="relative z-10">
                  <NavIcon id={button.id} isActive={isActive} />
                </div>
                <span className={`relative z-10 text-[10px] font-medium tracking-wide ${isActive ? 'text-white' : ''}`}>
                  {button.label}
                </span>
                {isActive && (
                  <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.6)]" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
