// Local typings for import.meta.env. The project depends on vite-plus, which
// does not ship a resolvable `vite/client` package; do not reference that path.
interface ImportMetaEnv {
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR?: boolean
  readonly VITE_PREVIEW_MOCK?: string
  readonly WXT_PUBLIC_ANALYTICS_ENDPOINT?: string
  readonly WXT_PUBLIC_SUPABASE_URL?: string
  readonly WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
  readonly WXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?: string
  readonly WXT_PUBLIC_POSTHOG_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
