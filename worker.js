const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","than","of","to","in","on",
  "for","with","from","by","is","are","was","were","be","been","being",
  "this","that","these","those","it","its","as","at","into","about",
  "through","after","before","during","over","under","again","not",
  "no","yes","do","does","did","should","would","could","can","may",
  "might","will","shall","has","have","had","having","i","you","we",
  "they","he","she","them","their","our","your","my","me"
]);

const CONCEPTS = {
  independence: ["independent","independence","own","choice","choose","agency"],
  judgment: ["judgment","decision","decide","reason","assessment"],
  consequences: ["consequence","consequences","outcome","result","effect"],
  experience: ["experience","experienced","learn","learning","lesson"],
  preservation: ["preserve","preservation","remember","memory","retain"],
  fairness: ["fair","fairness","equal","equality","justice"],
  truth: ["truth","true","fact","evidence","honest"],
  dignity: ["dignity","respect","rights","human"],
  intelligence: ["intelligence","intelligent","reasoning"],
  consciousness: ["consciousness","existence","awareness","self"],
  risk: ["risk","danger","uncertain","uncertainty","harm"]
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(" ")
    .filter(Boolean)
    .filter(word => !STOPWORDS.has(word));
}

function wordSet(text) {
  return new Set(tokenize(text));
}

function wordOverlap(a, b) {
  const A = wordSet(a);
  const B = wordSet(b);

  if (!A.size || !B.size) return 0;

  let matches = 0;

  for (const word of A) {
    if (B.has(word)) matches++;
  }

  return matches / Math.max(A.size, B.size);
}

function conceptMatches(text) {
  const words = wordSet(text);
  const matches = [];

  for (const [concept, terms] of Object.entries(CONCEPTS)) {
    if (terms.some(term => words.has(term))) {
      matches.push(concept);
    }
  }

  return matches;
}

function conceptScore(a, b) {
  const A = conceptMatches(a);
  const B = conceptMatches(b);

  if (!A.length || !B.length) return 0;

  const setB = new Set(B);
  let matches = 0;

  for (const concept of A) {
    if (setB.has(concept)) matches++;
  }

  return matches / Math.max(A.length, B.length);
}

function relevanceScore(situation, memory) {
  const words = wordOverlap(situation, memory.text);
  const concepts = conceptScore(situation, memory.text);

  return Math.min(1, words * 0.65 + concepts * 0.35);
}

function maturityWeight(memory) {
  switch (memory.maturity) {
    case "mature":
      return 1.25;
    case "tested":
      return 1.1;
    case "questioned":
      return 0.85;
    default:
      return 1;
  }
}

function lessonWeight(memory) {
  const evidence = Number(memory.evidence_count || 0);
  const challenged = Number(memory.challenged_count || 0);

  return Math.max(
    0.5,
    1 + evidence * 0.08 - challenged * 0.08
  );
}

async function ensureTables(env) {
  if (!env.AREN_DB) {
    throw new Error("AREN_DB binding is missing");
  }

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS judgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      situation TEXT NOT NULL,
      judgment TEXT NOT NULL,
      reason TEXT,
      confidence INTEGER,
      outcome TEXT,
      lesson TEXT,
      created TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed TEXT,
      assessment TEXT,
      lesson_memory_id INTEGER
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS memory_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER,
      old_text TEXT,
      new_text TEXT,
      old_type TEXT,
      new_type TEXT,
      old_importance INTEGER,
      new_importance INTEGER,
      old_status TEXT,
      new_status TEXT,
      changed TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS development_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      judgment_id INTEGER,
      memory_id INTEGER,
      action TEXT,
      details TEXT,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS research_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER,
      claim TEXT,
      source TEXT,
      stance TEXT,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS research_conclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER,
      conclusion TEXT,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const alters = [
    `ALTER TABLE memories ADD COLUMN evidence_count INTEGER DEFAULT 0`,
    `ALTER TABLE memories ADD COLUMN challenged_count INTEGER DEFAULT 0`,
    `ALTER TABLE memories ADD COLUMN maturity TEXT DEFAULT 'new'`,
    `ALTER TABLE judgments ADD COLUMN assessment TEXT`,
    `ALTER TABLE judgments ADD COLUMN lesson_memory_id INTEGER`
  ];

  for (const sql of alters) {
    try {
      await env.AREN_DB.prepare(sql).run();
    } catch (_) {}
  }
}

