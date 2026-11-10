import { useEffect, useRef, useState } from 'react'
import type { Result, VisualizationSpec } from 'vega-embed'

export type Column<T> = { key: keyof T & string; label: string; show?: (value: never) => string }

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
// A spec can name a theme colour as "var(--…)". It's read at each draw, so it follows the theme.
const resolved = (spec: object) => JSON.parse(JSON.stringify(spec), (_k, v) => (typeof v === 'string' && v.startsWith('var(--') ? css(v.slice(4, -1)) : v))

// Vega draws with real colour values, so the theme's CSS variables are read each time it draws.
function theme() {
  const [ink, ink2, rule, sheet] = ['--color-ink', '--color-ink-2', '--color-rule', '--color-sheet'].map(css)
  return {
    background: 'transparent',
    font: css('--font-sans') || 'system-ui, sans-serif',
    autosize: { type: 'fit-x', contains: 'padding' },
    view: { stroke: null },
    axis: { labelColor: ink2, titleColor: ink2, gridColor: rule, domainColor: rule, tickColor: rule, labelFontSize: 12, titleFontSize: 12, titleFontWeight: 600 },
    legend: { labelColor: ink, labelFontSize: 13, orient: 'top', title: null },
    range: { category: ['--chart-1', '--chart-2', '--chart-3', '--chart-other'].map(css), heatmap: [css('--chart-low'), css('--chart-high')] },
    // A gap in the sheet colour between touching bars and cells, instead of a border.
    bar: { stroke: sheet, strokeWidth: 2 },
    rect: { stroke: sheet, strokeWidth: 2 },
  }
}

const useTheme = () => {
  const [name, setName] = useState(document.documentElement.dataset.theme)
  useEffect(() => {
    const watch = new MutationObserver(() => setName(document.documentElement.dataset.theme))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => watch.disconnect()
  }, [])
  return name
}

// One chart with a table of the same rows. Specs here are our own: specs from agents need a loader that refuses URLs and vega-interpreter first.
export function Chart<T extends object>({ title, note, spec, rows, columns }: { title: string; note: string; spec: object; rows: T[]; columns: Column<T>[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const themeName = useTheme()

  useEffect(() => {
    if (!rows.length) return
    let gone = false
    let shown: Result | undefined
    // Vega is large, so it loads with the first chart rather than with the app.
    import('vega-embed')
      .then(({ default: embed }) => (gone || !box.current ? undefined : embed(box.current, { ...resolved(spec), description: title, data: { values: rows } } as VisualizationSpec, { actions: false, renderer: 'svg', config: theme() as never })))
      .then((result) => {
        shown = result
        if (gone) result?.finalize()
      })
      .catch((e) => setError(e.message))
    return () => {
      gone = true
      shown?.finalize()
    }
  }, [spec, rows, title, themeName])

  return (
    <figure className="mt-8">
      <figcaption>
        <h2 className="font-extrabold">{title}</h2>
        <p className="text-sm text-ink-2">{note}</p>
      </figcaption>
      {!rows.length ? <p className="mt-2 text-ink-2">Nothing recorded in this range.</p> : error ? <p className="mt-2">The chart couldn't be drawn: {error}</p> : <div ref={box} className="mt-2 w-full" />}
      {rows.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink-2">Show as a table</summary>
          <table className="mt-2 border-collapse tabular-nums">
            <thead>
              <tr>{columns.map((c) => <th key={c.key} className="border-b border-rule py-1 pr-6 text-left font-semibold">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-rule">
                  {columns.map((c) => <td key={c.key} className="py-1 pr-6">{c.show ? c.show(row[c.key] as never) : String(row[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  )
}
