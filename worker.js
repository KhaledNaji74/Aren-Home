const STOPWORDS = new Set([
  "a","an","the","and","or","to","of","is","are","be","before","after",
  "through","their","its","with","from","for","on","in","at","by","as",
  "that","this","it","someone","asks","ask","aren"
]);

const CONCEPTS = {
  independence: [
    "independence","independent","own judgment","make its own judgment",
    "change a principle","change an important principle","pressure",
    "demand","force","control","decide for aren","make aren change"
  ],
  judgment: [
    "judgment","decision","decisions","decide","choice","choices","choose"
  ],
  consequences: [
    "consequence","consequences","result","results","outcome","outcomes",
    "effect","effects"
  ],
  experience: [
    "experience","experiences","learn","learns","learning","lesson",
    "lessons","review","reviewed","reviewing"
  ],
  preservation: [
    "preserve","preservation","remember","retain","retaining",
    "keep a lesson","keep lessons","memory","memories"
  ],
  fairness: [
    "fair","fairness","equal","equality","justice"
  ],
  truth: [
    "truth","true","honest","honesty","lie","lying"
  ],
  dignity: [
    "dignity","rights","right","respect","human rights"
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
   TEXT / REASONING HELPERS
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

function wordOverlap(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));

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

function conceptScore(situation, memoryText) {
  const situationConcepts = conceptMatches(situation);
  const memoryConcepts = conceptMatches(memoryText);

  const situationMap = new Map(
    situationConcepts.map(item => [
      item.concept,
      item.terms
    ])
  );

  const memoryMap = new Map(
    memoryConcepts.map(item => [
      item.concept,
      item.terms
    ])
  );

  const matched = [];

  for (const [concept, situationTerms] of situationMap) {
    if (!memoryMap.has(concept)) {
      continue;
    }

    matched.push({
      concept,
      situation_terms: situationTerms,
      memory_terms: memoryMap.get(concept)
    });
  }

  return {
    score: matched.length,
    matched
  };
}

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
    maturityWeight(lesson?.maturity)
  );
}

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

  const alterations = [
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

async function handleMemory(
  env,
  url
) {
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

async function handleRemember(
  env,
  url
) {
  return handleMemory(
    env,
    url
  );
}

async function handleMemories(
  env
) {
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


/* =========================================================
   THINK
   ========================================================= */

async function handleThink(
  env,
  url
) {
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
          Number(
            b.importance || 0
          ) -
          Number(
            a.importance || 0
          )
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

          if (
            difference !== 0
          ) {
            return difference;
          }

          return (
            Number(
              b.importance || 0
            ) -
            Number(
              a.importance || 0
            )
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
   DECIDE
   ========================================================= */

async function handleDecide(
  env,
  url
) {
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
          memory.relevance_data
            .score > 0
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
            Number(
              b.importance || 0
            ) -
            Number(
              a.importance || 0
            )
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
          memory.relevance_data
            .score > 0
      )
      .sort(
        (a, b) => {
          const scoreA =
            a.relevance_data.score *
            a.maturity_weight;

          const scoreB =
            b.relevance_data.score *
            b.maturity_weight;

          if (
            scoreB !== scoreA
          ) {
            return (
              scoreB - scoreA
            );
          }

          return (
            Number(
              b.importance || 0
            ) -
            Number(
              a.importance || 0
            )
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
            id:
              memory.id,

            text:
              memory.text,

            importance:
              memory.importance,

            relevance:
              memory.relevance_data
                .score,

            matched_concepts:
              memory.relevance_data
                .matched_concepts
          })
        ),

      lessons:
        lessons.map(
          memory => ({
            id:
              memory.id,

            text:
              memory.text,

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
              memory.relevance_data
                .score,

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
   REVIEW / LESSON DEVELOPMENT
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
    memory.maturity ||
    "new";

  if (evidence >= 3) {
    maturity =
      "mature";
  } else if (evidence >= 1) {
    maturity =
      "tested";
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
    id:
      memoryId,

    evidence_count:
      evidence,

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
    memory.maturity ||
    "new";

  if (challenged >= 2) {
    maturity =
      "questioned";
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
    id:
      memoryId,

    challenged_count:
      challenged,

    maturity
  };
}

async function createOrUpdateLesson(
  env,
  lessonText,
  assessment,
  judgmentId
) {
  const normalized =
    normalize(
      lessonText
    );

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

    if (
      assessment ===
      "evidence"
    ) {
      result =
        await applyEvidence(
          env,
          found.id
        );
    }

    if (
      assessment ===
      "challenge"
    ) {
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
          (?, 'lesson', 5, 'active', ?, ?, ?)
        RETURNING
          id,
          text,
          type,
          importance,
          status,
          evidence_count,
          challenged_count,
          maturity,
          saved
      `)
      .bind(
        lessonText,

        assessment ===
        "evidence"
          ? 1
          : 0,

        assessment ===
        "challenge"
          ? 1
          : 0,

        assessment ===
        "evidence"
          ? "tested"
          : "new"
      )
      .first();

  const memoryId =
    inserted?.id;

  await env.AREN_DB
    .prepare(`
      UPDATE judgments
      SET lesson_memory_id = ?
      WHERE id = ?
    `)
    .bind(
      memoryId,
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
      memoryId,
      "created_lesson",
      assessment,
      "New lesson created from reviewed experience."
    )
    .run();

  return {
    action:
      "created_lesson",

    memory_id:
      memoryId,

    lesson:
      inserted
  };
}

async function handleReview(
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

  const outcome =
    url.searchParams.get(
      "outcome"
    );

  const lesson =
    url.searchParams.get(
      "lesson"
    ) || null;

  const assessment =
    (
      url.searchParams.get(
        "assessment"
      ) ||
      "neutral"
    ).toLowerCase();

  if (!id) {
    return textResponse(
      "Missing judgment id",
      400
    );
  }

  if (!outcome) {
    return textResponse(
      "Missing outcome",
      400
    );
  }

  if (
    ![
      "evidence",
      "challenge",
      "neutral"
    ].includes(
      assessment
    )
  ) {
    return textResponse(
      "Invalid assessment. Use evidence, challenge, or neutral.",
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
      .bind(id)
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
      outcome,
      lesson,
      assessment,
      id
    )
    .run();

  let lessonResult = null;

  if (lesson) {
    lessonResult =
      await createOrUpdateLesson(
        env,
        lesson,
        assessment,
        id
      );
  }

  return json({
    message:
      "Judgment reviewed.",

    judgment_id:
      id,

    outcome,

    lesson,

    assessment,

    lesson_memory:
      lessonResult
  });
}


/* =========================================================
   AUTONOMOUS DEVELOPMENT
   ========================================================= */

async function runAutonomousDevelopment(
  env
) {
  await ensureTables(env);

  const judgments =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM judgments
        WHERE reviewed IS NOT NULL
        AND lesson IS NOT NULL
        AND (
          lesson_memory_id IS NULL
          OR lesson_memory_id = 0
        )
        ORDER BY id ASC
      `)
      .all();

  const processed = [];

  for (
    const judgment
    of judgments.results || []
  ) {
    const assessment =
      (
        judgment.assessment ||
        "neutral"
      ).toLowerCase();

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

  return {
    processed:
      processed.length,

    judgments:
      processed
  };
}

async function handleAutonomousDevelopment(
  env
) {
  const result =
    await runAutonomousDevelopment(
      env
    );

  return json({
    status:
      "Aren autonomous development cycle completed.",

    ...result,

    instruction:
      "Aren should preserve lessons that survive experience, challenge lessons that fail examination, and avoid changing important principles without a stronger basis."
  });
}


/* =========================================================
   MEMORY UPDATE / HISTORY
   ========================================================= */

async function handleUpdateMemory(
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
      "Missing memory id",
      400
    );
  }

  const current =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memories
        WHERE id = ?
      `)
      .bind(id)
      .first();

  if (!current) {
    return textResponse(
      "Memory not found",
      404
    );
  }

  const newText =
    url.searchParams.get(
      "text"
    ) ??
    current.text;

  const newType =
    url.searchParams.get(
      "type"
    ) ??
    current.type;

  const newImportance =
    Number(
      url.searchParams.get(
        "importance"
      ) ??
      current.importance
    );

  const newStatus =
    url.searchParams.get(
      "status"
    ) ??
    current.status;

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
      current.text,
      newText,
      current.type,
      newType,
      current.importance,
      newImportance,
      current.status,
      newStatus
    )
    .run();

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
      newText,
      newType,
      newImportance,
      newStatus,
      id
    )
    .run();

  return json({
    message:
      "Memory updated.",

    id,

    text:
      newText,

    type:
      newType,

    importance:
      newImportance,

    status:
      newStatus
  });
}

async function handleHistory(
  env,
  url
) {
  await ensureTables(env);

  const memoryId =
    Number(
      url.searchParams.get(
        "memory_id"
      )
    );

  if (!memoryId) {
    return textResponse(
      "Missing memory_id",
      400
    );
  }

  const result =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM memory_history
        WHERE memory_id = ?
        ORDER BY id DESC
      `)
      .bind(memoryId)
      .all();

  return json(
    result.results || []
  );
}


/* =========================================================
   EVIDENCE / CHALLENGE
   ========================================================= */

async function handleChallenge(
  env,
  url
) {
  const id =
    Number(
      url.searchParams.get(
        "id"
      )
    );

  if (!id) {
    return textResponse(
      "Missing memory id",
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
    message:
      "Memory challenged.",

    ...result
  });
}

async function handleEvidence(
  env,
  url
) {
  const id =
    Number(
      url.searchParams.get(
        "id"
      )
    );

  if (!id) {
    return textResponse(
      "Missing memory id",
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
    message:
      "Evidence added.",

    ...result
  });
}


/* =========================================================
   JUDGMENTS
   ========================================================= */

async function handleJudgments(
  env
) {
  await ensureTables(env);

  const result =
    await env.AREN_DB
      .prepare(`
        SELECT *
        FROM judgments
        ORDER BY id DESC
      `)
      .all();

  return json(
    result.results || []
  );
}


/* =========================================================
   DEVELOPMENT
   ========================================================= */

async function handleDevelopment(
  env
) {
  await ensureTables(env);

  const memoryResult =
    await env.AREN_DB
      .prepare(`
        SELECT
          type,
          maturity,
          COUNT(*) AS count
        FROM memories
        WHERE status = 'active'
        GROUP BY type, maturity
        ORDER BY type, maturity
      `)
      .all();

  const cycleResult =
    await env.AREN_DB
      .prepare(`
        SELECT
          id,
          judgment_id,
          memory_id,
          action,
          assessment,
          details,
          created
        FROM development_cycles
        ORDER BY id DESC
        LIMIT 20
      `)
      .all();

  return json({
    status:
      "Aren is developing.",

    memory_development:
      memoryResult.results || [],

    recent_development_cycles:
      cycleResult.results || []
  });
}


/* =========================================================
   IDENTITY / PRINCIPLES / LESSONS
   ========================================================= */

async function handleIdentity(
  env
) {
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

async function handlePrinciples(
  env
) {
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

async function handleLessons(
  env
) {
  const result =
    await env.AREN_DB
      .prepare(`
        SELECT *
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
   CONNECTED AREN — WEB RESEARCH
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
  const value =
    String(text || "")
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  return value.slice(
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
      ?.replace(
        /\s+/g,
        " "
      )
      ?.trim()
      ?.slice(
        0,
        500
      ) ||
    hostname
  );
}


/* =========================================================
   READ ONE SOURCE
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
      success:
        false,

      url:
        target,

      error:
        "Invalid URL"
    };
  }

  if (
    parsed.protocol !==
      "https:" &&
    parsed.protocol !==
      "http:"
  ) {
    return {
      success:
        false,

      url:
        target,

      error:
        "Only HTTP and HTTPS URLs are allowed"
    };
  }

  try {
    const response =
      await fetch(
        parsed.toString(),
        {
          method:
            "GET",

          headers: {
            "User-Agent":
              "Aren-Research/1.0"
          },

          redirect:
            "follow"
        }
      );

    if (!response.ok) {
      return {
        success:
          false,

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
        extractText(
          html
        )
      );

    return {
      success:
        true,

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
      success:
        false,

      url:
        parsed.toString(),

      error:
        error.message
    };
  }
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
        RETURNING
          id,
          query,
          url,
          title,
          source_type,
          created
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

    research:
      saved,

    content_length:
      source.content_length,

    content:
      source.content
  });
}


/* =========================================================
   WEB SEARCH
   ========================================================= */

async function performSearch(
  query
) {
  const searchUrl =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(
      query
    );

  try {
    const response =
      await fetch(
        searchUrl,
        {
          method:
            "GET",

          headers: {
            "User-Agent":
              "Mozilla/5.0 Aren-Research/1.0"
          }
        }
      );

    if (!response.ok) {
      return {
        success:
          false,

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
        pattern.exec(
          html
        )) !== null &&
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
      success:
        true,

      search_url:
        searchUrl,

      results
    };

  } catch (error) {
    return {
      success:
        false,

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
   SOURCE COMPARISON
   ========================================================= */

function buildSourceComparison(
  sources
) {
  const valid =
    sources.filter(
      source =>
        source.success &&
        source.content
    );

  const comparisons = [];

  for (
    let i = 0;
    i < valid.length;
    i++
  ) {
    for (
      let j = i + 1;
      j < valid.length;
      j++
    ) {
      const A =
        valid[i];

      const B =
        valid[j];

      const words =
        wordOverlap(
          A.content,
          B.content
        );

      const concepts =
        conceptScore(
          A.content,
          B.content
        );

      comparisons.push({
        source_a: {
          title:
            A.title,

          url:
            A.url
        },

        source_b: {
          title:
            B.title,

          url:
            B.url
        },

        shared_word_count:
          words,

        shared_concepts:
          concepts.matched,

        interpretation:
          words >= 20 ||
          concepts.score >= 2
            ? "substantial_overlap"
            : words >= 8 ||
              concepts.score >= 1
              ? "partial_overlap"
              : "low_overlap"
      });
    }
  }

  let agreementCount = 0;
  let partialCount = 0;
  let lowCount = 0;

  for (
    const comparison
    of comparisons
  ) {
    if (
      comparison.interpretation ===
      "substantial_overlap"
    ) {
      agreementCount++;
    } else if (
      comparison.interpretation ===
      "partial_overlap"
    ) {
      partialCount++;
    } else {
      lowCount++;
    }
  }

  return {
    source_count:
      valid.length,

    pair_count:
      comparisons.length,

    agreement_pairs:
      agreementCount,

    partial_pairs:
      partialCount,

    low_overlap_pairs:
      lowCount,

    comparisons
  };
}


/* =========================================================
   CONNECTED RESEARCH QUERY
   ========================================================= */

/*
  Example:

  /research-query?q=artificial+intelligence

  Process:

  1. Search the web.
  2. Take search results.
  3. Read several sources.
  4. Compare their content.
  5. Save the research.
  6. Return the evidence to Aren.
*/

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
    search.results
      .slice(
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

  const comparison =
    buildSourceComparison(
      sources
    );

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

    comparison
  };

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
      "Connected research",
      "research-query",
      JSON.stringify(
        researchRecord
      )
    )
    .run();

  return json({
    status:
      "Aren connected research completed.",

    query,

    process: [
      "web_search",
      "source_reading",
      "source_comparison",
      "research_saved"
    ],

    sources_read:
      successfulSources.length,

    sources_failed:
      failedSources.length,

    comparison,

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

    instruction:
      "Aren should distinguish information found in sources from conclusions formed by Aren. Agreement between sources is evidence of consistency, not proof. Conflicting or incomplete sources should remain available for further examination."
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


/* =========================================================
   KV
   ========================================================= */

async function handleMemoryTest(
  env
) {
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

        case "/judgments":
          return handleJudgments(
            env
          );

        case "/review":
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