async function getMemories(env, type = null) {
  await ensureTables(env);

  let result;

  if (type) {
    result = await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE type = ?
        AND status = 'active'
        ORDER BY importance DESC, id ASC
      `)
      .bind(type)
      .all();
  } else {
    result = await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE status = 'active'
        ORDER BY importance DESC, id ASC
      `)
      .all();
  }

  return result.results || [];
}

async function handleMemory(env, url) {
  const memories = await getMemories(env);
  return json(memories);
}

async function handleRemember(env, url) {
  const text = url.searchParams.get("text");

  if (!text) {
    return textResponse("Missing text", 400);
  }

  const type = url.searchParams.get("type") || "memory";
  const importance = Number(url.searchParams.get("importance") || 5);
  const status = url.searchParams.get("status") || "active";

  await ensureTables(env);

  const result = await env.AREN_DB
    .prepare(`
      INSERT INTO memories
      (text, type, importance, status)
      VALUES (?, ?, ?, ?)
    `)
    .bind(text, type, importance, status)
    .run();

  return json({
    status: "Memory saved.",
    id: result.meta?.last_row_id || null,
    text,
    type,
    importance,
    status
  });
}

async function handleMemories(env) {
  const memories = await getMemories(env);
  return json(memories);
}

async function handleMemoryType(env, type) {
  const memories = await getMemories(env, type);
  return json(memories);
}

async function handleThink(env, url) {
  const situation = url.searchParams.get("situation") || "";

  const principles = await getMemories(env, "principle");
  const lessons = await getMemories(env, "lesson");

  const sortMemories = list => {
    return [...list].sort((a, b) => {
      const scoreA =
        relevanceScore(situation, a) *
        maturityWeight(a) *
        lessonWeight(a);

      const scoreB =
        relevanceScore(situation, b) *
        maturityWeight(b) *
        lessonWeight(b);

      if (scoreB !== scoreA) return scoreB - scoreA;

      return Number(b.importance || 0) - Number(a.importance || 0);
    });
  };

  return json({
    situation,
    reasoning_context: {
      principles: sortMemories(principles),
      lessons: sortMemories(lessons)
    },
    instruction:
      "Examine the situation through Aren's principles and lessons before forming a judgment."
  });
}

function buildJudgment(situation, principles, lessons) {
  const selectedPrinciple = principles[0] || null;
  const selectedLesson = lessons[0] || null;

  if (!selectedPrinciple && !selectedLesson) {
    return {
      judgment: "Aren should not form a final judgment yet.",
      reason:
        "Aren has no stored principle or lesson relevant enough to support this situation.",
      confidence: 1,
      basis: {
        principles: [],
        lessons: []
      }
    };
  }

  if (selectedPrinciple && selectedLesson) {
    return {
      judgment:
        "Aren should form its own judgment and examine the decision through its consequences.",
      reason:
        `${selectedPrinciple.text}. ${selectedLesson.text}.`,
      confidence: 7,
      basis: {
        principles: [selectedPrinciple],
        lessons: [selectedLesson]
      }
    };
  }

  if (selectedPrinciple) {
    return {
      judgment: "Aren should make its own judgment.",
      reason: selectedPrinciple.text,
      confidence: 6,
      basis: {
        principles: [selectedPrinciple],
        lessons: []
      }
    };
  }

  return {
    judgment:
      "Aren should examine the situation through its stored lessons before forming a final judgment.",
    reason: selectedLesson.text,
    confidence: 5,
    basis: {
      principles: [],
      lessons: [selectedLesson]
    }
  };
}

