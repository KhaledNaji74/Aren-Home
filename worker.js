// Aren memory connectionexport default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test Aren's memory
    if (url.pathname === "/memory-test") {
      await env.KV.put("test", "Aren memory is working");

      const memory = await env.KV.get("test");

      return new Response(memory);
    }

    // Serve the existing homepage
    return env.ASSETS.fetch(request);
  }
};
