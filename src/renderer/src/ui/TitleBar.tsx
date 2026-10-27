import { useEffect, useState, type JSX } from 'react'
import { invoke, subscribe } from '@renderer/lib/api'
import { APP_NAME } from '@shared/app'
import { useAppStore } from '@renderer/store/useAppStore'
import { IconClose, IconMaximize, IconMinimize, IconSearch, IconSidebar } from './Icon'
import { Mark } from '@renderer/ui/Mark'
import { useSidebarRail } from '@renderer/ui/useSidebarRail'
import { useT } from '@renderer/i18n'

interface Props {
  onOpenSearch: () => void
}

export function TitleBar({ onOpenSearch }: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const syncing = useAppStore((s) => s.syncing)
  const rail = useSidebarRail()
  const t = useT()

  useEffect(() => {
    void invoke('window:isMaximized').then(setMaximized)
    return subscribe('window:maximizedChanged', setMaximized)
  }, [])

  const status =
    syncing && syncing.phase !== 'done' && syncing.phase !== 'error' ? syncing.message : null

  return (
    <div className="titlebar">
      {/*
        The sidebar toggle lives here, where the editors and chat apps people
        already use put theirs.
      */}
      <button
        className="titlebar__button titlebar__rail"
        onClick={rail.toggle}
        aria-pressed={rail.collapsed}
        title={`${rail.collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')} (Ctrl+B)`}
        aria-label={rail.collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
      >
        <IconSidebar size={15} />
      </button>

      <div className="titlebar__brand">
        <span className="titlebar__mark"><Mark size={18} /></span>
        {APP_NAME}
      </div>

      <div className="titlebar__spacer" />

      <button
        className="titlebar__search"
        onClick={onOpenSearch}
        title={`${t('nav.searchEverything')} (Ctrl+K)`}
      >
        <IconSearch size={13} />
        <span>{t('nav.search')}</span>
        <kbd>{t('titlebar.searchKey')}</kbd>
      </button>

      <div className="titlebar__spacer" />

      {status && (
        <div className="titlebar__status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" />
          {status}
        </div>
      )}

      <div className="titlebar__controls">
        <button className="titlebar__button" onClick={() => void invoke('window:minimize')} aria-label={t('titlebar.minimize')}>
          <IconMinimize size={15} />
        </button>
        <button
          className="titlebar__button"
          onClick={() => void invoke('window:toggleMaximize').then(setMaximized)}
          aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        >
          <IconMaximize size={13} restore={maximized} />
        </button>
        <button
          className="titlebar__button titlebar__button--close"
          onClick={() => void invoke('window:close')}
          aria-label={t('common.close')}
        >
          <IconClose size={15} />
        </button>
      </div>
    </div>
  )
}
