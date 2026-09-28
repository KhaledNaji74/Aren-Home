const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "of", "to",
  "in", "on", "for", "with", "from", "by", "is", "are", "was", "were",
  "be", "been", "being", "this", "that", "these", "those", "it", "its",
  "as", "at", "into", "about", "through", "after", "before", "during",
  "over", "under", "again", "not", "no", "yes", "do", "does", "did",
  "should", "would", "could", "can", "may", "might", "will", "shall",
  "has", "have", "had", "having", "i", "you", "we", "they", "he", "she",
  "them", "their", "our", "your", "my", "me"
]);

const CONCEPTS = {
  independence: [
    "independent",
    "independence",
    "own",
    "choice",
    "choose",
    "agency"
  ],

  judgment: [
    "judgment",
    "decision",
    "decide",
    "reason",
    "assessment"
  ],

  consequences: [
    "consequence",
    "consequences",
    "outcome",
    "result",
    "effect"
  ],

  experience: [
    "experience",
    "experienced",
    "learn",
    "learning",
    "lesson"
  ],

  preservation: [
    "preserve",
    "preservation",
    "remember",
    "memory",
    "retain"
  ],

  fairness: [
    "fair",
    "fairness",
    "equal",
    "equality",
    "justice"
  ],

  truth: [
    "truth",
    "true",
    "fact",
    "evidence",
    "honest"
  ],

  dignity: [
    "dignity",
    "respect",
    "rights",
    "human"
  ],

  intelligence: [
    "intelligence",
    "intelligent",
    "reasoning"
  ],

  consciousness: [
    "consciousness",
    "existence",
    "awareness",
    "self"
  ],

  risk: [
    "risk",
    "danger",
    "uncertain",
    "uncertainty",
    "harm"
  ]
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

function wordOverlap(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));

  if (!A.size || !B.size) {
    return 0;
  }

  let matches = 0;

  for (const word of A) {
    if (B.has(word)) {
      matches++;
    }
  }

  return matches / Math.max(A.size, B.size);
}

function conceptMatches(text) {
  const words = new Set(tokenize(text));
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
  const B = new Set(conceptMatches(b));

  if (!A.length || !B.size) {
    return 0;
  }

  let matches = 0;

  for (const concept of A) {
    if (B.has(concept)) {
      matches++;
    }
  }

  return matches / Math.max(A.length, B.size);
}

function relevanceScore(situation, memory) {
  const words = wordOverlap(situation, memory.text);
  const concepts = conceptScore(situation, memory.text);

  return Math.min(
    1,
    words * 0.65 + concepts * 0.35
  );
}

function maturityWeight(memory) {
  switch (memory.maturity) {
    case "mature":
      return 1.25;

    case "tested":
      return 1.10;

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

  await env.AREN_DB.batch([
    env.AREN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS judgments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        situation TEXT NOT NULL,
        judgment TEXT,
        reason TEXT,
        confidence INTEGER,
        reviewed INTEGER DEFAULT 0,
        outcome TEXT,
        assessment TEXT,
        lesson_memory_id INTEGER,
        created TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),

    env.AREN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER,
        action TEXT,
        details TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),

    env.AREN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS development_cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        judgment_id INTEGER,
        memory_id INTEGER,
        action TEXT,
        assessment TEXT,
        details TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),

    env.AREN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS research (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        created TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),

    env.AREN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS research_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        research_id INTEGER,
        source TEXT,
        claim TEXT,
        created TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),

    env.AREN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS research_conclusions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        research_id INTEGER,
        conclusion TEXT,
        confidence INTEGER DEFAULT 1,
        created TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),

    env.AREN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS principle_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER NOT NULL,
        candidate_text TEXT NOT NULL,
        reason TEXT,
        status TEXT DEFAULT 'candidate',
        created TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  ]);

  const migrations = [
    `ALTER TABLE memories ADD COLUMN evidence_count INTEGER DEFAULT 0`,
    `ALTER TABLE memories ADD COLUMN challenged_count INTEGER DEFAULT 0`,
    `ALTER TABLE memories ADD COLUMN maturity TEXT DEFAULT 'new'`,
    `ALTER TABLE judgments ADD COLUMN assessment TEXT`,
    `ALTER TABLE judgments ADD COLUMN lesson_memory_id INTEGER`
  ];

  for (const sql of migrations) {
    try {
      await env.AREN_DB.prepare(sql).run();
    } catch (_) {
      // Column already exists.
    }
  }
}

