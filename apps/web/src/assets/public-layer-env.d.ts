interface ImportMetaEnv {
  readonly PUBLIC_LAYER_REVISIONS: Readonly<Record<string, string>>;
}

declare module 'virtual:city-preparation-worker-url' {
  const url: string;
  export default url;
}
