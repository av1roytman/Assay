import { Component, type ReactNode } from 'react'

interface Props {
  // Changes when fresh content arrives (a panel's savedAt), so a previous
  // render error doesn't permanently stick the card in its failed state.
  resetKey?: unknown
  children: ReactNode
}

interface State {
  failed: boolean
  lastKey: unknown
}

// Catches render errors inside a single dashboard card so one malformed panel
// degrades to an inline notice instead of blanking the whole window. (Server-
// side validatePanel rejects most bad pushes; this is the backstop.)
export class PanelBoundary extends Component<Props, State> {
  state: State = { failed: false, lastKey: this.props.resetKey }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastKey) return { failed: false, lastKey: props.resetKey }
    return null
  }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    console.error('[panel] render failed:', error)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <div className="py-6 text-sm text-red-400/80">Panel failed to render.</div>
    }
    return this.props.children
  }
}