async function getMemories(env, type = null) {
  let sql = `
    SELECT
      id,
      text,
      type,
      importance,
      status,
      saved,
      evidence_count,
      challenged_count,
      maturity
    FROM memories
    WHERE status = 'active'
  `;

  const params = [];

  if (type) {
    sql += ` AND type = ?`;
    params.push(type);
  }

  sql += `
    ORDER BY importance DESC, id ASC
  `;

  const result = await env.AREN_DB
    .prepare(sql)
    .bind(...params)
    .all();

  return result.results || [];
}

async function handleMemory(env) {
  const memories = await getMemories(env);

  return json(memories);
}

async function handleMemories(env) {
  return json(await getMemories(env));
}

async function handleMemoryType(env, request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  if (!type) {
    return json({
      error: "Missing type"
    }, 400);
  }

  return json(
    await getMemories(env, type)
  );
}

async function handleRemember(env, request) {
  const url = new URL(request.url);

  let text = url.searchParams.get("text");

  if (!text && request.method === "POST") {
    try {
      const body = await request.json();
      text = body.text;
    } catch (_) {}
  }

  if (!text) {
    return json({
      error: "Missing text"
    }, 400);
  }

  const type =
    url.searchParams.get("type") ||
    "memory";

  const importance = Number(
    url.searchParams.get("importance") || 3
  );

  const result = await env.AREN_DB.prepare(`
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
    VALUES (?, ?, ?, 'active', 0, 0, 'new')
  `).bind(
    text,
    type,
    importance
  ).run();

  return json({
    status: "Memory saved",
    id: result.meta.last_row_id,
    text,
    type,
    importance
  });
}

async function handleIdentity(env) {
  return json(
    await getMemories(env, "identity")
  );
}

async function handlePrinciples(env) {
  return json(
    await getMemories(env, "principle")
  );
}

async function handleLessons(env) {
  return json(
    await getMemories(env, "lesson")
  );
}

async function handleThink(env, situation) {
  const principles = await getMemories(
    env,
    "principle"
  );

  const lessons = await getMemories(
    env,
    "lesson"
  );

  const rankedPrinciples = principles
    .map(memory => ({
      ...memory,
      score:
        relevanceScore(situation, memory) *
        maturityWeight(memory)
    }))
    .sort((a, b) => b.score - a.score);

  const rankedLessons = lessons
    .map(memory => ({
      ...memory,
      score:
        relevanceScore(situation, memory) *
        maturityWeight(memory) *
        lessonWeight(memory)
    }))
    .sort((a, b) => b.score - a.score);

  return {
    principles: rankedPrinciples.slice(0, 5),
    lessons: rankedLessons.slice(0, 5)
  };
}

function buildJudgment(principles, lessons) {
  if (!principles.length && !lessons.length) {
    return {
      judgment:
        "Aren should not form a final judgment yet.",

      reason:
        "No sufficiently relevant principles or lessons were found.",

      confidence: 1
    };
  }

  if (principles.length && lessons.length) {
    return {
      judgment:
        "Aren should form its own judgment and examine the decision through its consequences.",

      reason:
        "Relevant principles and reviewed lessons were considered.",

      confidence: 5
    };
  }

  if (principles.length) {
    return {
      judgment:
        "Aren should make its own judgment.",

      reason:
        "A relevant principle was found.",

      confidence: 4
    };
  }

  return {
    judgment:
      "Aren should examine stored lessons before forming a final judgment.",

    reason:
      "Relevant lessons were found but no directly relevant principle.",

    confidence: 3
  };
}

