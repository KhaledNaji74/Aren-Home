export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/memory-test") {
      await env.KV.put("test", "Aren memory is working");
      const memory = await env.KV.get("test");
      return new Response(memory);
    }

    return env.ASSETS.fetch(request);
  }
};
