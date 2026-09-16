/** Vite's `?raw` import, for stories that render a document straight out of
 *  the migration that applies it — one copy of the text, no fixture to drift.
 *  The Next build never sees these imports; only Storybook (Vite) does. */
declare module '*.sql?raw' {
  const text: string
  export default text
}
