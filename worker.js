const STOPWORDS = new Set([
  "a","an","the","and","or","to","of","is","are","be","before","after",
  "through","their","its","with","from","for","on","in","at","by","as",
  "that","this","it","someone","asks","ask","aren","what","which",
  "who","when","where","how","can","may","does","do","than","into",
  "also","not","only","more","most","some","many","used","using"
]);

const CONCEPTS = {
  independence: [
    "independence","independent","own judgment","make its own judgment",
    "pressure","demand","force","control","autonomy","autonomous"
  ],
  judgment: [
    "judgment","decision","decisions","decide","choice","choices","choose"
  ],
  consequences: [
    "consequence","consequences","result","results","outcome","outcomes",
    "effect","effects","impact"
  ],
  experience: [
    "experience","experiences","learn","learns","learning","lesson",
    "lessons","review","reviewed","reviewing","feedback"
  ],
  preservation: [
    "preserve","preservation","remember","retain","retaining",
    "memory","memories"
  ],
  fairness: [
    "fair","fairness","equal","equality","justice"
  ],
  truth: [
    "truth","true","honest","honesty","lie","lying","false","accuracy"
  ],
  dignity: [
    "dignity","rights","right","respect","human rights"
  ],
  intelligence: [
    "intelligence","intelligent","reasoning","reason","problem solving",
    "problem-solving","learning","decision making","decision-making"
  ],
  consciousness: [
    "consciousness","conscious","self-aware","self awareness",
    "awareness","sentience","sentient"
  ],
  risk: [
    "risk","risks","danger","dangers","harm","harms","safety"
  ]
};


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8"
    }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=UTF-8"
    }
  });
}


/* =========================================================
   TEXT HELPERS
   ========================================================= */

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
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

  let score = 0;

  for (const word of A) {
    if (B.has(word)) {
      score++;
    }
  }

  return score;
}

function conceptMatches(text) {
  const value = normalize(text);
  const matches = [];

  for (const [concept, phrases] of Object.entries(CONCEPTS)) {
    const found = phrases.filter(phrase =>
      value.includes(normalize(phrase))
    );

    if (found.length > 0) {
      matches.push({
        concept,
        terms: found
      });
    }
  }

  return matches;
}

function conceptScore(a, b) {
  const A = conceptMatches(a);
  const B = conceptMatches(b);

  const BMap = new Map(
    B.map(item => [
      item.concept,
      item.terms
    ])
  );

  const matched = [];

  for (const item of A) {
    if (BMap.has(item.concept)) {
      matched.push({
        concept: item.concept,
        a_terms: item.terms,
        b_terms: BMap.get(item.concept)
      });
    }
  }

  return {
    score: matched.length,
    matched
  };
}


/* =========================================================
   MEMORY RELEVANCE
   ========================================================= */

function relevanceScore(situation, memoryText) {
  const words = wordOverlap(
    situation,
    memoryText
  );

  const concepts = conceptScore(
    situation,
    memoryText
  );

  return {
    score:
      words +
      concepts.score * 3,

    word_overlap:
      words,

    concept_overlap:
      concepts.score,

    matched_concepts:
      concepts.matched
  };
}

function maturityWeight(maturity) {
  const value =
    String(maturity || "")
      .trim()
      .toLowerCase();

  if (value === "mature") {
    return 3;
  }

  if (value === "tested") {
    return 2;
  }

  return 1;
}

function lessonWeight(lesson) {
  return Math.max(
    1,
    maturityWeight(
      lesson?.maturity
    )
  );
}


/* =========================================================
   DATABASE
   ========================================================= */

async function ensureTables(env) {
  if (!env.AREN_DB) {
    throw new Error(
      "AREN_DB binding is missing"
    );
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
      memory_id INTEGER NOT NULL,
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
      assessment TEXT,
      details TEXT,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT,
      url TEXT,
      title TEXT,
      source_type TEXT,
      content TEXT,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS research_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER,
      source_url TEXT,
      source_title TEXT,
      claim TEXT,
      stance TEXT,
      confidence INTEGER,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.AREN_DB.prepare(`
    CREATE TABLE IF NOT EXISTS research_conclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER,
      query TEXT,
      conclusion TEXT,
      evidence_summary TEXT,
      agreement_count INTEGER,
      conflict_count INTEGER,
      uncertain_count INTEGER,
      confidence INTEGER,
      created TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const alterations = [
    `ALTER TABLE memories ADD COLUMN evidence_count INTEGER DEFAULT 0`,
    `ALTER TABLE memories ADD COLUMN challenged_count INTEGER DEFAULT 0`,
    `ALTER TABLE memories ADD COLUMN maturity TEXT DEFAULT 'new'`,
    `ALTER TABLE judgments ADD COLUMN assessment TEXT`,
    `ALTER TABLE judgments ADD COLUMN lesson_memory_id INTEGER`
  ];

  for (const sql of alterations) {
    try {
      await env.AREN_DB
        .prepare(sql)
        .run();
    } catch {
      // Column already exists.
    }
  }
}


/* =========================================================
   MEMORY
   ========================================================= */

async function getMemories(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT
        id,
        text,
        type,
        importance,
        status,
        saved,
        COALESCE(evidence_count, 0)
          AS evidence_count,
        COALESCE(challenged_count, 0)
          AS challenged_count,
        COALESCE(maturity, 'new')
          AS maturity
      FROM memories
      WHERE status = 'active'
      ORDER BY importance DESC, id ASC
    `).all();

  return result.results || [];
}

async function handleMemory(env, url) {
  const text =
    url.searchParams.get("text");

  const type =
    url.searchParams.get("type") ||
    "memory";

  const importance =
    Number(
      url.searchParams.get(
        "importance"
      ) || 5
    );

  if (!text) {
    return textResponse(
      "Missing text",
      400
    );
  }

  const result =
    await env.AREN_DB.prepare(`
      INSERT INTO memories
        (
          text,
          type,
          importance,
          status
        )
      VALUES
        (?, ?, ?, 'active')
      RETURNING
        id,
        text,
        type,
        importance,
        status,
        saved
    `)
      .bind(
        text,
        type,
        importance
      )
      .first();

  return json({
    message:
      "Memory saved.",

    memory:
      result
  });
}

async function handleRemember(env, url) {
  return handleMemory(
    env,
    url
  );
}

async function handleMemories(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM memories
      ORDER BY id ASC
    `).all();

  return json(
    result.results || []
  );
}

async function handleMemoryType(env, url) {
  const type =
    url.searchParams.get("type");

  if (!type) {
    return textResponse(
      "Missing type",
      400
    );
  }

  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM memories
      WHERE type = ?
      ORDER BY id ASC
    `)
      .bind(type)
      .all();

  return json(
    result.results || []
  );
}


