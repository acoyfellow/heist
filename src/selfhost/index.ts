import core from "../worker/index";

export { Arcade, Brain } from "../worker/index";

interface SelfHostEnv {
	ASSETS: Fetcher;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/")) return core.fetch(request, env, ctx);

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<SelfHostEnv & Parameters<typeof core.fetch>[1]>;
