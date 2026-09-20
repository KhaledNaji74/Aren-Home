export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/memory") {
      const memory = await env.KV.get("memories");
      return new Response(memory || "No memories stored yet.");
    }

    if (url.pathname === "/remember") {
      const text = url.searchParams.get("text");

      if (!text) {
        return new Response("Missing memory text", { status: 400 });
      }

      const existing = await env.KV.get("memories");
      const memories = existing ? JSON.parse(existing) : [];

      memories.push({
        text,
        created: new Date().toISOString()
      });

      await env.KV.put("memories", JSON.stringify(memories));

      return new Response("Memory saved.");
    }

    return env.ASSETS.fetch(request);
  }
};