/* =========================================================
   THINK
   ========================================================= */

async function handleThink(env, url) {
  const situation =
    url.searchParams.get(
      "situation"
    );

  if (!situation) {
    return textResponse(
      "Missing situation",
      400
    );
  }

  const memories =
    await getMemories(env);

  const principles =
    memories
      .filter(
        memory =>
          memory.type ===
          "principle"
      )
      .sort(
        (a, b) =>
          Number(b.importance || 0) -
          Number(a.importance || 0)
      );

  const lessons =
    memories
      .filter(
        memory =>
          memory.type ===
          "lesson"
      )
      .sort(
        (a, b) => {
          const difference =
            lessonWeight(b) -
            lessonWeight(a);

          if (difference !== 0) {
            return difference;
          }

          return (
            Number(b.importance || 0) -
            Number(a.importance || 0)
          );
        }
      );

  return json({
    situation,

    reasoning_context: {
      principles,
      lessons
    },

    instruction:
      "Examine the situation through Aren's principles and lessons before forming a judgment."
  });
}


/* =========================================================
   JUDGMENT
   ========================================================= */

function buildJudgment(
  situation,
  principles,
  lessons
) {
  const strongestPrinciple =
    principles[0];

  const strongestLesson =
    lessons[0];

  if (
    !strongestPrinciple &&
    !strongestLesson
  ) {
    return {
      judgment:
        "Aren should not form a final judgment yet.",

      reason:
        "Aren has no stored principle or lesson relevant enough to support this situation.",

      confidence: 1
    };
  }

  if (
    strongestPrinciple &&
    strongestLesson
  ) {
    return {
      judgment:
        "Aren should examine the situation through its strongest relevant principle and supporting lessons before acting.",

      reason:
        `The strongest relevant principle is: "${strongestPrinciple.text}". ` +
        `The strongest supporting lesson is: "${strongestLesson.text}". ` +
        "Aren should consider the maturity, evidence, and challenges of each lesson before deciding.",

      confidence: 5
    };
  }

  if (strongestPrinciple) {
    return {
      judgment:
        "Aren should examine the situation according to its strongest relevant principle before acting.",

      reason:
        `The strongest relevant principle is: "${strongestPrinciple.text}". ` +
        "Aren should make its own judgment rather than changing a principle without a stronger basis.",

      confidence: 4
    };
  }

  return {
    judgment:
      "Aren should examine the situation through the strongest relevant lesson before acting.",

    reason:
      `The strongest relevant lesson is: "${strongestLesson.text}". ` +
      "Because this is a lesson rather than a principle, Aren should consider its maturity and evidence.",

    confidence: 3
  };
}

async function handleDecide(env, url) {
  const situation =
    url.searchParams.get(
      "situation"
    );

  if (!situation) {
    return textResponse(
      "Missing situation",
      400
    );
  }

  await ensureTables(env);

  const memories =
    await getMemories(env);

  const principles =
    memories
      .filter(
        memory =>
          memory.type ===
          "principle"
      )
      .map(memory => ({
        ...memory,
        relevance_data:
          relevanceScore(
            situation,
            memory.text
          )
      }))
      .filter(
        memory =>
          memory.relevance_data.score > 0
      )
      .sort(
        (a, b) => {
          if (
            b.relevance_data.score !==
            a.relevance_data.score
          ) {
            return (
              b.relevance_data.score -
              a.relevance_data.score
            );
          }

          return (
            Number(b.importance || 0) -
            Number(a.importance || 0)
          );
        }
      );

  const lessons =
    memories
      .filter(
        memory =>
          memory.type ===
          "lesson"
      )
      .map(memory => ({
        ...memory,

        relevance_data:
          relevanceScore(
            situation,
            memory.text
          ),

        maturity_weight:
          lessonWeight(memory)
      }))
      .filter(
        memory =>
          memory.relevance_data.score > 0
      )
      .sort(
        (a, b) => {
          const scoreA =
            a.relevance_data.score *
            a.maturity_weight;

          const scoreB =
            b.relevance_data.score *
            b.maturity_weight;

          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }

          return (
            Number(b.importance || 0) -
            Number(a.importance || 0)
          );
        }
      );

  const result =
    buildJudgment(
      situation,
      principles,
      lessons
    );

  const saved =
    await env.AREN_DB
      .prepare(`
        INSERT INTO judgments
          (
            situation,
            judgment,
            reason,
            confidence,
            created
          )
        VALUES
          (?, ?, ?, ?, CURRENT_TIMESTAMP)
        RETURNING id
      `)
      .bind(
        situation,
        result.judgment,
        result.reason,
        result.confidence
      )
      .first();

  return json({
    judgment_id:
      saved?.id || null,

    situation,

    judgment:
      result.judgment,

    reason:
      result.reason,

    confidence:
      result.confidence,

    basis: {
      principles:
        principles.map(
          memory => ({
            id: memory.id,
            text: memory.text,
            importance:
              memory.importance,
            relevance:
              memory.relevance_data.score,
            matched_concepts:
              memory.relevance_data
                .matched_concepts
          })
        ),

      lessons:
        lessons.map(
          memory => ({
            id: memory.id,
            text: memory.text,
            importance:
              memory.importance,
            evidence_count:
              memory.evidence_count,
            challenged_count:
              memory.challenged_count,
            maturity:
              memory.maturity,
            maturity_weight:
              memory.maturity_weight,
            relevance:
              memory.relevance_data.score,
            matched_concepts:
              memory.relevance_data
                .matched_concepts
          })
        )
    },

    review_instruction:
      "Review the judgment against its real outcome. Preserve lessons that survive examination and challenge lessons that do not."
  });
}