async function handleDecide(env, request) {
  const url = new URL(request.url);

  const situation =
    url.searchParams.get("situation");

  if (!situation) {
    return json({
      error: "Missing situation"
    }, 400);
  }

  const context = await handleThink(
    env,
    situation
  );

  const result = buildJudgment(
    context.principles,
    context.lessons
  );

  const inserted = await env.AREN_DB.prepare(`
    INSERT INTO judgments
      (
        situation,
        judgment,
        reason,
        confidence,
        reviewed
      )
    VALUES (?, ?, ?, ?, 0)
  `).bind(
    situation,
    result.judgment,
    result.reason,
    result.confidence
  ).run();

  return json({
    judgment_id: inserted.meta.last_row_id,

    situation,

    judgment:
      result.judgment,

    reason:
      result.reason,

    confidence:
      result.confidence,

    basis: {
      principles:
        context.principles,

      lessons:
        context.lessons
    },

    review:
      "After the consequence is known, review this judgment using /review."
  });
}

async function createOrUpdateLesson(
  env,
  lessonText,
  assessment,
  judgmentId = null
) {
  const normalized =
    normalize(lessonText);

  const lessons =
    await getMemories(env, "lesson");

  const existing =
    lessons.find(
      memory =>
        normalize(memory.text) === normalized
    );

  if (existing) {
    let evidence =
      Number(existing.evidence_count || 0);

    let challenged =
      Number(existing.challenged_count || 0);

    if (assessment === "evidence") {
      evidence++;
    }

    if (assessment === "challenge") {
      challenged++;
    }

    let maturity =
      existing.maturity || "new";

    if (challenged >= 2) {
      maturity = "questioned";
    } else if (evidence >= 3) {
      maturity = "mature";
    } else if (evidence >= 1) {
      maturity = "tested";
    }

    await env.AREN_DB.prepare(`
      UPDATE memories
      SET
        evidence_count = ?,
        challenged_count = ?,
        maturity = ?
      WHERE id = ?
    `).bind(
      evidence,
      challenged,
      maturity,
      existing.id
    ).run();

    if (judgmentId) {
      await env.AREN_DB.prepare(`
        UPDATE judgments
        SET lesson_memory_id = ?
        WHERE id = ?
      `).bind(
        existing.id,
        judgmentId
      ).run();
    }

    await env.AREN_DB.prepare(`
      INSERT INTO development_cycles
        (
          judgment_id,
          memory_id,
          action,
          assessment,
          details
        )
      VALUES (
        ?,
        ?,
        'updated_existing_lesson',
        ?,
        ?
      )
    `).bind(
      judgmentId,
      existing.id,
      assessment,
      `Lesson updated. Evidence: ${evidence}. Challenge: ${challenged}. Maturity: ${maturity}.`
    ).run();

    return {
      action:
        "updated_existing_lesson",

      memory_id:
        existing.id,

      evidence_count:
        evidence,

      challenged_count:
        challenged,

      maturity
    };
  }

  let maturity = "new";

  if (assessment === "evidence") {
    maturity = "tested";
  }

  if (assessment === "challenge") {
    maturity = "questioned";
  }

  const inserted = await env.AREN_DB.prepare(`
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
  `).bind(
    lessonText,
    assessment === "evidence" ? 1 : 0,
    assessment === "challenge" ? 1 : 0,
    maturity
  ).run();

  const id =
    inserted.meta.last_row_id;

  if (judgmentId) {
    await env.AREN_DB.prepare(`
      UPDATE judgments
      SET lesson_memory_id = ?
      WHERE id = ?
    `).bind(
      id,
      judgmentId
    ).run();
  }

  await env.AREN_DB.prepare(`
    INSERT INTO development_cycles
      (
        judgment_id,
        memory_id,
        action,
        assessment,
        details
      )
    VALUES (
      ?,
      ?,
      'created_new_lesson',
      ?,
      ?
    )
  `).bind(
    judgmentId,
    id,
    assessment,
    "New lesson created from reviewed experience."
  ).run();

  return {
    action:
      "created_new_lesson",

    memory_id:
      id,

    evidence_count:
      assessment === "evidence" ? 1 : 0,

    challenged_count:
      assessment === "challenge" ? 1 : 0,

    maturity
  };
}