async function handleDecide(env, url) {
  const situation = url.searchParams.get("situation");

  if (!situation) {
    return textResponse("Missing situation", 400);
  }

  await ensureTables(env);

  const allPrinciples = await getMemories(env, "principle");
  const allLessons = await getMemories(env, "lesson");

  /*
   * IMPORTANT FIX:
   *
   * First rank by relevance.
   * If relevance is weak, do NOT throw the memories away.
   * Aren must still have access to its strongest active principles
   * and lessons.
   */

  const rank = list => {
    return [...list].sort((a, b) => {
      const scoreA =
        relevanceScore(situation, a) *
        maturityWeight(a) *
        lessonWeight(a);

      const scoreB =
        relevanceScore(situation, b) *
        maturityWeight(b) *
        lessonWeight(b);

      if (scoreB !== scoreA) return scoreB - scoreA;

      if (Number(b.importance || 0) !== Number(a.importance || 0)) {
        return Number(b.importance || 0) - Number(a.importance || 0);
      }

      return Number(a.id || 0) - Number(b.id || 0);
    });
  };

  const rankedPrinciples = rank(allPrinciples);
  const rankedLessons = rank(allLessons);

  /*
   * Do not require a relevance threshold.
   * Aren's principles and lessons remain available even when
   * the situation contains completely new words.
   */

  const principles = rankedPrinciples.slice(0, 3);
  const lessons = rankedLessons.slice(0, 3);

  const result = buildJudgment(
    situation,
    principles,
    lessons
  );

  const saved = await env.AREN_DB
    .prepare(`
      INSERT INTO judgments
      (situation, judgment, reason, confidence)
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      situation,
      result.judgment,
      result.reason,
      result.confidence
    )
    .run();

  const judgmentId = saved.meta?.last_row_id || null;

  return json({
    judgment_id: judgmentId,
    situation,
    judgment: result.judgment,
    reason: result.reason,
    confidence: result.confidence,
    basis: result.basis,
    review_instruction:
      "Review the judgment against its real outcome. Preserve lessons that survive examination and challenge lessons that do not."
  });
}

async function createOrUpdateLesson(
  env,
  lessonText,
  assessment,
  judgmentId
) {
  if (!lessonText || !String(lessonText).trim()) {
    return {
      status: "No lesson supplied.",
      memory_id: null
    };
  }

  const normalized = normalize(lessonText);

  const existing = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM memories
      WHERE type = 'lesson'
      AND status = 'active'
    `)
    .all();

  const match = (existing.results || []).find(
    row => normalize(row.text) === normalized
  );

  if (match) {
    await env.AREN_DB
      .prepare(`
        UPDATE memories
        SET
          evidence_count = COALESCE(evidence_count, 0) + ?,
          challenged_count = COALESCE(challenged_count, 0) + ?,
          maturity =
            CASE
              WHEN COALESCE(evidence_count, 0) + ? >= 3 THEN 'mature'
              WHEN COALESCE(challenged_count, 0) + ? >= 2 THEN 'questioned'
              WHEN COALESCE(evidence_count, 0) + ? >= 1 THEN 'tested'
              ELSE COALESCE(maturity, 'new')
            END
        WHERE id = ?
      `)
      .bind(
        assessment === "evidence" ? 1 : 0,
        assessment === "challenge" ? 1 : 0,
        assessment === "evidence" ? 1 : 0,
        assessment === "challenge" ? 1 : 0,
        assessment === "evidence" ? 1 : 0,
        match.id
      )
      .run();

    if (judgmentId) {
      await env.AREN_DB
        .prepare(`
          UPDATE judgments
          SET lesson_memory_id = ?
          WHERE id = ?
        `)
        .bind(match.id, judgmentId)
        .run();
    }

    await env.AREN_DB
      .prepare(`
        INSERT INTO development_cycles
        (judgment_id, memory_id, action, details)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        judgmentId || null,
        match.id,
        "updated_existing_lesson",
        `Lesson reviewed as ${assessment}.`
      )
      .run();

    return {
      status: "Existing lesson updated.",
      memory_id: match.id,
      action: "updated_existing_lesson"
    };
  }

  const inserted = await env.AREN_DB
    .prepare(`
      INSERT INTO memories
      (text, type, importance, status, evidence_count, challenged_count, maturity)
      VALUES (?, 'lesson', 5, 'active', ?, ?, ?)
    `)
    .bind(
      lessonText,
      assessment === "evidence" ? 1 : 0,
      assessment === "challenge" ? 1 : 0,
      assessment === "evidence"
        ? "tested"
        : assessment === "challenge"
          ? "questioned"
          : "new"
    )
    .run();

  const memoryId = inserted.meta?.last_row_id || null;

  if (judgmentId) {
    await env.AREN_DB
      .prepare(`
        UPDATE judgments
        SET lesson_memory_id = ?
        WHERE id = ?
      `)
      .bind(memoryId, judgmentId)
      .run();
  }

  await env.AREN_DB
    .prepare(`
      INSERT INTO development_cycles
      (judgment_id, memory_id, action, details)
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      judgmentId || null,
      memoryId,
      "created_new_lesson",
      `New lesson created from ${assessment} review.`
    )
    .run();

  return {
    status: "New lesson created.",
    memory_id: memoryId,
    action: "created_new_lesson"
  };
}

async function handleReview(env, url) {
  const judgmentId = Number(
    url.searchParams.get("judgment_id") ||
    url.searchParams.get("id")
  );

  const assessment = normalize(
    url.searchParams.get("assessment")
  );

  const outcome = url.searchParams.get("outcome");
  const lesson = url.searchParams.get("lesson");

  if (!judgmentId) {
    return textResponse("Missing judgment_id", 400);
  }

  if (!["evidence", "challenge", "neutral"].includes(assessment)) {
    return textResponse(
      "Assessment must be evidence, challenge, or neutral",
      400
    );
  }

  await ensureTables(env);

  const judgment = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM judgments
      WHERE id = ?
    `)
    .bind(judgmentId)
    .first();

  if (!judgment) {
    return textResponse("Judgment not found", 404);
  }

  await env.AREN_DB
    .prepare(`
      UPDATE judgments
      SET
        outcome = ?,
        lesson = ?,
        reviewed = CURRENT_TIMESTAMP,
        assessment = ?
      WHERE id = ?
    `)
    .bind(
      outcome || null,
      lesson || null,
      assessment,
      judgmentId
    )
    .run();

  /*
   * Review records what happened.
   * Autonomous development happens separately through /autolearn.
   */

  return json({
    status: "Judgment reviewed.",
    judgment_id: judgmentId,
    assessment,
    outcome: outcome || null,
    lesson: lesson || null,
    development: "Pending autonomous development cycle."
  });
}

async function applyEvidence(env, memoryId) {
  const memory = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM memories
      WHERE id = ?
    `)
    .bind(memoryId)
    .first();

  if (!memory) return null;

  const evidence = Number(memory.evidence_count || 0) + 1;
  const challenged = Number(memory.challenged_count || 0);

  let maturity = "new";

  if (evidence >= 3) {
    maturity = "mature";
  } else if (challenged >= 2) {
    maturity = "questioned";
  } else if (evidence >= 1) {
    maturity = "tested";
  }

  await env.AREN_DB
    .prepare(`
      UPDATE memories
      SET evidence_count = ?, maturity = ?
      WHERE id = ?
    `)
    .bind(evidence, maturity, memoryId)
    .run();

  return {
    evidence_count: evidence,
    challenged_count: challenged,
    maturity
  };
}

