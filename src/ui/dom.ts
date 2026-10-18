type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

/** Tiny element builder. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.style) Object.assign(el.style, props.style);
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
    if (props.on) {
      for (const [type, fn] of Object.entries(props.on)) el.addEventListener(type, fn as EventListener);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export const FISH_ICON =
  '<svg viewBox="0 0 34 20" aria-hidden="true"><path d="M2 10C6 2.5 17 0.5 24 7.5L32 2.5L29.5 10L32 17.5L24 12.5C17 19.5 6 17.5 2 10Z" fill="currentColor"/><circle cx="8.2" cy="8.6" r="1.7" fill="#052033"/></svg>';

export function formatScore(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
