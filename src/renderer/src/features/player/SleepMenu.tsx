import { useEffect, useState, type JSX } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'
import { IconSleep } from '@renderer/ui/Icon'
import { PickerMenu, type PickerOption } from '@renderer/ui/PickerMenu'
import { useT } from '@renderer/i18n'
import { SLEEP_OPTIONS, formatRemaining, remaining, sleepDeadline } from './sleepTimer'

/**
 * Sets the sleep timer, and shows what is left of it.
 *
 * The countdown sits on the button itself rather than in a separate badge, so
 * the control that set the timer is also the one that reports it.
 */
export function SleepMenu(): JSX.Element {
  const sleepAt = useAppStore((state) => state.sleepAt)
  const setSleepAt = useAppStore((state) => state.setSleepAt)
  const t = useT()

  // Local, and only while a timer is running: this re-renders once a second
  // and there is no reason for the rest of the application to do the same.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sleepAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [sleepAt])

  const options: PickerOption<number>[] = [
    { value: 0, label: t('common.off'), hint: t('sleep.offHint') },
    ...SLEEP_OPTIONS.map((minutes) => ({
      value: minutes,
      label: t('sleep.minutes', { minutes })
    }))
  ]

  return (
    <PickerMenu
      label={t('sleep.label')}
      icon={<IconSleep size={16} />}
      current={sleepAt === null ? t('common.off') : formatRemaining(remaining(sleepAt, now))}
      options={options}
      // Nothing is "selected" while a timer runs — it is counting down from a
      // figure that is no longer true — so only Off is ever marked.
      selected={sleepAt === null ? 0 : -1}
      onSelect={(minutes) => setSleepAt(minutes === 0 ? null : sleepDeadline(minutes, Date.now()))}
      title={t('sleep.title')}
    />
  )
}
