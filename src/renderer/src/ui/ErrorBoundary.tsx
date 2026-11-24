import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** What the fallback offers to go back to, when going back makes sense. */
  onReset?: () => void
  /** Rendered in the fallback: the strings, so this file needs no translator. */
  labels: {
    title: string
    body: string
    retry: string
    detail: string
  }
}

interface State {
  error: Error | null
  /** Changing this remounts the children, which is what "try again" means. */
  attempt: number
}

/**
 * Keeps one screen's failure from taking the whole application with it.
 *
 * React unmounts the entire tree when a render throws and nothing catches it.
 * Without a boundary that is not a broken screen, it is a **blank window**:
 * no sidebar, no menu, no way back, and nothing on screen to suggest what
 * happened or that restarting would help. This was not hypothetical — walking
 * the application with a provider answering in an unexpected shape blanked it
 * on the first screen that mapped over the answer.
 *
 * Placed around the routed screens and not around the player, deliberately.
 * The player is mounted once and kept alive across every route precisely so
 * that watching survives navigation; putting it inside a boundary would mean
 * an error on an unrelated screen could close the stream.
 *
 * The caller gives this a `key` that changes with the route, so navigating
 * anywhere clears the error without this component having to know what a
 * route is.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Goes to the console, which the log file captures. The message is also
    // shown below, because the person looking at this cannot open a console.
    console.error('A screen failed to render', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    /*
      A keyed fragment, not a keyed div.

      "Try again" has to remount the children, and a key is how that is said.
      But a wrapper element is a change to the DOM, and the player below this
      is mounted once and kept alive deliberately — putting a box around it
      moved it, which broke picture-in-picture and was caught by the harness
      for it. A fragment takes a key and adds nothing.
    */
    if (!error) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>

    const { labels, onReset } = this.props
    return (
      <div className="screenfail" role="alert">
        <div className="screenfail__inner">
          <h2>{labels.title}</h2>
          <p>{labels.body}</p>
          <div className="screenfail__actions">
            <button
              className="btn btn--primary"
              onClick={() => {
                this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))
                onReset?.()
              }}
            >
              {labels.retry}
            </button>
          </div>
          {/*
            The message itself, not a stack: enough to say in a bug report
            what went wrong, without presenting a wall of minified frames as
            though the reader were supposed to act on it.
          */}
          <p className="screenfail__detail">
            {labels.detail}
            <code>{error.message || String(error)}</code>
          </p>
        </div>
      </div>
    )
  }
}