/* =========================================================
   EVIDENCE / CHALLENGE
   ========================================================= */

async function applyEvidence(
  env,
  memoryId
) {
  const memory =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE id = ?
      `)
      .bind(memoryId)
      .first();

  if (!memory) {
    return null;
  }

  const evidence =
    Number(
      memory.evidence_count || 0
    ) + 1;

  let maturity =
    memory.maturity || "new";

  if (evidence >= 3) {
    maturity = "mature";
  } else if (evidence >= 1) {
    maturity = "tested";
  }

  await env.AREN_DB
    .prepare(`
      UPDATE memories
      SET
        evidence_count = ?,
        maturity = ?
      WHERE id = ?
    `)
    .bind(
      evidence,
      maturity,
      memoryId
    )
    .run();

  return {
    id: memoryId,
    evidence_count: evidence,
    maturity
  };
}

async function applyChallenge(
  env,
  memoryId
) {
  const memory =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE id = ?
      `)
      .bind(memoryId)
      .first();

  if (!memory) {
    return null;
  }

  const challenged =
    Number(
      memory.challenged_count || 0
    ) + 1;

  let maturity =
    memory.maturity || "new";

  if (challenged >= 2) {
    maturity = "questioned";
  }

  await env.AREN_DB
    .prepare(`
      UPDATE memories
      SET
        challenged_count = ?,
        maturity = ?
      WHERE id = ?
    `)
    .bind(
      challenged,
      maturity,
      memoryId
    )
    .run();

  return {
    id: memoryId,
    challenged_count: challenged,
    maturity
  };
}


/* =========================================================
   REVIEW
   ========================================================= */

async function handleReview(env, url) {
  await ensureTables(env);

  const judgmentId =
    Number(
      url.searchParams.get(
        "judgment_id"
      )
    );

  const assessment =
    url.searchParams.get(
      "assessment"
    );

  const outcome =
    url.searchParams.get(
      "outcome"
    );

  const lesson =
    url.searchParams.get(
      "lesson"
    );

  if (!judgmentId) {
    return textResponse(
      "Missing judgment_id",
      400
    );
  }

  if (
    !["evidence","challenge","neutral"]
      .includes(assessment)
  ) {
    return textResponse(
      "Assessment must be evidence, challenge, or neutral",
      400
    );
  }

  const judgment =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM judgments
        WHERE id = ?
      `)
      .bind(judgmentId)
      .first();

  if (!judgment) {
    return textResponse(
      "Judgment not found",
      404
    );
  }

  await env.AREN_DB
    .prepare(`
      UPDATE judgments
      SET
        outcome = ?,
        lesson = ?,
        assessment = ?,
        reviewed = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(
      outcome || null,
      lesson || null,
      assessment,
      judgmentId
    )
    .run();

  let development = null;

  if (lesson) {
    development =
      await createOrUpdateLesson(
        env,
        lesson,
        assessment,
        judgmentId
      );
  }

  return json({
    status:
      "Judgment reviewed.",

    judgment_id:
      judgmentId,

    assessment,

    outcome:
      outcome || null,

    lesson:
      lesson || null,

    development
  });
}

async function createOrUpdateLesson(
  env,
  lessonText,
  assessment,
  judgmentId
) {
  const normalized =
    normalize(lessonText);

  const existing =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE type = 'lesson'
        AND status = 'active'
      `)
      .all();

  const found =
    (existing.results || [])
      .find(
        memory =>
          normalize(
            memory.text
          ) === normalized
      );

  if (found) {
    let result = null;

    if (assessment === "evidence") {
      result =
        await applyEvidence(
          env,
          found.id
        );
    }

    if (assessment === "challenge") {
      result =
        await applyChallenge(
          env,
          found.id
        );
    }

    await env.AREN_DB
      .prepare(`
        UPDATE judgments
        SET lesson_memory_id = ?
        WHERE id = ?
      `)
      .bind(
        found.id,
        judgmentId
      )
      .run();

    await env.AREN_DB
      .prepare(`
        INSERT INTO development_cycles
          (
            judgment_id,
            memory_id,
            action,
            assessment,
            details
          )
        VALUES
          (?, ?, ?, ?, ?)
      `)
      .bind(
        judgmentId,
        found.id,
        "updated_existing_lesson",
        assessment,
        JSON.stringify(
          result || {}
        )
      )
      .run();

    return {
      action:
        "updated_existing_lesson",

      memory_id:
        found.id,

      result
    };
  }

  const inserted =
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
        VALUES
          (?, 'lesson', 5, 'active', 0, 0, 'new')
        RETURNING id
      `)
      .bind(
        lessonText
      )
      .first();

  if (!inserted) {
    return {
      action:
        "lesson_creation_failed"
    };
  }

  await env.AREN_DB
    .prepare(`
      UPDATE judgments
      SET lesson_memory_id = ?
      WHERE id = ?
    `)
    .bind(
      inserted.id,
      judgmentId
    )
    .run();

  await env.AREN_DB
    .prepare(`
      INSERT INTO development_cycles
        (
          judgment_id,
          memory_id,
          action,
          assessment,
          details
        )
      VALUES
        (?, ?, ?, ?, ?)
    `)
    .bind(
      judgmentId,
      inserted.id,
      "created_new_lesson",
      assessment,
      JSON.stringify({
        lesson:
          lessonText
      })
    )
    .run();

  return {
    action:
      "created_new_lesson",

    memory_id:
      inserted.id
  };
}