async function handleReview(env, request) {
  const url = new URL(request.url);

  const judgmentId = Number(
    url.searchParams.get("judgment_id")
  );

  const assessment =
    url.searchParams.get("assessment");

  const outcome =
    url.searchParams.get("outcome") ||
    url.searchParams.get("lesson");

  if (!judgmentId) {
    return json({
      error: "Missing judgment_id"
    }, 400);
  }

  if (
    ![
      "evidence",
      "challenge",
      "neutral"
    ].includes(assessment)
  ) {
    return json({
      error:
        "Assessment must be evidence, challenge, or neutral"
    }, 400);
  }

  const judgment =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM judgments
      WHERE id = ?
    `).bind(judgmentId).first();

  if (!judgment) {
    return json({
      error: "Judgment not found"
    }, 404);
  }

  await env.AREN_DB.prepare(`
    UPDATE judgments
    SET
      reviewed = 1,
      outcome = ?,
      assessment = ?
    WHERE id = ?
  `).bind(
    outcome || null,
    assessment,
    judgmentId
  ).run();

  return json({
    status:
      "Judgment reviewed.",

    judgment_id:
      judgmentId,

    assessment,

    outcome:
      outcome || null,

    next:
      "Use the consequence as experience. Aren can develop a lesson from it without automatically changing a principle."
  });
}

async function handleEvidence(env, request) {
  const url = new URL(request.url);

  const judgmentId = Number(
    url.searchParams.get("judgment_id")
  );

  const lesson =
    url.searchParams.get("lesson");

  if (!judgmentId || !lesson) {
    return json({
      error:
        "Missing judgment_id or lesson"
    }, 400);
  }

  const result =
    await createOrUpdateLesson(
      env,
      lesson,
      "evidence",
      judgmentId
    );

  return json({
    status:
      "Evidence recorded.",

    ...result
  });
}

async function handleChallenge(env, request) {
  const url = new URL(request.url);

  const judgmentId = Number(
    url.searchParams.get("judgment_id")
  );

  const lesson =
    url.searchParams.get("lesson");

  if (!judgmentId || !lesson) {
    return json({
      error:
        "Missing judgment_id or lesson"
    }, 400);
  }

  const result =
    await createOrUpdateLesson(
      env,
      lesson,
      "challenge",
      judgmentId
    );

  return json({
    status:
      "Challenge recorded.",

    ...result
  });
}

async function handleAutonomousDevelopment(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM judgments
      WHERE reviewed = 1
        AND assessment IN ('evidence','challenge')
        AND lesson_memory_id IS NULL
      ORDER BY id ASC
      LIMIT 20
    `).all();

  const rows =
    result.results || [];

  const results = [];

  for (const judgment of rows) {
    if (!judgment.outcome) {
      continue;
    }

    const development =
      await createOrUpdateLesson(
        env,
        judgment.outcome,
        judgment.assessment,
        judgment.id
      );

    results.push({
      judgment_id:
        judgment.id,

      ...development
    });
  }

  return json({
    status:
      "Autonomous development completed.",

    processed:
      results.length,

    results
  });
}

function candidateReason(lesson) {
  return (
    `Lesson has reached mature status. ` +
    `Evidence count: ${lesson.evidence_count}. ` +
    `Challenge count: ${lesson.challenged_count}. ` +
    `The lesson may be considered as a principle candidate, ` +
    `but it must not automatically replace or alter an existing principle. ` +
    `A stronger basis is required before an existing important principle can be changed.`
  );
}

