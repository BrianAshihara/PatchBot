// Os segredos (definidos com `wrangler secret put`, ou no `.dev.vars` localmente) não aparecem no `wrangler types`.
interface Secrets {
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
}

interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