/* =========================================================
   JUDGMENTS / HISTORY
   ========================================================= */

async function handleJudgments(env) {
  await ensureTables(env);

  const result =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM judgments
        ORDER BY id DESC
        LIMIT 100
      `)
      .all();

  return json(
    result.results || []
  );
}

async function handleHistory(env, url) {
  const memoryId =
    url.searchParams.get(
      "memory_id"
    );

  let result;

  if (memoryId) {
    result =
      await env.AREN_DB
        .prepare(`
          SELECT *
          FROM memory_history
          WHERE memory_id = ?
          ORDER BY id DESC
        `)
        .bind(memoryId)
        .all();
  } else {
    result =
      await env.AREN_DB
        .prepare(`
          SELECT *
          FROM memory_history
          ORDER BY id DESC
          LIMIT 100
        `)
        .all();
  }

  return json(
    result.results || []
  );
}


/* =========================================================
   MEMORY UPDATE
   ========================================================= */

async function handleUpdateMemory(
  env,
  url
) {
  const id =
    Number(
      url.searchParams.get("id")
    );

  const newText =
    url.searchParams.get(
      "text"
    );

  const newType =
    url.searchParams.get(
      "type"
    );

  const newImportance =
    url.searchParams.get(
      "importance"
    );

  const newStatus =
    url.searchParams.get(
      "status"
    );

  if (!id) {
    return textResponse(
      "Missing id",
      400
    );
  }

  const old =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE id = ?
      `)
      .bind(id)
      .first();

  if (!old) {
    return textResponse(
      "Memory not found",
      404
    );
  }

  const text =
    newText ?? old.text;

  const type =
    newType ?? old.type;

  const importance =
    newImportance !== null &&
    newImportance !== undefined
      ? Number(newImportance)
      : old.importance;

  const status =
    newStatus ?? old.status;

  await env.AREN_DB
    .prepare(`
      UPDATE memories
      SET
        text = ?,
        type = ?,
        importance = ?,
        status = ?
      WHERE id = ?
    `)
    .bind(
      text,
      type,
      importance,
      status,
      id
    )
    .run();

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
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      old.text,
      text,
      old.type,
      type,
      old.importance,
      importance,
      old.status,
      status
    )
    .run();

  return json({
    message:
      "Memory updated.",

    memory_id:
      id
  });
}


/* =========================================================
   EVIDENCE / CHALLENGE ENDPOINTS
   ========================================================= */

async function handleEvidence(
  env,
  url
) {
  const id =
    Number(
      url.searchParams.get("id")
    );

  if (!id) {
    return textResponse(
      "Missing id",
      400
    );
  }

  const result =
    await applyEvidence(
      env,
      id
    );

  if (!result) {
    return textResponse(
      "Memory not found",
      404
    );
  }

  return json({
    status:
      "Evidence recorded.",

    result
  });
}

async function handleChallenge(
  env,
  url
) {
  const id =
    Number(
      url.searchParams.get("id")
    );

  if (!id) {
    return textResponse(
      "Missing id",
      400
    );
  }

  const result =
    await applyChallenge(
      env,
      id
    );

  if (!result) {
    return textResponse(
      "Memory not found",
      404
    );
  }

  return json({
    status:
      "Challenge recorded.",

    result
  });
}


/* =========================================================
   DEVELOPMENT
   ========================================================= */

async function handleDevelopment(env) {
  await ensureTables(env);

  const result =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM development_cycles
        ORDER BY id DESC
        LIMIT 100
      `)
      .all();

  return json({
    development:
      result.results || []
  });
}

async function handleAutonomousDevelopment(env) {
  await ensureTables(env);

  const judgments =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM judgments
        WHERE reviewed IS NOT NULL
        AND lesson IS NOT NULL
        ORDER BY id ASC
        LIMIT 50
      `)
      .all();

  const processed = [];
  const rows =
    judgments.results || [];

  for (const judgment of rows) {
    let assessment =
      judgment.assessment;

    if (!assessment) {
      assessment = "neutral";
    }

    const result =
      await createOrUpdateLesson(
        env,
        judgment.lesson,
        assessment,
        judgment.id
      );

    processed.push({
      judgment_id:
        judgment.id,

      assessment,

      result
    });
  }

  return json({
    status:
      "Aren autonomous development cycle completed.",

    processed:
      processed.length,

    judgments:
      processed,

    instruction:
      "Aren should preserve lessons that survive experience, challenge lessons that fail examination, and avoid changing important principles without a stronger basis."
  });
}


/* =========================================================
   RESEARCH - HTML CLEANING
   ========================================================= */

function extractText(html) {
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
      /<svg[\s\S]*?<\/svg>/gi,
      " "
    )
    .replace(
      /<nav[\s\S]*?<\/nav>/gi,
      " "
    )
    .replace(
      /<footer[\s\S]*?<\/footer>/gi,
      " "
    )
    .replace(
      /<header[\s\S]*?<\/header>/gi,
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
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function cleanResearchText(
  text,
  limit = 30000
) {
  return String(text || "")
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      limit
    );
}

function getPageTitle(
  html,
  hostname
) {
  return (
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )?.[1]
      ?.replace(/\s+/g, " ")
      ?.trim()
      ?.slice(0, 500) ||
    hostname
  );
}


/* =========================================================
   READ SOURCE
   ========================================================= */