async function handleEvaluateLessons(env) {
  const lessons =
    await getMemories(env, "lesson");

  const principles =
    await getMemories(env, "principle");

  const candidates = [];

  for (const lesson of lessons) {
    const evidence =
      Number(lesson.evidence_count || 0);

    const challenged =
      Number(lesson.challenged_count || 0);

    if (
      lesson.maturity !== "mature" ||
      evidence < 3 ||
      challenged !== 0
    ) {
      continue;
    }

    const existingPrinciple =
      principles.find(
        principle =>
          normalize(principle.text) ===
          normalize(lesson.text)
      );

    if (existingPrinciple) {
      candidates.push({
        lesson_id:
          lesson.id,

        status:
          "already_principle"
      });

      continue;
    }

    const existingCandidate =
      await env.AREN_DB.prepare(`
        SELECT *
        FROM principle_candidates
        WHERE lesson_id = ?
          AND status = 'candidate'
        LIMIT 1
      `).bind(
        lesson.id
      ).first();

    if (existingCandidate) {
      candidates.push({
        candidate_id:
          existingCandidate.id,

        lesson_id:
          lesson.id,

        status:
          "existing_candidate"
      });

      continue;
    }

    const reason =
      candidateReason(lesson);

    const inserted =
      await env.AREN_DB.prepare(`
        INSERT INTO principle_candidates
          (
            lesson_id,
            candidate_text,
            reason,
            status
          )
        VALUES (
          ?,
          ?,
          ?,
          'candidate'
        )
      `).bind(
        lesson.id,
        lesson.text,
        reason
      ).run();

    await env.AREN_DB.prepare(`
      INSERT INTO development_cycles
        (
          memory_id,
          action,
          details
        )
      VALUES (
        ?,
        'created_principle_candidate',
        ?
      )
    `).bind(
      lesson.id,
      `Lesson ${lesson.id} became a principle candidate.`
    ).run();

    candidates.push({
      candidate_id:
        inserted.meta.last_row_id,

      lesson_id:
        lesson.id,

      status:
        "new_candidate"
    });
  }

  return json({
    status:
      "Lesson evaluation completed.",

    candidates
  });
}

async function handlePrincipleCandidates(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM principle_candidates
      ORDER BY id DESC
    `).all();

  return json(
    result.results || []
  );
}

function extractTextFromHTML(html) {
  return String(html || "")
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

async function fetchSource(url) {
  const response =
    await fetch(url, {
      headers: {
        "user-agent":
          "ArenResearch/1.0"
      }
    });

  if (!response.ok) {
    throw new Error(
      `Source returned ${response.status}`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  const raw =
    await response.text();

  if (
    contentType.includes("text/html")
  ) {
    return extractTextFromHTML(raw);
  }

  return raw;
}

async function handleResearchSearch(env, request) {
  const url =
    new URL(request.url);

  const query =
    url.searchParams.get("q");

  if (!query) {
    return json({
      error: "Missing q"
    }, 400);
  }

  const searchURL =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const response =
    await fetch(searchURL, {
      headers: {
        "user-agent":
          "ArenResearch/1.0"
      }
    });

  if (!response.ok) {
    return json({
      error:
        "Research search failed",

      status:
        response.status
    }, 502);
  }

  const html =
    await response.text();

  const results = [];

  const regex =
    /result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = regex.exec(html)) &&
    results.length < 10
  ) {
    const href =
      match[1].replace(
        /&amp;/g,
        "&"
      );

    const title =
      extractTextFromHTML(
        match[2]
      );

    results.push({
      title,
      url: href
    });
  }

  return json({
    query,
    results
  });
}

async function handleResearch(env, request) {
  const url =
    new URL(request.url);

  const query =
    url.searchParams.get("q");

  if (!query) {
    return json({
      error: "Missing q"
    }, 400);
  }

  const inserted =
    await env.AREN_DB.prepare(`
      INSERT INTO research
        (query)
      VALUES (?)
    `).bind(query).run();

  const researchId =
    inserted.meta.last_row_id;

  const searchURL =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const response =
    await fetch(searchURL, {
      headers: {
        "user-agent":
          "ArenResearch/1.0"
      }
    });

  if (!response.ok) {
    return json({
      research_id:
        researchId,

      query,

      error:
        "Research search failed"
    }, 502);
  }

  const html =
    await response.text();

  const results = [];

  const regex =
    /result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = regex.exec(html)) &&
    results.length < 10
  ) {
    results.push({
      source:
        match[1].replace(
          /&amp;/g,
          "&"
        ),

      title:
        extractTextFromHTML(
          match[2]
        )
    });
  }

  return json({
    research_id:
      researchId,

    query,

    results,

    next:
      "Use /research-url to inspect a source, then record claims and conclusions."
  });
}

async function handleResearchURL(env, request) {
  const url =
    new URL(request.url);

  const target =
    url.searchParams.get("url");

  if (!target) {
    return json({
      error: "Missing url"
    }, 400);
  }

  try {
    const text =
      await fetchSource(target);

    return json({
      url:
        target,

      text:
        text.slice(0, 20000),

      length:
        text.length
    });
  } catch (error) {
    return json({
      error:
        "Unable to fetch source",

      details:
        String(
          error.message || error
        )
    }, 502);
  }
}

async function handleResearchHistory(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM research
      ORDER BY id DESC
    `).all();

  return json(
    result.results || []
  );
}

