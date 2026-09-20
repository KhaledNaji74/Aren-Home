export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/memory") {
      const memory = await env.KV.get("memories");
      return new Response(memory || "No memories stored yet.");
    }

    if (url.pathname === "/memory/type") {
      const type = url.searchParams.get("type");

      if (!type) {
        return new Response("Missing memory type", { status: 400 });
      }

      const existing = await env.KV.get("memories");

      if (!existing) {
        return new Response("[]");
      }

      const memories = JSON.parse(existing);

      const filtered = memories.filter(
        memory => memory && memory.type === type
      );

      return new Response(JSON.stringify(filtered));
    }

    if (url.pathname === "/remember") {
      const text = url.searchParams.get("text");
      const type = url.searchParams.get("type") || "general";

      if (!text) {
        return new Response("Missing memory text", { status: 400 });
      }

      const allowedTypes = [
        "identity",
        "principle",
        "experience",
        "lesson",
        "general"
      ];

      if (!allowedTypes.includes(type)) {
        return new Response("Invalid memory type", { status: 400 });
      }

      const existing = await env.KV.get("memories");
      const memories = existing ? JSON.parse(existing) : [];

      memories.push({
        text,
        type,
        created: new Date().toISOString()
      });

      await env.KV.put("memories", JSON.stringify(memories));

      return new Response("Memory saved.");
    }

    return env.ASSETS.fetch(request);
  }
};