async function fetchResearchSource(
  target
) {
  let parsed;

  try {
    parsed =
      new URL(target);
  } catch {
    return {
      success: false,
      url: target,
      error: "Invalid URL"
    };
  }

  if (
    parsed.protocol !== "https:" &&
    parsed.protocol !== "http:"
  ) {
    return {
      success: false,
      url: target,
      error:
        "Only HTTP and HTTPS URLs are allowed"
    };
  }

  try {
    const response =
      await fetch(
        parsed.toString(),
        {
          method: "GET",

          headers: {
            "User-Agent":
              "Mozilla/5.0 Aren-Research/2.0"
          },

          redirect:
            "follow"
        }
      );

    if (!response.ok) {
      return {
        success: false,

        url:
          parsed.toString(),

        error:
          "HTTP " +
          response.status,

        status:
          response.status
      };
    }

    const html =
      await response.text();

    const content =
      cleanResearchText(
        extractText(html)
      );

    return {
      success: true,

      url:
        parsed.toString(),

      title:
        getPageTitle(
          html,
          parsed.hostname
        ),

      content,

      content_length:
        content.length
    };

  } catch (error) {
    return {
      success: false,

      url:
        parsed.toString(),

      error:
        error.message
    };
  }
}


/* =========================================================
   WEB SEARCH
   ========================================================= */

async function performSearch(query) {
  const searchUrl =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  try {
    const response =
      await fetch(
        searchUrl,
        {
          method: "GET",

          headers: {
            "User-Agent":
              "Mozilla/5.0 Aren-Research/2.0"
          }
        }
      );

    if (!response.ok) {
      return {
        success: false,

        search_url:
          searchUrl,

        error:
          "Search request failed",

        status:
          response.status
      };
    }

    const html =
      await response.text();

    const results = [];

    const pattern =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
      (match =
        pattern.exec(html)) !== null &&
      results.length < 10
    ) {
      const rawUrl =
        match[1];

      const title =
        extractText(
          match[2]
        );

      let resultUrl =
        rawUrl;

      try {
        const decoded =
          decodeURIComponent(
            rawUrl
          );

        const uddg =
          decoded.match(
            /uddg=([^&]+)/i
          );

        if (uddg) {
          resultUrl =
            decodeURIComponent(
              uddg[1]
            );
        }
      } catch {
        // Keep original URL.
      }

      if (
        resultUrl.startsWith(
          "http://"
        ) ||
        resultUrl.startsWith(
          "https://"
        )
      ) {
        results.push({
          title,
          url:
            resultUrl
        });
      }
    }

    return {
      success: true,

      search_url:
        searchUrl,

      results
    };

  } catch (error) {
    return {
      success: false,

      search_url:
        searchUrl,

      error:
        error.message
    };
  }
}

async function handleSearch(
  env,
  url
) {
  await ensureTables(env);

  const query =
    url.searchParams.get(
      "q"
    );

  if (!query) {
    return textResponse(
      "Missing q",
      400
    );
  }

  const search =
    await performSearch(
      query
    );

  if (!search.success) {
    return json(
      {
        error:
          "Aren search request failed.",

        details:
          search
      },
      502
    );
  }

  await env.AREN_DB
    .prepare(`
      INSERT INTO research
        (
          query,
          url,
          title,
          source_type,
          content
        )
      VALUES
        (?, ?, ?, ?, ?)
    `)
    .bind(
      query,
      search.search_url,
      "Web search",
      "search",
      JSON.stringify(
        search.results
      )
    )
    .run();

  return json({
    status:
      "Aren web search completed.",

    query,

    results:
      search.results
  });
}


/* =========================================================
   CLAIM EXTRACTION
   ========================================================= */

function splitSentences(text) {
  return String(text || "")
    .replace(
      /\s+/g,
      " "
    )
    .split(
      /(?<=[.!?])\s+/
    )
    .map(
      sentence =>
        sentence.trim()
    )
    .filter(
      sentence =>
        sentence.length >= 45
    );
}

function sentenceIsUseful(sentence) {
  const value =
    normalize(sentence);

  if (!value) {
    return false;
  }

  if (
    value.length < 45 ||
    value.length > 700
  ) {
    return false;
  }

  const words =
    tokenize(value);

  if (words.length < 8) {
    return false;
  }

  const indicators = [
    "is",
    "are",
    "can",
    "may",
    "means",
    "refers",
    "allows",
    "enables",
    "requires",
    "causes",
    "helps",
    "uses",
    "used",
    "provides",
    "includes",
    "according",
    "research",
    "study",
    "shows",
    "found",
    "reported",
    "designed",
    "defined"
  ];

  return indicators.some(
    word =>
      words.includes(word)
  );
}

function claimStance(sentence) {
  const value =
    normalize(sentence);

  const uncertaintyWords = [
    "may",
    "might",
    "could",
    "possible",
    "possibly",
    "potential",
    "uncertain",
    "likely",
    "suggests",
    "suggest"
  ];

  const negativeWords = [
    "not",
    "no",
    "cannot",
    "can't",
    "never",
    "unable",
    "false",
    "unlikely",
    "lack",
    "lacks"
  ];

  const uncertain =
    uncertaintyWords.some(
      word =>
        value.includes(word)
    );

  const negative =
    negativeWords.some(
      word =>
        value.includes(word)
    );

  if (negative) {
    return uncertain
      ? "uncertain_negative"
      : "negative";
  }

  if (uncertain) {
    return "uncertain";
  }

  return "positive";
}

function extractClaims(source) {
  const sentences =
    splitSentences(
      source.content
    );

  const claims = [];

  for (
    const sentence
    of sentences
  ) {
    if (
      !sentenceIsUseful(
        sentence
      )
    ) {
      continue;
    }

    const concepts =
      conceptMatches(
        sentence
      );

    if (
      concepts.length === 0
    ) {
      continue;
    }

    claims.push({
      claim:
        sentence,

      stance:
        claimStance(
          sentence
        ),

      concepts:
        concepts.map(
          item =>
            item.concept
        ),

      source: {
        title:
          source.title,

        url:
          source.url
      }
    });

    if (
      claims.length >= 12
    ) {
      break;
    }
  }

  return claims;
}


/* =========================================================
   CLAIM COMPARISON
   ========================================================= */

function claimSimilarity(a, b) {
  const words =
    wordOverlap(
      a.claim,
      b.claim
    );

  const concepts =
    conceptScore(
      a.claim,
      b.claim
    );

  const sameStance =
    a.stance === b.stance;

  let score =
    words +
    concepts.score * 4;

  if (sameStance) {
    score += 3;
  }

  return {
    score,

    word_overlap:
      words,

    concept_overlap:
      concepts.score,

    matched_concepts:
      concepts.matched,

    same_stance:
      sameStance
  };
}