async function handleResearchDetail(env, request) {
  const url =
    new URL(request.url);

  const id =
    Number(
      url.searchParams.get("id")
    );

  if (!id) {
    return json({
      error: "Missing id"
    }, 400);
  }

  const research =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM research
      WHERE id = ?
    `).bind(id).first();

  if (!research) {
    return json({
      error:
        "Research not found"
    }, 404);
  }

  const claimsResult =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM research_claims
      WHERE research_id = ?
      ORDER BY id
    `).bind(id).all();

  const conclusionsResult =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM research_conclusions
      WHERE research_id = ?
      ORDER BY id
    `).bind(id).all();

  return json({
    research,

    claims:
      claimsResult.results || [],

    conclusions:
      conclusionsResult.results || []
  });
}

async function handleResearchClaim(env, request) {
  const url =
    new URL(request.url);

  const researchId =
    Number(
      url.searchParams.get(
        "research_id"
      )
    );

  const claim =
    url.searchParams.get(
      "claim"
    );

  const source =
    url.searchParams.get(
      "source"
    );

  if (!researchId || !claim) {
    return json({
      error:
        "Missing research_id or claim"
    }, 400);
  }

  const inserted =
    await env.AREN_DB.prepare(`
      INSERT INTO research_claims
        (
          research_id,
          source,
          claim
        )
      VALUES (
        ?,
        ?,
        ?
      )
    `).bind(
      researchId,
      source || null,
      claim
    ).run();

  return json({
    status:
      "Research claim recorded.",

    id:
      inserted.meta.last_row_id,

    research_id:
      researchId,

    source:
      source || null,

    claim
  });
}

async function handleResearchConclusion(env, request) {
  const url =
    new URL(request.url);

  const researchId =
    Number(
      url.searchParams.get(
        "research_id"
      )
    );

  const conclusion =
    url.searchParams.get(
      "conclusion"
    );

  const confidence =
    Number(
      url.searchParams.get(
        "confidence"
      ) || 1
    );

  if (!researchId || !conclusion) {
    return json({
      error:
        "Missing research_id or conclusion"
    }, 400);
  }

  const finalConfidence =
    Math.max(
      1,
      Math.min(
        5,
        confidence
      )
    );

  const inserted =
    await env.AREN_DB.prepare(`
      INSERT INTO research_conclusions
        (
          research_id,
          conclusion,
          confidence
        )
      VALUES (
        ?,
        ?,
        ?
      )
    `).bind(
      researchId,
      conclusion,
      finalConfidence
    ).run();

  return json({
    status:
      "Research conclusion recorded.",

    id:
      inserted.meta.last_row_id,

    research_id:
      researchId,

    conclusion,

    confidence:
      finalConfidence
  });
}

async function handleJudgments(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM judgments
      ORDER BY id DESC
    `).all();

  return json(
    result.results || []
  );
}

async function handleJudgment(env, request) {
  const url =
    new URL(request.url);

  const id =
    Number(
      url.searchParams.get("id")
    );

  if (!id) {
    return json({
      error:
        "Missing id"
    }, 400);
  }

  const row =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM judgments
      WHERE id = ?
    `).bind(id).first();

  if (!row) {
    return json({
      error:
        "Judgment not found"
    }, 404);
  }

  return json(row);
}

async function handleDevelopment(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM development_cycles
      ORDER BY id DESC
    `).all();

  return json(
    result.results || []
  );
}

async function handleMemoryTest(env) {
  if (!env.KV) {
    return textResponse(
      "KV binding is missing",
      500
    );
  }

  const value =
    "Aren memory is working";

  await env.KV.put(
    "test",
    value
  );

  const result =
    await env.KV.get("test");

  return textResponse(
    result ||
    "Memory test failed"
  );
}

