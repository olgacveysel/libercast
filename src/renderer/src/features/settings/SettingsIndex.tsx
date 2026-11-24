import { useEffect, useState, type JSX } from 'react'
import { useT } from '@renderer/i18n'

/**
 * A list of what is on the Settings screen, down the side.
 *
 * Settings is seventeen sections and six screens of scrolling. Pasting a
 * TMDB key means scrolling past three screens of other people's concerns;
 * the parental controls are past five. Measured, not guessed: the pane is
 * 5,143 pixels tall in a 973-pixel window.
 *
 * The screen is also a 720-pixel column, because that is a readable measure
 * for the amount of explanatory prose it carries — which leaves the space
 * beside it empty on any window wider than about eleven hundred pixels. This
 * puts that space to work rather than widening the text.
 *
 * It reads the headings out of the rendered page instead of being told them.
 * A list written here would be a second place to remember when a section is
 * added, and the one that nobody remembers.
 */
interface Entry {
  label: string
  element: HTMLElement
}

export function SettingsIndex(): JSX.Element | null {
  const t = useT()
  const [entries, setEntries] = useState<Entry[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    /*
      After a frame, so the sections have rendered. Settings loads a few
      things asynchronously, so this also runs again shortly afterwards —
      cheaper than watching the whole subtree for changes.
    */
    const read = (): void => {
      const found = [...document.querySelectorAll<HTMLElement>('.settings .settings__group')]
        .map((element) => ({ label: element.querySelector('h3')?.textContent?.trim() ?? '', element }))
        .filter((entry) => entry.label !== '')
      setEntries(found)
    }
    const first = requestAnimationFrame(read)
    const later = setTimeout(read, 1200)
    return () => {
      cancelAnimationFrame(first)
      clearTimeout(later)
    }
  }, [])

  useEffect(() => {
    if (entries.length === 0) return undefined

    /*
      Which section is being read. `rootMargin` pulls the deciding line up
      near the top of the pane, so the heading you have just scrolled to is
      the one highlighted rather than whichever happens to be centred.
    */
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records.filter((record) => record.isIntersecting)
        if (visible.length === 0) return
        const top = visible.reduce((best, record) =>
          record.boundingClientRect.top < best.boundingClientRect.top ? record : best
        )
        const index = entries.findIndex((entry) => entry.element === top.target)
        if (index >= 0) setActive(index)
      },
      { rootMargin: '-8% 0px -80% 0px', threshold: 0 }
    )
    entries.forEach((entry) => observer.observe(entry.element))
    return () => observer.disconnect()
  }, [entries])

  if (entries.length < 4) return null

  return (
    <nav className="settings__index" aria-label={t('settings.sectionsNav')}>
      {entries.map((entry, i) => (
        <button
          key={entry.label}
          type="button"
          className={`settings__index-item ${i === active ? 'settings__index-item--active' : ''}`}
          onClick={() => entry.element.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {entry.label}
        </button>
      ))}
    </nav>
  )
}
