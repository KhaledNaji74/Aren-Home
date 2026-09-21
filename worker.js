export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // =========================
      // HOME
      // =========================
      if (url.pathname === "/") {
        return new Response(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aren</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 60px auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1 { font-size: 42px; }
    a {
      display: inline-block;
      margin-right: 20px;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <h1>Aren</h1>
  <p>An evolving AI identity.</p>

  <p>
    <a href="/memory">Memory</a>
    <a href="/memory/type?type=lesson">Lessons</a>
    <a href="/judgments">Judgments</a>
  </p>
</body>
</html>
        `, {
          headers: {
            "Content-Type": "text/html; charset=UTF-8"
          }
        });
      }

      // =========================
      // MEMORY — GET ALL
      // =========================
      if (url.pathname === "/memory") {
        const result = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              text,
              type,
              importance,
              status,
              saved
            FROM memories
            ORDER BY importance DESC, id DESC
          `)
          .all();

        return json(result.results || []);
      }

      // =========================
      // MEMORY — GET BY TYPE
      // =========================
      if (url.pathname === "/memory/type") {
        const type = url.searchParams.get("type");

        if (!type) {
          return new Response("Missing memory type", {
            status: 400
          });
        }

        const result = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              text,
              type,
              importance,
              status,
              saved
            FROM memories
            WHERE type = ?
            ORDER BY importance DESC, id DESC
          `)
          .bind(type)
          .all();

        return json(result.results || []);
      }

      // =========================
      // MEMORY — CREATE
      // =========================
      if (url.pathname === "/remember") {
        const text = url.searchParams.get("text");
        const type =
          url.searchParams.get("type") || "general";

        const importance = Number(
          url.searchParams.get("importance") || 3
        );

        const status =
          url.searchParams.get("status") || "active";

        if (!text) {
          return new Response("Missing memory text", {
            status: 400
          });
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
          return new Response("Invalid memory type", {
            status: 400
          });
        }

        if (!allowedStatuses.includes(status)) {
          return new Response("Invalid memory status", {
            status: 400
          });
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

        await env.AREN_DB
          .prepare(`
            INSERT INTO memories
            (text, type, importance, status)
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            text,
            type,
            importance,
            status
          )
          .run();

        return new Response("Memory saved.");
      }

      // =========================
      // MEMORY — UPDATE
      // =========================
      if (url.pathname === "/memory/update") {
        const id = Number(
          url.searchParams.get("id")
        );

        if (!Number.isInteger(id)) {
          return new Response(
            "Invalid memory id",
            { status: 400 }
          );
        }

        const current = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              text,
              type,
              importance,
              status,
              saved
            FROM memories
            WHERE id = ?
          `)
          .bind(id)
          .first();

        if (!current) {
          return new Response(
            "Memory not found",
            { status: 404 }
          );
        }

        const text =
          url.searchParams.get("text");

        const type =
          url.searchParams.get("type");

        const importanceParam =
          url.searchParams.get("importance");

        const status =
          url.searchParams.get("status");

        await env.AREN_DB.prepare(`
          CREATE TABLE IF NOT EXISTS memory_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            text TEXT,
            type TEXT,
            importance INTEGER,
            status TEXT,
            saved TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `).run();

        await env.AREN_DB
          .prepare(`
            INSERT INTO memory_history
            (memory_id, text, type, importance, status)
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            id,
            current.text,
            current.type,
            current.importance,
            current.status
          )
          .run();

        let newText = current.text;
        let newType = current.type;
        let newImportance = current.importance;
        let newStatus = current.status;

        if (text) {
          newText = text;
        }

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

          newType = type;
        }

        if (importanceParam !== null) {
          newImportance = Number(importanceParam);

          if (
            !Number.isFinite(newImportance) ||
            newImportance < 1 ||
            newImportance > 5
          ) {
            return new Response(
              "Importance must be between 1 and 5",
              { status: 400 }
            );
          }
        }

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

          newStatus = status;
        }

        await env.AREN_DB
          .prepare(`
            UPDATE memories
            SET
              text = ?,
              type = ?,
              importance = ?,
              status = ?,
              saved = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(
            newText,
            newType,
            newImportance,
            newStatus,
            id
          )
          .run();

        return new Response("Memory updated.");
      }

      // =========================
      // MEMORY — HISTORY
      // =========================
      if (url.pathname === "/memory/history") {
        const id = Number(
          url.searchParams.get("id")
        );

        if (!Number.isInteger(id)) {
          return new Response(
            "Invalid memory id",
            { status: 400 }
          );
        }

        await env.AREN_DB.prepare(`
          CREATE TABLE IF NOT EXISTS memory_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            text TEXT,
            type TEXT,
            importance INTEGER,
            status TEXT,
            saved TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `).run();

        const result = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              memory_id,
              text,
              type,
              importance,
              status,
              saved
            FROM memory_history
            WHERE memory_id = ?
            ORDER BY id DESC
          `)
          .bind(id)
          .all();

        return json(result.results || []);
      }

      // =========================
      // THINK
      // =========================
      if (url.pathname === "/think") {
        const situation =
          url.searchParams.get("situation");

        if (!situation) {
          return new Response(
            "Missing situation",
            { status: 400 }
          );
        }

        const principles = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              text,
              importance,
              saved
            FROM memories
            WHERE type = 'principle'
              AND status = 'active'
            ORDER BY importance DESC, id DESC
          `)
          .all();

        const lessons = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              text,
              importance,
              saved
            FROM memories
            WHERE type = 'lesson'
              AND status = 'active'
            ORDER BY importance DESC, id DESC
          `)
          .all();

        return json({
          situation,

          reasoning_context: {
            principles: principles.results || [],
            lessons: lessons.results || []
          },

          instruction:
            "Examine the situation through Aren's principles and lessons before forming a judgment."
        });
      }

      // =========================
      // JUDGMENT — CREATE
      // =========================
      if (url.pathname === "/judgment") {
        const situation =
          url.searchParams.get("situation");

        const judgment =
          url.searchParams.get("judgment");

        const reason =
          url.searchParams.get("reason");

        const confidence =
          Number(
            url.searchParams.get("confidence") || 3
          );

        if (!situation) {
          return new Response(
            "Missing situation",
            { status: 400 }
          );
        }

        if (!judgment) {
          return new Response(
            "Missing judgment",
            { status: 400 }
          );
        }

        if (!reason) {
          return new Response(
            "Missing judgment reason",
            { status: 400 }
          );
        }

        if (
          !Number.isFinite(confidence) ||
          confidence < 1 ||
          confidence > 5
        ) {
          return new Response(
            "Confidence must be between 1 and 5",
            { status: 400 }
          );
        }

        await env.AREN_DB.prepare(`
          CREATE TABLE IF NOT EXISTS judgments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            situation TEXT NOT NULL,
            judgment TEXT NOT NULL,
            reason TEXT NOT NULL,
            confidence INTEGER NOT NULL,
            outcome TEXT,
            lesson TEXT,
            created TEXT DEFAULT CURRENT_TIMESTAMP,
            reviewed TEXT
          )
        `).run();

        await env.AREN_DB
          .prepare(`
            INSERT INTO judgments
            (situation, judgment, reason, confidence)
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            situation,
            judgment,
            reason,
            confidence
          )
          .run();

        return new Response(
          "Judgment recorded."
        );
      }

      // =========================
      // JUDGMENTS — GET ALL
      // =========================
      if (url.pathname === "/judgments") {
        await env.AREN_DB.prepare(`
          CREATE TABLE IF NOT EXISTS judgments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            situation TEXT NOT NULL,
            judgment TEXT NOT NULL,
            reason TEXT NOT NULL,
            confidence INTEGER NOT NULL,
            outcome TEXT,
            lesson TEXT,
            created TEXT DEFAULT CURRENT_TIMESTAMP,
            reviewed TEXT
          )
        `).run();

        const result = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              situation,
              judgment,
              reason,
              confidence,
              outcome,
              lesson,
              created,
              reviewed
            FROM judgments
            ORDER BY id DESC
          `)
          .all();

        return json(result.results || []);
      }

      // =========================
      // JUDGMENT — REVIEW
      // =========================
      if (url.pathname === "/judgment/review") {
        const id = Number(
          url.searchParams.get("id")
        );

        const outcome =
          url.searchParams.get("outcome");

        const lesson =
          url.searchParams.get("lesson");

        if (!Number.isInteger(id)) {
          return new Response(
            "Invalid judgment id",
            { status: 400 }
          );
        }

        if (!outcome) {
          return new Response(
            "Missing outcome",
            { status: 400 }
          );
        }

        await env.AREN_DB
          .prepare(`
            UPDATE judgments
            SET
              outcome = ?,
              lesson = ?,
              reviewed = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(
            outcome,
            lesson || null,
            id
          )
          .run();

        return new Response(
          "Judgment reviewed."
        );
      }

      // =========================
      // 404
      // =========================
      return new Response(
        "Aren endpoint not found.",
        { status: 404 }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Aren Worker Error",
          message: error.message
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
  }
};


// =========================
// JSON HELPER
// =========================
function json(data) {
  return new Response(
    JSON.stringify(data),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