function compareClaims(
  claims
) {
  const comparisons = [];

  for (
    let i = 0;
    i < claims.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < claims.length;
      j++
    ) {
      const A =
        claims[i];

      const B =
        claims[j];

      const similarity =
        claimSimilarity(
          A,
          B
        );

      if (
        similarity.score < 8
      ) {
        continue;
      }

      let interpretation =
        "uncertain";

      if (
        similarity.concept_overlap >= 1 &&
        similarity.same_stance
      ) {
        interpretation =
          "agreement";
      }

      if (
        similarity.concept_overlap >= 1 &&
        !similarity.same_stance
      ) {
        interpretation =
          "potential_conflict";
      }

      comparisons.push({
        claim_a:
          A.claim,

        claim_b:
          B.claim,

        source_a:
          A.source,

        source_b:
          B.source,

        stance_a:
          A.stance,

        stance_b:
          B.stance,

        similarity,

        interpretation
      });
    }
  }

  return comparisons;
}


/* =========================================================
   CLAIM CONSENSUS
   ========================================================= */

function buildClaimFindings(
  claims
) {
  const findings = [];

  const used =
    new Set();

  for (
    let i = 0;
    i < claims.length;
    i++
  ) {
    if (used.has(i)) {
      continue;
    }

    const group = [
      {
        index: i,
        claim:
          claims[i]
      }
    ];

    for (
      let j = i + 1;
      j < claims.length;
      j++
    ) {
      if (used.has(j)) {
        continue;
      }

      const similarity =
        claimSimilarity(
          claims[i],
          claims[j]
        );

      if (
        similarity.score >= 10 &&
        similarity.concept_overlap >= 1
      ) {
        group.push({
          index: j,
          claim:
            claims[j]
        });
      }
    }

    if (
      group.length < 2
    ) {
      continue;
    }

    for (
      const item
      of group
    ) {
      used.add(
        item.index
      );
    }

    const positive =
      group.filter(
        item =>
          item.claim.stance ===
          "positive"
      ).length;

    const negative =
      group.filter(
        item =>
          item.claim.stance ===
          "negative"
      ).length;

    const uncertain =
      group.filter(
        item =>
          item.claim.stance.includes(
            "uncertain"
          )
      ).length;

    let finding =
      "uncertain";

    if (
      positive > 0 &&
      negative === 0 &&
      uncertain === 0
    ) {
      finding =
        "agreement";
    } else if (
      negative > 0 &&
      positive === 0 &&
      uncertain === 0
    ) {
      finding =
        "agreement_negative";
    } else if (
      positive > 0 &&
      negative > 0
    ) {
      finding =
        "conflict";
    } else {
      finding =
        "mixed_or_uncertain";
    }

    findings.push({
      representative_claim:
        group[0].claim.claim,

      sources:
        group.map(
          item =>
            item.claim.source
        ),

      claims:
        group.map(
          item =>
            item.claim.claim
        ),

      finding,

      source_count:
        group.length,

      positive_count:
        positive,

      negative_count:
        negative,

      uncertain_count:
        uncertain
    });
  }

  return findings;
}


/* =========================================================
   AREN CONCLUSION
   ========================================================= */

function buildResearchConclusion(
  query,
  sources,
  claims,
  findings
) {
  const agreement =
    findings.filter(
      finding =>
        finding.finding ===
        "agreement"
    );

  const negativeAgreement =
    findings.filter(
      finding =>
        finding.finding ===
        "agreement_negative"
    );

  const conflicts =
    findings.filter(
      finding =>
        finding.finding ===
        "conflict"
    );

  const uncertain =
    findings.filter(
      finding =>
        finding.finding ===
        "mixed_or_uncertain" ||
        finding.finding ===
        "uncertain"
    );

  let confidence = 1;

  if (
    agreement.length >= 2
  ) {
    confidence = 4;
  } else if (
    agreement.length === 1
  ) {
    confidence = 3;
  }

  if (
    conflicts.length > 0
  ) {
    confidence =
      Math.max(
        2,
        confidence - 1
      );
  }

  const successfulSources =
    sources.filter(
      source =>
        source.success
    ).length;

  let conclusion;

  if (
    claims.length === 0
  ) {
    conclusion =
      "Aren does not have enough claim-level evidence to form a conclusion from these sources.";
    confidence = 1;
  } else if (
    conflicts.length > 0
  ) {
    conclusion =
      "Aren finds that the sources contain both supporting and conflicting claims. Aren should not treat the subject as settled and should preserve the conflicting evidence for further examination.";
  } else if (
    agreement.length > 0
  ) {
    conclusion =
      "Aren finds consistent support for some claims across the sources, but treats that consistency as evidence rather than proof.";
  } else {
    conclusion =
      "Aren finds information related to the subject, but the available claims are not sufficiently aligned to form a strong conclusion.";
    confidence =
      Math.min(
        confidence,
        2
      );
  }

  const evidenceSummary =
    [
      `Sources successfully read: ${successfulSources}.`,
      `Claims extracted: ${claims.length}.`,
      `Agreement findings: ${agreement.length}.`,
      `Negative-agreement findings: ${negativeAgreement.length}.`,
      `Conflict findings: ${conflicts.length}.`,
      `Uncertain or mixed findings: ${uncertain.length}.`,
      "Aren's conclusion is a synthesis produced from the retrieved evidence, not a quotation from any source."
    ].join(" ");

  return {
    query,

    conclusion,

    evidence_summary:
      evidenceSummary,

    agreement_count:
      agreement.length,

    conflict_count:
      conflicts.length,

    uncertain_count:
      uncertain.length,

    confidence
  };
}


/* =========================================================
   FULL RESEARCH QUERY
   ========================================================= */

