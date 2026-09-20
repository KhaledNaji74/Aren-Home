export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // MEMORY — GET ALL
    // =========================
    if (url.pathname === "/memory") {
      const memory = await env.KV.get("memories");
      return new Response(memory || "No memories stored yet.");
    }

    // =========================
    // MEMORY — GET BY TYPE
    // =========================
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

    // =========================
    // MEMORY — CREATE
    // =========================
    if (url.pathname === "/remember") {
      const text = url.searchParams.get("text");
      const type = url.searchParams.get("type") || "general";
      const importance = Number(
        url.searchParams.get("importance") || 3
      );
      const status = url.searchParams.get("status") || "active";

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

      const allowedStatuses = [
        "active",
        "review",
        "archived"
      ];

      if (!allowedTypes.includes(type)) {
        return new Response("Invalid memory type", { status: 400 });
      }

      if (!allowedStatuses.includes(status)) {
        return new Response("Invalid memory status", { status: 400 });
      }

      if (
        !Number.isFinite(importance) ||
        importance < 1 ||
        importance > 5
      ) {
        return new Response(
          "Importance must be between 1 and 5",
          { status: 400 }
        );
      }

      const existing = await env.KV.get("memories");
      const memories = existing ? JSON.parse(existing) : [];

      memories.push({
        id: crypto.randomUUID(),
        text,
        type,
        importance,
        status,
        created: new Date().toISOString(),
        history: []
      });

      await env.KV.put(
        "memories",
        JSON.stringify(memories)
      );

      return new Response("Memory saved.");
    }

    // =========================
    // MEMORY — UPDATE
    // =========================
    if (url.pathname === "/memory/update") {
      const id = url.searchParams.get("id");
      const text = url.searchParams.get("text");
      const type = url.searchParams.get("type");
      const importanceParam =
        url.searchParams.get("importance");
      const status = url.searchParams.get("status");

      if (!id) {
        return new Response(
          "Missing memory id",
          { status: 400 }
        );
      }

      const existing = await env.KV.get("memories");

      if (!existing) {
        return new Response(
          "No memories stored yet."
        );
      }

      const memories = JSON.parse(existing);
      const memory = memories.find(
        item => item.id === id
      );

      if (!memory) {
        return new Response(
          "Memory not found",
          { status: 404 }
        );
      }

      if (!memory.history) {
        memory.history = [];
      }

      // Save previous version
      memory.history.push({
        text: memory.text,
        type: memory.type,
        importance: memory.importance,
        status: memory.status,
        saved: new Date().toISOString()
      });

      // Update text
      if (text) {
        memory.text = text;
      }

      // Update type
      if (type) {
        const allowedTypes = [
          "identity",
          "principle",
          "experience",
          "lesson",
          "general"
        ];

        if (!allowedTypes.includes(type)) {
          return new Response(
            "Invalid memory type",
            { status: 400 }
          );
        }

        memory.type = type;
      }

      // Update importance
      if (importanceParam !== null) {
        const importance = Number(
          importanceParam
        );

        if (
          !Number.isFinite(importance) ||
          importance < 1 ||
          importance > 5
        ) {
          return new Response(
            "Importance must be between 1 and 5",
            { status: 400 }
          );
        }

        memory.importance = importance;
      }

      // Update status
      if (status) {
        const allowedStatuses = [
          "active",
          "review",
          "archived"
        ];

        if (!allowedStatuses.includes(status)) {
          return new Response(
            "Invalid memory status",
            { status: 400 }
          );
        }

        memory.status = status;
      }

      memory.updated =
        new Date().toISOString();

      await env.KV.put(
        "memories",
        JSON.stringify(memories)
      );

      return new Response(
        "Memory updated."
      );
    }

    // =========================
    // MEMORY — HISTORY
    // =========================
    if (url.pathname === "/memory/history") {
      const id = url.searchParams.get("id");

      if (!id) {
        return new Response(
          "Missing memory id",
          { status: 400 }
        );
      }

      const existing = await env.KV.get("memories");

      if (!existing) {
        return new Response("[]");
      }

      const memories = JSON.parse(existing);

      const memory = memories.find(
        item => item.id === id
      );

      if (!memory) {
        return new Response(
          "Memory not found",
          { status: 404 }
        );
      }

      return new Response(
        JSON.stringify(memory.history || [])
      );
    }

    // =========================
    // JUDGMENT — RECORD
    // =========================
    if (url.pathname === "/judgment") {
      const reason =
        url.searchParams.get("reason");

      if (!reason) {
        return new Response(
          "Missing judgment reason",
          { status: 400 }
        );
      }

      const existing =
        await env.KV.get("judgments");

      const judgments = existing
        ? JSON.parse(existing)
        : [];

      judgments.push({
        id: crypto.randomUUID(),
        reason,
        created: new Date().toISOString()
      });

      await env.KV.put(
        "judgments",
        JSON.stringify(judgments)
      );

      return new Response(
        "Judgment recorded."
      );
    }

    // =========================
    // JUDGMENTS — GET ALL
    // =========================
    if (url.pathname === "/judgments") {
      const judgments =
        await env.KV.get("judgments");

      return new Response(
        judgments || "[]"
      );
    }

    // =========================
    // WEBSITE
    // =========================
    return env.ASSETS.fetch(request);
  }
};
