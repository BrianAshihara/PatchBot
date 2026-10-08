import type { APIInteraction } from "discord-api-types/v10";
import { handleInteraction } from "./commands";
import { runCron } from "./cron";
import { verifyInteraction } from "./discord";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/interactions") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const body = await verifyInteraction(request, env.DISCORD_PUBLIC_KEY);
    if (body === null) return new Response("Bad request signature", { status: 401 });
    return handleInteraction(JSON.parse(body) as APIInteraction, env, ctx);
  },

  async scheduled(_controller, env, _ctx): Promise<void> {
    const result = await runCron(env);
    console.log(JSON.stringify(result));
  },
} satisfies ExportedHandler<Env>;
