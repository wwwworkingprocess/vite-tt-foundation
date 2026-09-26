const paths = {
  info: 'M10 9v6m0-10v1M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17',
  controls: 'M3 5h14M3 15h14M7 2v6m6 4v6',
  folder: 'M2 5V3h6l2 3h8v11H2V5Z',
  save: 'M3 2h12l3 3v13H2V2h1Zm3 0v5h8V2M6 18v-7h8v7',
  restart: 'M3 8a7 7 0 1 1 0 5M3 2v6h6',
  pause: 'M6 3v14M14 3v14',
  play: 'm5 2 12 8-12 8V2Z',
  close: 'm4 4 12 12M16 4 4 16',
  expand: 'm4 7 6 6 6-6',
  collapse: 'm4 13 6-6 6 6',
  plus: 'M10 3v14M3 10h14',
  focus: 'M7 2H2v5m11-5h5v5M2 13v5h5m11-5v5h-5M7 10h6m-3-3v6',
  network: 'M3 3h5v5H3V3Zm9 9h5v5h-5v-5ZM8 5h7v7M5 8v7h7',
  swap: 'M3 6h14l-4-4M17 14H3l4 4',
  layers: 'm10 2 8 4-8 4-8-4 8-4ZM2 10l8 4 8-4M2 14l8 4 8-4',
  people:
    'M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 9v-3a5 5 0 0 1 10 0v3M13 3a3 3 0 0 1 0 6m2 2a4 4 0 0 1 3 4v2',
} as const;

/** Decorative line icons; the adjacent control text remains its accessible name. */
export function ControlIcon({ name }: { readonly name: keyof typeof paths }) {
  return (
    <svg
      className="control-icon"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