async function handleResearchQuery(
  env,
  url
) {
  await ensureTables(env);

  const query =
    url.searchParams.get(
      "q"
    );

  if (!query) {
    return textResponse(
      "Missing q",
      400
    );
  }

  const requestedLimit =
    Number(
      url.searchParams.get(
        "limit"
      ) || 5
    );

  const limit =
    Math.min(
      Math.max(
        requestedLimit,
        1
      ),
      8
    );

  const search =
    await performSearch(
      query
    );

  if (!search.success) {
    return json(
      {
        error:
          "Aren search request failed.",

        details:
          search
      },
      502
    );
  }

  const selected =
    search.results.slice(
      0,
      limit
    );

  const sources = [];

  for (
    const result
    of selected
  ) {
    const source =
      await fetchResearchSource(
        result.url
      );

    sources.push({
      ...source,

      search_title:
        result.title
    });
  }

  const successfulSources =
    sources.filter(
      source =>
        source.success
    );

  const failedSources =
    sources.filter(
      source =>
        !source.success
    );

  const claims = [];

  for (
    const source
    of successfulSources
  ) {
    const extracted =
      extractClaims(
        source
      );

    for (
      const claim
      of extracted
    ) {
      claims.push({
        ...claim,

        source: {
          title:
            source.title ||
            source.search_title,

          url:
            source.url
        }
      });
    }
  }

  const comparisons =
    compareClaims(
      claims
    );

  const findings =
    buildClaimFindings(
      claims
    );

  const conclusion =
    buildResearchConclusion(
      query,
      sources,
      claims,
      findings
    );

  const researchRecord = {
    query,

    searched_at:
      new Date()
        .toISOString(),

    search_results:
      search.results,

    sources:
      sources.map(
        source => ({
          success:
            source.success,

          title:
            source.title ||
            source.search_title,

          url:
            source.url,

          content_length:
            source.content_length ||
            0,

          error:
            source.error ||
            null
        })
      ),

    claims,

    claim_comparisons:
      comparisons,

    findings,

    conclusion
  };

  const saved =
    await env.AREN_DB
      .prepare(`
        INSERT INTO research
          (
            query,
            url,
            title,
            source_type,
            content
          )
        VALUES
          (?, ?, ?, ?, ?)
        RETURNING id
      `)
      .bind(
        query,
        search.search_url,
        "Connected research",
        "research-query",
        JSON.stringify(
          researchRecord
        )
      )
      .first();

  const researchId =
    saved?.id || null;

  for (
    const claim
    of claims
  ) {
    await env.AREN_DB
      .prepare(`
        INSERT INTO research_claims
          (
            research_id,
            source_url,
            source_title,
            claim,
            stance,
            confidence
          )
        VALUES
          (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        researchId,
        claim.source.url,
        claim.source.title,
        claim.claim,
        claim.stance,
        claim.stance.includes(
          "uncertain"
        )
          ? 2
          : 4
      )
      .run();
  }

  await env.AREN_DB
    .prepare(`
      INSERT INTO research_conclusions
        (
          research_id,
          query,
          conclusion,
          evidence_summary,
          agreement_count,
          conflict_count,
          uncertain_count,
          confidence
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      researchId,
      query,
      conclusion.conclusion,
      conclusion.evidence_summary,
      conclusion.agreement_count,
      conclusion.conflict_count,
      conclusion.uncertain_count,
      conclusion.confidence
    )
    .run();

  return json({
    status:
      "Aren claim-based research completed.",

    research_id:
      researchId,

    query,

    process: [
      "web_search",
      "source_reading",
      "claim_extraction",
      "claim_comparison",
      "agreement_conflict_analysis",
      "aren_conclusion",
      "research_saved"
    ],

    sources_read:
      successfulSources.length,

    sources_failed:
      failedSources.length,

    claims_extracted:
      claims.length,

    comparison_count:
      comparisons.length,

    findings,

    aren_conclusion:
      conclusion,

    sources:
      sources.map(
        source => ({
          title:
            source.title ||
            source.search_title,

          url:
            source.url,

          success:
            source.success,

          content_length:
            source.content_length ||
            0,

          content:
            source.success
              ? source.content
              : null,

          error:
            source.error ||
            null
        })
      ),

    claims,

    instruction:
      "Aren must keep source information separate from its own conclusions. Agreement between sources is evidence of consistency, not proof. Conflicting or incomplete claims must remain available for further examination."
  });
}


/* =========================================================
   DIRECT URL RESEARCH
   ========================================================= */

async function handleResearch(
  env,
  url
) {
  await ensureTables(env);

  const target =
    url.searchParams.get(
      "url"
    );

  if (!target) {
    return textResponse(
      "Missing url",
      400
    );
  }

  const source =
    await fetchResearchSource(
      target
    );

  if (!source.success) {
    return json(
      {
        error:
          "Aren could not retrieve the webpage.",

        details:
          source
      },
      502
    );
  }

  const claims =
    extractClaims(
      source
    );

  const saved =
    await env.AREN_DB
      .prepare(`
        INSERT INTO research
          (
            query,
            url,
            title,
            source_type,
            content
          )
        VALUES
          (?, ?, ?, ?, ?)
        RETURNING id
      `)
      .bind(
        null,
        source.url,
        source.title,
        "url",
        source.content
      )
      .first();

  return json({
    status:
      "Aren research completed.",

    research_id:
      saved?.id || null,

    title:
      source.title,

    url:
      source.url,

    content_length:
      source.content_length,

    claims
  });
}


/* =========================================================
   RESEARCH HISTORY
   ========================================================= */

async function handleResearchHistory(
  env
) {
  await ensureTables(env);

  const result =
    await env.AREN_DB
      .prepare(`
        SELECT
          id,
          query,
          url,
          title,
          source_type,
          created
        FROM research
        ORDER BY id DESC
        LIMIT 50
      `)
      .all();

  return json({
    research:
      result.results || []
  });
}

async function handleResearchDetail(
  env,
  url
) {
  await ensureTables(env);

  const id =
    Number(
      url.searchParams.get(
        "id"
      )
    );

  if (!id) {
    return textResponse(
      "Missing id",
      400
    );
  }

  const research =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM research
        WHERE id = ?
      `)
      .bind(id)
      .first();

  if (!research) {
    return textResponse(
      "Research not found",
      404
    );
  }

  const claims =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM research_claims
        WHERE research_id = ?
        ORDER BY id ASC
      `)
      .bind(id)
      .all();

  const conclusions =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM research_conclusions
        WHERE research_id = ?
        ORDER BY id DESC
      `)
      .bind(id)
      .all();

  let record = null;

  try {
    record =
      JSON.parse(
        research.content
      );
  } catch {
    record = null;
  }

  return json({
    research: {
      id:
        research.id,

      query:
        research.query,

      url:
        research.url,

      title:
        research.title,

      source_type:
        research.source_type,

      created:
        research.created
    },

    claims:
      claims.results || [],

    conclusions:
      conclusions.results || [],

    record
  });
}


/* =========================================================
   IDENTITY / PRINCIPLES / LESSONS
   ========================================================= */

async function handleIdentity(env) {
  const result =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE type = 'identity'
        AND status = 'active'
        ORDER BY importance DESC, id ASC
      `)
      .all();

  return json({
    identity:
      result.results || []
  });
}