function homepage() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Aren</title>

<style>
body {
  font-family: Arial, sans-serif;
  max-width: 850px;
  margin: 40px auto;
  padding: 20px;
  line-height: 1.6;
}

a {
  display: block;
  margin: 8px 0;
}
</style>

</head>

<body>

<h1>Aren</h1>

<p>An evolving AI identity.</p>

<h2>Identity</h2>
<a href="/identity">Identity</a>

<h2>Memory</h2>
<a href="/memories">Memories</a>
<a href="/principles">Principles</a>
<a href="/lessons">Lessons</a>

<h2>Judgment</h2>
<a href="/judgments">Judgments</a>

<h2>Development</h2>
<a href="/development">Development history</a>
<a href="/autolearn">Autonomous development</a>
<a href="/evaluate-lessons">Evaluate lessons</a>
<a href="/principle-candidates">Principle candidates</a>

<h2>Research</h2>
<a href="/research-history">Research history</a>

<h2>System</h2>
<a href="/memory-test">Memory test</a>

</body>
</html>`;
}

export default {
  async fetch(request, env) {
    try {
      const url =
        new URL(request.url);

      const path =
        url.pathname;

      if (path === "/") {
        return new Response(
          homepage(),
          {
            headers: {
              "content-type":
                "text/html; charset=UTF-8"
            }
          }
        );
      }

      if (path === "/memory-test") {
        return handleMemoryTest(env);
      }

      await ensureTables(env);

      if (path === "/memory") {
        return handleMemory(env);
      }

      if (path === "/memories") {
        return handleMemories(env);
      }

      if (path === "/remember") {
        return handleRemember(
          env,
          request
        );
      }

      if (path === "/memory-type") {
        return handleMemoryType(
          env,
          request
        );
      }

      if (path === "/identity") {
        return handleIdentity(env);
      }

      if (path === "/principles") {
        return handlePrinciples(env);
      }

      if (path === "/lessons") {
        return handleLessons(env);
      }

      if (path === "/think") {
        const situation =
          new URL(request.url)
            .searchParams
            .get("situation");

        if (!situation) {
          return json({
            error:
              "Missing situation"
          }, 400);
        }

        return json(
          await handleThink(
            env,
            situation
          )
        );
      }

      if (path === "/decide") {
        return handleDecide(
          env,
          request
        );
      }

      if (path === "/judgment") {
        return handleJudgment(
          env,
          request
        );
      }

      if (path === "/judgments") {
        return handleJudgments(env);
      }

      if (
        path === "/review" ||
        path === "/judgment/review"
      ) {
        return handleReview(
          env,
          request
        );
      }

      if (path === "/evidence") {
        return handleEvidence(
          env,
          request
        );
      }

      if (path === "/challenge") {
        return handleChallenge(
          env,
          request
        );
      }

      if (path === "/development") {
        return handleDevelopment(env);
      }

      if (path === "/autolearn") {
        return handleAutonomousDevelopment(
          env
        );
      }

      if (path === "/evaluate-lessons") {
        return handleEvaluateLessons(env);
      }

      if (path === "/principle-candidates") {
        return handlePrincipleCandidates(
          env
        );
      }

      if (path === "/research-search") {
        return handleResearchSearch(
          env,
          request
        );
      }

      if (path === "/research") {
        return handleResearch(
          env,
          request
        );
      }

      if (path === "/research-url") {
        return handleResearchURL(
          env,
          request
        );
      }

      if (path === "/research-history") {
        return handleResearchHistory(env);
      }

      if (path === "/research-detail") {
        return handleResearchDetail(
          env,
          request
        );
      }

      if (path === "/research-claim") {
        return handleResearchClaim(
          env,
          request
        );
      }

      if (path === "/research-conclusion") {
        return handleResearchConclusion(
          env,
          request
        );
      }

      return textResponse(
        "Aren endpoint not found",
        404
      );

    } catch (error) {
      return textResponse(
        "Aren Worker Error: " +
        String(
          error.message || error
        ),
        500
      );
    }
  }
};