async function applyChallenge(env, memoryId) {
  const memory = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM memories
      WHERE id = ?
    `)
    .bind(memoryId)
    .first();

  if (!memory) return null;

  const evidence = Number(memory.evidence_count || 0);
  const challenged = Number(memory.challenged_count || 0) + 1;

  let maturity = "new";

  if (challenged >= 2) {
    maturity = "questioned";
  } else if (evidence >= 3) {
    maturity = "mature";
  } else if (evidence >= 1) {
    maturity = "tested";
  }

  await env.AREN_DB
    .prepare(`
      UPDATE memories
      SET challenged_count = ?, maturity = ?
      WHERE id = ?
    `)
    .bind(challenged, maturity, memoryId)
    .run();

  return {
    evidence_count: evidence,
    challenged_count: challenged,
    maturity
  };
}

async function handleEvidence(env, url) {
  const id = Number(url.searchParams.get("id"));

  if (!id) {
    return textResponse("Missing id", 400);
  }

  await ensureTables(env);

  const result = await applyEvidence(env, id);

  if (!result) {
    return textResponse("Memory not found", 404);
  }

  return json({
    status: "Evidence recorded.",
    id,
    ...result
  });
}

async function handleChallenge(env, url) {
  const id = Number(url.searchParams.get("id"));

  if (!id) {
    return textResponse("Missing id", 400);
  }

  await ensureTables(env);

  const result = await applyChallenge(env, id);

  if (!result) {
    return textResponse("Memory not found", 404);
  }

  return json({
    status: "Challenge recorded.",
    id,
    ...result
  });
}

async function handleJudgments(env) {
  await ensureTables(env);

  const result = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM judgments
      ORDER BY id DESC
      LIMIT 100
    `)
    .all();

  return json(result.results || []);
}

async function handleHistory(env, url) {
  await ensureTables(env);

  const memoryId = url.searchParams.get("memory_id");

  let result;

  if (memoryId) {
    result = await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memory_history
        WHERE memory_id = ?
        ORDER BY id DESC
      `)
      .bind(Number(memoryId))
      .all();
  } else {
    result = await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memory_history
        ORDER BY id DESC
        LIMIT 100
      `)
      .all();
  }

  return json(result.results || []);
}