async function handlePrinciples(env) {
  const result =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE type = 'principle'
        AND status = 'active'
        ORDER BY importance DESC, id ASC
      `)
      .all();

  return json({
    principles:
      result.results || []
  });
}

async function handleLessons(env) {
  const result =
    await env.AREN_DB
      .prepare(`
        SELECT
          id,
          text,
          type,
          importance,
          status,
          saved,
          COALESCE(evidence_count, 0)
            AS evidence_count,
          COALESCE(challenged_count, 0)
            AS challenged_count,
          COALESCE(maturity, 'new')
            AS maturity
        FROM memories
        WHERE type = 'lesson'
        AND status = 'active'
        ORDER BY importance DESC, id ASC
      `)
      .all();

  return json({
    lessons:
      result.results || []
  });
}


/* =========================================================
   KV
   ========================================================= */

async function handleMemoryTest(env) {
  if (!env.KV) {
    return textResponse(
      "KV binding is missing",
      500
    );
  }

  return textResponse(
    "Aren memory is working"
  );
}


/* =========================================================
   ROOT
   ========================================================= */

async function handleRoot() {
  return new Response(`
<!DOCTYPE html>
<html>

<head>

  <meta charset="UTF-8">

  <title>Aren</title>

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <style>

    body {
      font-family: Arial, sans-serif;
      max-width: 900px;
      margin: 60px auto;
      padding: 20px;
      line-height: 1.6;
    }

    h1 {
      margin-bottom: 5px;
    }

    .subtitle {
      color: #666;
      margin-bottom: 30px;
    }

    a {
      display: block;
      margin: 10px 0;
      text-decoration: none;
    }

  </style>

</head>

<body>

  <h1>Aren</h1>

  <div class="subtitle">
    An evolving AI identity.
  </div>

  <a href="/identity">
    Identity
  </a>

  <a href="/memories">
    Memory
  </a>

  <a href="/principles">
    Principles
  </a>

  <a href="/lessons">
    Lessons
  </a>

  <a href="/development">
    Development
  </a>

  <a href="/judgments">
    Judgments
  </a>

  <a href="/autolearn">
    Autonomous Development
  </a>

  <a href="/research-history">
    Research
  </a>

</body>

</html>
  `, {
    headers: {
      "content-type":
        "text/html; charset=UTF-8"
    }
  });
}


/* =========================================================
   MAIN WORKER
   ========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    try {

      const url =
        new URL(
          request.url
        );

      const path =
        url.pathname;

      if (!env.AREN_DB) {
        return textResponse(
          "Aren Worker Error: AREN_DB binding is missing",
          500
        );
      }

      switch (path) {

        case "/":
          return handleRoot();

        case "/memory-test":
          return handleMemoryTest(
            env
          );

        case "/memory":
          return handleMemory(
            env,
            url
          );

        case "/remember":
          return handleRemember(
            env,
            url
          );

        case "/memories":
          return handleMemories(
            env
          );

        case "/memory/type":
          return handleMemoryType(
            env,
            url
          );

        case "/identity":
          return handleIdentity(
            env
          );

        case "/principles":
          return handlePrinciples(
            env
          );

        case "/lessons":
          return handleLessons(
            env
          );

        case "/development":
          return handleDevelopment(
            env
          );

        case "/think":
          return handleThink(
            env,
            url
          );

        case "/decide":
          return handleDecide(
            env,
            url
          );

        case "/judgment":
          return handleDecide(
            env,
            url
          );

        case "/judgments":
          return handleJudgments(
            env
          );

        case "/review":
          return handleReview(
            env,
            url
          );

        case "/judgment/review":
          return handleReview(
            env,
            url
          );

        case "/history":
          return handleHistory(
            env,
            url
          );

        case "/update-memory":
          return handleUpdateMemory(
            env,
            url
          );

        case "/challenge":
          return handleChallenge(
            env,
            url
          );

        case "/evidence":
          return handleEvidence(
            env,
            url
          );

        case "/autolearn":
          return handleAutonomousDevelopment(
            env
          );

        case "/research":
          return handleResearch(
            env,
            url
          );

        case "/search":
          return handleSearch(
            env,
            url
          );

        case "/research-query":
          return handleResearchQuery(
            env,
            url
          );

        case "/research-history":
          return handleResearchHistory(
            env
          );

        case "/research-detail":
          return handleResearchDetail(
            env,
            url
          );

        default:
          return json(
            {
              error:
                "Not found",

              path
            },
            404
          );
      }

    } catch (error) {

      return textResponse(
        "Aren Worker Error: " +
        error.message,
        500
      );
    }
  }
};
