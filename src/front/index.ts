interface FrontEnv {
	ASSETS: Fetcher;
	CORE: Fetcher;
	ATTEMPT_LIMIT: RateLimit;
	READ_LIMIT: RateLimit;
}

function limiterFor(env: FrontEnv, request: Request): RateLimit {
	return request.method === "POST" ? env.ATTEMPT_LIMIT : env.READ_LIMIT;
}

async function proxyApi(request: Request, env: FrontEnv): Promise<Response> {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const { success } = await limiterFor(env, request).limit({ key: ip });
	if (!success) return Response.json({ error: "rate limited" }, { status: 429 });
	return env.CORE.fetch(request);
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/")) return proxyApi(request, env);
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<FrontEnv>;