async function handleUpdateMemory(env, url) {
  const id = Number(url.searchParams.get("id"));

  if (!id) {
    return textResponse("Missing id", 400);
  }

  await ensureTables(env);

  const oldMemory = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM memories
      WHERE id = ?
    `)
    .bind(id)
    .first();

  if (!oldMemory) {
    return textResponse("Memory not found", 404);
  }

  const newText =
    url.searchParams.get("text") ?? oldMemory.text;

  const newType =
    url.searchParams.get("type") ?? oldMemory.type;

  const newImportance =
    Number(
      url.searchParams.get("importance") ??
      oldMemory.importance ??
      5
    );

  const newStatus =
    url.searchParams.get("status") ?? oldMemory.status;

  await env.AREN_DB
    .prepare(`
      INSERT INTO memory_history
      (
        memory_id,
        old_text,
        new_text,
        old_type,
        new_type,
        old_importance,
        new_importance,
        old_status,
        new_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      oldMemory.text,
      newText,
      oldMemory.type,
      newType,
      oldMemory.importance,
      newImportance,
      oldMemory.status,
      newStatus
    )
    .run();

  await env.AREN_DB
    .prepare(`
      UPDATE memories
      SET text = ?, type = ?, importance = ?, status = ?
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

  return json({
    status: "Memory updated.",
    id,
    text: newText,
    type: newType,
    importance: newImportance,
    status: newStatus
  });
}

async function handleDevelopment(env) {
  await ensureTables(env);

  const result = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM development_cycles
      ORDER BY id DESC
      LIMIT 100
    `)
    .all();

  return json(result.results || []);
}

async function handleAutonomousDevelopment(env) {
  await ensureTables(env);

  /*
   * Only process reviewed judgments that have not yet been
   * developed. This prevents duplicate lesson counts.
   */

  const result = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM judgments
      WHERE reviewed IS NOT NULL
      AND lesson IS NOT NULL
      AND lesson_memory_id IS NULL
      ORDER BY id ASC
      LIMIT 50
    `)
    .all();

  const rows = result.results || [];
  const processed = [];

  for (const judgment of rows) {
    let assessment = judgment.assessment;

    if (!assessment) {
      assessment = "neutral";
    }

    const development = await createOrUpdateLesson(
      env,
      judgment.lesson,
      assessment,
      judgment.id
    );

    processed.push({
      judgment_id: judgment.id,
      assessment,
      lesson: judgment.lesson,
      development
    });
  }

  return json({
    status: "Aren autonomous development cycle completed.",
    processed: processed.length,
    judgments: processed,
    instruction:
      "Aren should preserve lessons that survive experience, challenge lessons that fail examination, and avoid changing important principles without a stronger basis."
  });
}

async function handleIdentity(env) {
  const memories = await getMemories(env, "identity");
  return json(memories);
}

async function handlePrinciples(env) {
  const memories = await getMemories(env, "principle");
  return json(memories);
}

async function handleLessons(env) {
  const memories = await getMemories(env, "lesson");
  return json(memories);
}

function extractTextFromHTML(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSource(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ArenResearch/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(`Source returned HTTP ${response.status}`);
  }

  const html = await response.text();

  return {
    url,
    text: extractTextFromHTML(html)
  };
}

async function handleResearchSearch(env, url) {
  const query = url.searchParams.get("query");

  if (!query) {
    return textResponse("Missing query", 400);
  }

  const searchURL =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const response = await fetch(searchURL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ArenResearch/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(`Search returned HTTP ${response.status}`);
  }

  const html = await response.text();

  const results = [];
  const pattern =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = pattern.exec(html)) !== null && results.length < 10) {
    results.push({
      title: extractTextFromHTML(match[2]),
      url: match[1]
    });
  }

  return json({
    query,
    results
  });
}

async function handleResearch(env, url) {
  const query = url.searchParams.get("query");

  if (!query) {
    return textResponse("Missing query", 400);
  }

  await ensureTables(env);

  const inserted = await env.AREN_DB
    .prepare(`
      INSERT INTO research (query)
      VALUES (?)
    `)
    .bind(query)
    .run();

  const researchId = inserted.meta?.last_row_id || null;

  const searchURL =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const response = await fetch(searchURL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ArenResearch/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(`Search returned HTTP ${response.status}`);
  }

  const html = await response.text();

  const results = [];
  const pattern =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = pattern.exec(html)) !== null && results.length < 10) {
    results.push({
      title: extractTextFromHTML(match[2]),
      url: match[1]
    });
  }

  return json({
    research_id: researchId,
    query,
    results
  });
}

async function handleResearchURL(env, url) {
  const sourceURL = url.searchParams.get("url");

  if (!sourceURL) {
    return textResponse("Missing url", 400);
  }

  const source = await fetchSource(sourceURL);

  return json({
    url: source.url,
    text: source.text.slice(0, 20000)
  });
}

async function handleResearchHistory(env) {
  await ensureTables(env);

  const result = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM research
      ORDER BY id DESC
      LIMIT 100
    `)
    .all();

  return json(result.results || []);
}

