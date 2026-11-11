import { useState, type JSX } from 'react'
import { invoke, messageOf } from '@renderer/lib/api'
import { useT } from '@renderer/i18n'

/**
 * One button that answers "what is this machine running".
 *
 * Written after a single question — why a stream Chromium can decode in
 * hardware was being decoded in software — cost eight exchanges, most of them
 * spent establishing facts the application already held: which ffmpeg it had
 * resolved and from where, what the GPU feature table said, whether
 * acceleration was switched on at all.
 *
 * It deliberately draws no conclusion. There is no honest way for a page to
 * say "this stream is hardware decoded" — the one signal the web platform
 * offers, `mediaCapabilities.powerEfficient`, reports what the GPU *could*
 * do, which on the machine with this exact bug would have cheerfully said
 * yes. So the report states what is true and lets a person read it.
 */
export function DiagnosticsSection(): JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const t = useT()

  const collect = (): void => {
    setBusy(true)
    setError(null)
    setCopied(false)
    void invoke('app:diagnostics')
      .then((result) => setText(result.text))
      .catch((caught) => setError(messageOf(caught)))
      .finally(() => setBusy(false))
  }

  const copy = (): void => {
    if (!text) return
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch((caught) => setError(messageOf(caught)))
  }

  return (
    <>
      <div className="settings__row">
        <div>
          <strong>{t('settings.diagnostics')}</strong>
          <span>{error ?? t('settings.diagnosticsBody')}</span>
        </div>
        <button className="btn" onClick={collect} disabled={busy}>
          {busy ? t('settings.diagnosticsWorking') : t('settings.diagnosticsRun')}
        </button>
      </div>

      {text && (
        <div className="settings__diagnostics">
          {/*
            Shown as well as logged. The log is the better artefact, but it
            takes a file manager and an attachment to share; this takes one
            click into whatever the person is already typing in.
          */}
          <pre className="settings__diagnosticsText">{text}</pre>
          <div className="settings__diagnosticsActions">
            <button className="btn" onClick={copy}>
              {copied ? t('settings.diagnosticsCopied') : t('settings.diagnosticsCopy')}
            </button>
            <button className="btn btn--ghost" onClick={() => setText(null)}>
              {t('settings.diagnosticsHide')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
