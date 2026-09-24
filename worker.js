export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // HOME
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
    <a href="/think?situation=Test">Think</a>
    <a href="/decide?situation=Test">Decide</a>
  </p>
</body>
</html>
        `, {
          headers: {
            "Content-Type": "text/html; charset=UTF-8"
          }
        });
      }

      // ALL MEMORY
      if (url.pathname === "/memory") {
        const result = await env.AREN_DB
          .prepare(`
            SELECT
              id,
              text,
              type,
              importance,
              status,
              evidence_count,
              challenged_count,
              maturity,
              saved
            FROM memories
            ORDER BY importance DESC, id DESC
          `)
          .all();

        return json(result.results || []);
      }

      // MEMORY BY TYPE
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
              evidence_count,
              challenged_count,
              maturity,
              saved
            FROM memories
            WHERE type = ?
            ORDER BY importance DESC, id DESC
          `)
          .bind(type)
          .all();

        return json(result.results || []);
      }

      // REMEMBER
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

      // UPDATE MEMORY
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
              evidence_count,
              challenged_count,
              maturity,
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

      // MEMORY HISTORY
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

      // THINK
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
              evidence_count,
              challenged_count,
              maturity,
              saved
            FROM memories
            WHERE type = 'lesson'
              AND status = 'active'
            ORDER BY
              CASE maturity
                WHEN 'mature' THEN 1
                WHEN 'supported' THEN 2
                WHEN 'tested' THEN 3
                WHEN 'questioned' THEN 4
                WHEN 'new' THEN 5
                ELSE 6
              END,
              importance DESC,
              id DESC
          `)
          .all();

        return json({
          situation,
          reasoning_context: {
            principles: principles.results || [],
            lessons: lessons.results || []
          },
          instruction:
            "Use mature lessons as strong guidance, supported lessons as supporting evidence, tested lessons cautiously, questioned lessons as disputed, and new lessons as untested. Examine the situation through Aren's principles and lessons before forming a judgment."
        });
      }

      // DECIDE
      if (url.pathname === "/decide") {
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
              evidence_count,
              challenged_count,
              maturity,
              saved
            FROM memories
            WHERE type = 'lesson'
              AND status = 'active'
            ORDER BY importance DESC, id DESC
          `)
          .all();

        const principleList =
          principles.results || [];

        const lessonList =
          lessons.results || [];

        const situationWords =
          tokenize(situation);

        const matchedPrinciples =
          principleList
            .map(p => ({
              ...p,
              relevance:
                wordOverlap(
                  situationWords,
                  p.text
                )
            }))
            .filter(p => p.relevance > 0)
            .sort(
              (a, b) =>
                b.relevance - a.relevance ||
                b.importance - a.importance
            );

        const maturityWeight = {
          mature: 4,
          supported: 3,
          tested: 2,
          questioned: 1,
          new: 0
        };

        const matchedLessons =
          lessonList
            .map(l => ({
              ...l,
              relevance:
                wordOverlap(
                  situationWords,
                  l.text
                ),
              maturity_weight:
                maturityWeight[l.maturity] ?? 0
            }))
            .filter(l => l.relevance > 0)
            .sort(
              (a, b) =>
                (
                  b.relevance *
                  (b.maturity_weight + 1)
                ) -
                (
                  a.relevance *
                  (a.maturity_weight + 1)
                )
            );

        const strongestPrinciple =
          matchedPrinciples[0];

        const strongestLesson =
          matchedLessons[0];

        let judgment;
        let reason;
        let confidence;

        if (
          !strongestPrinciple &&
          !strongestLesson
        ) {
          judgment =
            "Aren should not form a final judgment yet.";

          reason =
            "No stored principle or lesson has a direct relevance match with the supplied situation. More evidence or a clearer basis is required.";

          confidence = 2;

        } else if (
          strongestLesson &&
          strongestLesson.maturity === "questioned"
        ) {
          judgment =
            "Aren should proceed cautiously and keep the judgment provisional.";

          reason =
            "The strongest relevant lesson is questioned, so it can inform the judgment but should not control it.";

          confidence = 2;

        } else {
          let basis;

          if (strongestPrinciple) {
            basis =
              `principle: "${strongestPrinciple.text}"`;
          } else {
            basis =
              `lesson: "${strongestLesson.text}"`;
          }

          judgment =
            "Aren should examine the situation according to its strongest relevant stored basis before acting.";

          reason =
            `The strongest relevant ${basis}. Lessons are weighted by their tested maturity, while newer or challenged lessons are treated with caution.`;

          if (
            strongestLesson &&
            strongestLesson.maturity === "mature"
          ) {
            confidence = 4;
          } else if (
            strongestLesson &&
            strongestLesson.maturity === "supported"
          ) {
            confidence = 3;
          } else {
            confidence = 2;
          }
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

        const insert =
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

        return json({
          judgment_id:
            insert.meta?.last_row_id || null,

          situation,

          judgment,

          reason,

          confidence,

          basis: {
            principles:
              matchedPrinciples,

            lessons:
              matchedLessons
          },

          review_instruction:
            "Review the judgment against its real outcome. Preserve lessons that survive examination and challenge lessons that do not."
        });
      }

      // MANUAL JUDGMENT
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

      // ALL JUDGMENTS
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

        const result =
          await env.AREN_DB
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

        return json(
          result.results || []
        );
      }

      // REVIEW JUDGMENT
      if (url.pathname === "/judgment/review") {
        const id =
          Number(
            url.searchParams.get("id")
          );

        const outcome =
          url.searchParams.get("outcome");

        const lesson =
          url.searchParams.get("lesson");

        const validation =
          url.searchParams.get("validation") ||
          "support";

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

        if (
          validation !== "support" &&
          validation !== "challenge"
        ) {
          return new Response(
            "Validation must be support or challenge",
            { status: 400 }
          );
        }

        const judgmentRecord =
          await env.AREN_DB
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
              WHERE id = ?
            `)
            .bind(id)
            .first();

        if (!judgmentRecord) {
          return new Response(
            "Judgment not found",
            { status: 404 }
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

        if (lesson) {
          const existingLesson =
            await env.AREN_DB
              .prepare(`
                SELECT
                  id,
                  evidence_count,
                  challenged_count,
                  maturity
                FROM memories
                WHERE text = ?
                  AND type = 'lesson'
                LIMIT 1
              `)
              .bind(lesson)
              .first();

          if (!existingLesson) {
            const evidenceCount =
              validation === "support"
                ? 1
                : 0;

            const challengedCount =
              validation === "challenge"
                ? 1
                : 0;

            const maturity =
              getLessonMaturity(
                evidenceCount,
                challengedCount
              );

            await env.AREN_DB
              .prepare(`
                INSERT INTO memories
                (
                  text,
                  type,
                  importance,
                  status,
                  evidence_count,
                  challenged_count,
                  maturity
                )
                VALUES (
                  ?,
                  'lesson',
                  5,
                  'active',
                  ?,
                  ?,
                  ?
                )
              `)
              .bind(
                lesson,
                evidenceCount,
                challengedCount,
                maturity
              )
              .run();

          } else {
            let evidenceCount =
              existingLesson.evidence_count || 0;

            let challengedCount =
              existingLesson.challenged_count || 0;

            if (validation === "support") {
              evidenceCount += 1;
            }

            if (validation === "challenge") {
              challengedCount += 1;
            }

            const maturity =
              getLessonMaturity(
                evidenceCount,
                challengedCount
              );

            await env.AREN_DB
              .prepare(`
                UPDATE memories
                SET
                  evidence_count = ?,
                  challenged_count = ?,
                  maturity = ?,
                  saved = CURRENT_TIMESTAMP
                WHERE id = ?
              `)
              .bind(
                evidenceCount,
                challengedCount,
                maturity,
                existingLesson.id
              )
              .run();
          }
        }

        return new Response(
          "Judgment reviewed and lesson validated."
        );
      }

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


// TOKENIZE TEXT
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(word => word.length > 2);
}


// CALCULATE WORD OVERLAP
function wordOverlap(
  situationWords,
  memoryText
) {
  const memoryWords =
    new Set(
      tokenize(memoryText)
    );

  return situationWords.filter(
    word => memoryWords.has(word)
  ).length;
}


// LESSON MATURITY
function getLessonMaturity(
  evidence,
  challenges
) {
  const total =
    evidence + challenges;

  if (total === 0) {
    return "new";
  }

  if (challenges > evidence) {
    return "questioned";
  }

  if (
    evidence >= 3 &&
    challenges === 0
  ) {
    return "mature";
  }

  if (evidence > challenges) {
    return "supported";
  }

  return "tested";
}


// JSON RESPONSE
function json(data) {
  return new Response(
    JSON.stringify(data),
    {
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}