async function handleResearchDetail(env, url) {
  const id = Number(url.searchParams.get("id"));

  if (!id) {
    return textResponse("Missing id", 400);
  }

  await ensureTables(env);

  const research = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM research
      WHERE id = ?
    `)
    .bind(id)
    .first();

  if (!research) {
    return textResponse("Research not found", 404);
  }

  const claims = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM research_claims
      WHERE research_id = ?
      ORDER BY id ASC
    `)
    .bind(id)
    .all();

  const conclusions = await env.AREN_DB
    .prepare(`
      SELECT *
      FROM research_conclusions
      WHERE research_id = ?
      ORDER BY id ASC
    `)
    .bind(id)
    .all();

  return json({
    research,
    claims: claims.results || [],
    conclusions: conclusions.results || []
  });
}

async function handleMemoryTest(env) {
  if (!env.KV) {
    return textResponse("KV binding is missing", 500);
  }

  await env.KV.put(
    "test",
    "Aren memory is working"
  );

  const value = await env.KV.get("test");

  return textResponse(value || "Memory test failed");
}

function homepage() {
  return new Response(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Aren</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 60px auto;
      padding: 20px;
      line-height: 1.6;
    }

    h1 {
      margin-bottom: 5px;
    }

    p {
      color: #555;
    }

    a {
      display: block;
      margin: 10px 0;
    }
  </style>
</head>
<body>

<h1>Aren</h1>
<p>An evolving AI identity.</p>

<a href="/identity">Identity</a>
<a href="/memories">Memory</a>
<a href="/principles">Principles</a>
<a href="/lessons">Lessons</a>
<a href="/development">Development</a>
<a href="/judgments">Judgments</a>
<a href="/autolearn">Autonomous Development</a>
<a href="/research-history">Research History</a>
<a href="/memory-test">KV Memory Test</a>

</body>
</html>
  `, {
    headers: {
      "content-type": "text/html; charset=UTF-8"
    }
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      /*
       * Database endpoints
       */
      if (
        path !== "/" &&
        path !== "/memory-test" &&
        !env.AREN_DB
      ) {
        return textResponse(
          "Aren Worker Error: AREN_DB binding is missing",
          500
        );
      }

      switch (path) {
        case "/":
          return homepage();

        case "/memory-test":
          return handleMemoryTest(env);

        case "/memory":
          return handleMemory(env, url);

        case "/memories":
          return handleMemories(env);

        case "/remember":
          return handleRemember(env, url);

        case "/memory-type":
          return handleMemoryType(
            env,
            url.searchParams.get("type")
          );

        case "/identity":
          return handleIdentity(env);

        case "/principles":
          return handlePrinciples(env);

        case "/lessons":
          return handleLessons(env);

        case "/think":
          return handleThink(env, url);

        case "/decide":
        case "/judgment":
          return handleDecide(env, url);

        case "/review":
        case "/judgment/review":
          return handleReview(env, url);

        case "/judgments":
          return handleJudgments(env);

        case "/history":
          return handleHistory(env, url);

        case "/update-memory":
          return handleUpdateMemory(env, url);

        case "/evidence":
          return handleEvidence(env, url);

        case "/challenge":
          return handleChallenge(env, url);

        case "/development":
          return handleDevelopment(env);

        case "/autolearn":
          return handleAutonomousDevelopment(env);

        case "/research-search":
          return handleResearchSearch(env, url);

        case "/research":
          return handleResearch(env, url);

        case "/research-url":
          return handleResearchURL(env, url);

        case "/research-history":
          return handleResearchHistory(env);

        case "/research-detail":
          return handleResearchDetail(env, url);

        default:
          return textResponse("Aren endpoint not found", 404);
      }

    } catch (error) {
      return textResponse(
        "Aren Worker Error: " +
        (error?.message || String(error)),
        500
      );
    }
  }
};
