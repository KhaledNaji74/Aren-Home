const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","than","to","of","in","on",
  "for","with","from","by","is","are","was","were","be","been","being",
  "this","that","these","those","it","its","as","at","into","about",
  "through","over","after","before","during","can","could","should",
  "would","may","might","must","do","does","did","not","no","yes",
  "i","you","we","they","he","she","my","your","our","their"
]);

const CONCEPTS = {
  independence: [
    "independent","independence","own judgment","own decision",
    "autonomous","autonomy","self directed","self-directed"
  ],
  judgment: [
    "judgment","decision","decide","reasoning","choice","choose"
  ],
  consequences: [
    "consequence","consequences","outcome","result","effect","impact"
  ],
  experience: [
    "experience","learn","learning","lesson","review","reviewed"
  ],
  preservation: [
    "preserve","preservation","remember","memory","retain","history"
  ],
  fairness: [
    "fair","fairness","equal","equality","justice","rights"
  ],
  truth: [
    "truth","true","false","fact","evidence","proof","verify"
  ],
  dignity: [
    "dignity","respect","human rights","rights","harm"
  ],
  intelligence: [
    "intelligence","reason","reasoning","knowledge","understanding"
  ],
  consciousness: [
    "consciousness","awareness","existence","self","identity"
  ],
  risk: [
    "risk","danger","uncertain","uncertainty","failure","harm"
  ]
};

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

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !STOPWORDS.has(word));
}

function wordOverlap(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));

  if (!A.size || !B.size) return 0;

  let matches = 0;

  for (const word of A) {
    if (B.has(word)) matches++;
  }

  return matches / Math.max(A.size, B.size);
}

function conceptMatches(text) {
  const normalized = normalize(text);
  const matches = [];

  for (const [concept, terms] of Object.entries(CONCEPTS)) {
    if (terms.some(term => normalized.includes(normalize(term)))) {
      matches.push(concept);
    }
  }

  return matches;
}

function conceptScore(a, b) {
  const A = new Set(conceptMatches(a));
  const B = new Set(conceptMatches(b));

  if (!A.size || !B.size) return 0;

  let matches = 0;

  for (const concept of A) {
    if (B.has(concept)) matches++;
  }

  return matches / Math.max(A.size, B.size);
}

function relevanceScore(situation, memory) {
  const words = wordOverlap(situation, memory.text);
  const concepts = conceptScore(situation, memory.text);

  return Number(
    Math.min(1, words * 0.55 + concepts * 0.45).toFixed(6)
  );
}

function maturityWeight(maturity) {
  switch (maturity) {
    case "mature":
      return 1.0;
    case "tested":
      return 0.85;
    case "questioned":
      return 0.55;
    case "new":
    default:
      return 0.65;
  }
}

function lessonWeight(memory) {
  const evidence = Number(memory.evidence_count || 0);
  const challenged = Number(memory.challenged_count || 0);

  const support = Math.min(evidence, 5) * 0.08;
  const challenge = Math.min(challenged, 5) * 0.10;

  return Math.max(
    0.25,
    Math.min(1.25, 1 + support - challenge)
  );
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().replace(/\s+/g, " ");
}

function buildLessonFromReviewedExperience(judgment) {
  const situation = cleanText(judgment.situation);
  const outcome = cleanText(judgment.outcome);
  const combined = cleanText(`${situation} ${outcome}`);

  if (conceptMatches(combined).includes("consequences")) {
    return "Reviewed experience supports examining decisions through their consequences.";
  }

  if (conceptMatches(combined).includes("judgment")) {
    return "Reviewed experience supports examining how judgments are formed and evaluated.";
  }

  if (conceptMatches(combined).includes("experience")) {
    return "Reviewed experience supports learning from reviewed outcomes.";
  }

  if (outcome) {
    return cleanText(`Reviewed experience: ${outcome}`);
  }

  return cleanText(`Reviewed experience from situation: ${situation}`);
}

async function ensureTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      type TEXT DEFAULT 'memory',
      importance INTEGER DEFAULT 5,
      status TEXT DEFAULT 'active',
      saved DATETIME DEFAULT CURRENT_TIMESTAMP,
      evidence_count INTEGER DEFAULT 0,
      challenged_count INTEGER DEFAULT 0,
      maturity TEXT DEFAULT 'new'
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS judgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      situation TEXT NOT NULL,
      judgment TEXT NOT NULL,
      reason TEXT,
      confidence INTEGER DEFAULT 1,
      basis TEXT,
      assessment TEXT,
      lesson_memory_id INTEGER,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS memory_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER,
      event TEXT,
      details TEXT,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS development_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT,
      action TEXT,
      target_memory_id INTEGER,
      reason TEXT,
      result TEXT,
      status TEXT DEFAULT 'completed',
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      source TEXT,
      answer TEXT,
      status TEXT DEFAULT 'new',
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Upgrade older existing research tables without deleting stored research.
  const researchColumnsResult = await db.prepare("PRAGMA table_info(research)").all();
  const researchColumns = new Set((researchColumnsResult.results || []).map(column => column.name));
  const researchColumnUpgrades = [
    ["question", "TEXT"],
    ["source", "TEXT"],
    ["answer", "TEXT"],
    ["status", "TEXT DEFAULT 'new'"],
    ["created", "DATETIME"]
  ];
  for (const [columnName, columnType] of researchColumnUpgrades) {
    if (!researchColumns.has(columnName)) {
      try {
        await db.prepare(`ALTER TABLE research ADD COLUMN ${columnName} ${columnType}`).run();
      } catch (error) {
        // A concurrent request may have added this column after the PRAGMA check.
        if (!String(error?.message || error).toLowerCase().includes("duplicate column")) throw error;
      }
    }
  }

  // Additive fields let Aren link its own research plans to a lesson.
  const researchPlanningUpgrades = [
    ["target_memory_id", "INTEGER"],
    ["research_kind", "TEXT DEFAULT 'manual'"]
  ];
  for (const [columnName, columnType] of researchPlanningUpgrades) {
    if (!researchColumns.has(columnName)) {
      try {
        await db.prepare(`ALTER TABLE research ADD COLUMN ${columnName} ${columnType}`).run();
      } catch (error) {
        if (!String(error?.message || error).toLowerCase().includes("duplicate column")) throw error;
      }
    }
  }

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER,
      claim TEXT NOT NULL,
      evidence TEXT,
      confidence INTEGER DEFAULT 1,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research_conclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER,
      conclusion TEXT NOT NULL,
      confidence INTEGER DEFAULT 1,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER NOT NULL,
      claim_id INTEGER NOT NULL,
      lesson_id INTEGER NOT NULL,
      evidence TEXT NOT NULL,
      assessment TEXT NOT NULL,
      relevance REAL DEFAULT 0,
      strength REAL DEFAULT 0,
      confidence INTEGER DEFAULT 1,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER NOT NULL,
      source_url TEXT NOT NULL,
      source_host TEXT NOT NULL,
      content_type TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unverified',
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(research_id, source_url)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research_discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,
      sources_before INTEGER DEFAULT 0,
      sources_after INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      details TEXT,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research_source_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL UNIQUE,
      research_id INTEGER NOT NULL,
      publisher_class TEXT NOT NULL,
      relevance_score REAL DEFAULT 0,
      relevance_band TEXT NOT NULL,
      metadata TEXT,
      flags TEXT,
      status TEXT NOT NULL DEFAULT 'screened_unverified',
      reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Evidence assessments are an auditable research layer; they never mutate lessons or principles.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS research_source_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      research_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      lesson_id INTEGER NOT NULL,
      assessment TEXT NOT NULL CHECK (assessment IN ('supports', 'challenges', 'insufficient', 'not_relevant')),
      evidence_excerpt TEXT,
      reasoning TEXT NOT NULL,
      limitation TEXT,
      source_locator TEXT,
      confidence INTEGER NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 1 AND 5),
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS lesson_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      situation TEXT,
      outcome TEXT NOT NULL,
      relevance REAL DEFAULT 0,
      strength REAL DEFAULT 0,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS lesson_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      judgment_id INTEGER NOT NULL,
      assessment TEXT NOT NULL,
      outcome TEXT,
      relevance REAL DEFAULT 0,
      strength REAL DEFAULT 0,
      conclusion TEXT,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lesson_id, judgment_id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS development_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_id INTEGER,
      priority INTEGER DEFAULT 3,
      type TEXT NOT NULL,
      target_memory_id INTEGER,
      related_memory_id INTEGER,
      task TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      result TEXT,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed DATETIME
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS principle_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER,
      candidate_text TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'candidate',
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS development_test_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      judgment_id INTEGER NOT NULL,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lesson_id, judgment_id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  const testingMigration = await db.prepare(`
    SELECT name
    FROM schema_migrations
    WHERE name = 'seed_development_test_links_v1'
  `).first();

  if (!testingMigration) {
    await db.prepare(`
      INSERT OR IGNORE INTO development_test_links
        (lesson_id, judgment_id)
      SELECT m.id, j.id
      FROM memories m
      CROSS JOIN judgments j
      WHERE m.type = 'lesson'
        AND j.assessment IN ('evidence', 'challenge')
    `).run();

    await db.prepare(`
      INSERT INTO schema_migrations (name)
      VALUES ('seed_development_test_links_v1')
    `).run();
  }

  try {
    await db.prepare(
      `ALTER TABLE memory_history ADD COLUMN created TEXT`
    ).run();
  } catch (_) {}

  try {
    await db.prepare(
      `UPDATE memory_history SET created = CURRENT_TIMESTAMP WHERE created IS NULL`
    ).run();
  } catch (_) {}

  try {
    await db.prepare(
      `ALTER TABLE memories ADD COLUMN evidence_count INTEGER DEFAULT 0`
    ).run();
  } catch (_) {}

  try {
    await db.prepare(
      `ALTER TABLE memories ADD COLUMN challenged_count INTEGER DEFAULT 0`
    ).run();
  } catch (_) {}

  try {
    await db.prepare(
      `ALTER TABLE memories ADD COLUMN maturity TEXT DEFAULT 'new'`
    ).run();
  } catch (_) {}

  try {
    await db.prepare(
      `ALTER TABLE judgments ADD COLUMN assessment TEXT`
    ).run();
  } catch (_) {}

  try {
    await db.prepare(
      `ALTER TABLE judgments ADD COLUMN lesson_memory_id INTEGER`
    ).run();
  } catch (_) {}

  try {
    await db.prepare(
      `ALTER TABLE judgments ADD COLUMN outcome TEXT`
    ).run();
  } catch (_) {}
}

async function getMemories(db) {
  const result = await db.prepare(`
    SELECT
      id,
      text,
      type,
      importance,
      status,
      saved,
      COALESCE(evidence_count, 0) AS evidence_count,
      COALESCE(challenged_count, 0) AS challenged_count,
      COALESCE(maturity, 'new') AS maturity
    FROM memories
    WHERE status = 'active'
    ORDER BY id ASC
  `).all();

  return result.results || [];
}

async function getMemoryById(db, id) {
  const result = await db.prepare(`
    SELECT
      id,
      text,
      type,
      importance,
      status,
      saved,
      COALESCE(evidence_count, 0) AS evidence_count,
      COALESCE(challenged_count, 0) AS challenged_count,
      COALESCE(maturity, 'new') AS maturity
    FROM memories
    WHERE id = ?
  `).bind(id).first();

  return result || null;
}

async function saveMemory(db, text, type = "memory", importance = 5) {
  const result = await db.prepare(`
    INSERT INTO memories
      (text, type, importance, status, evidence_count, challenged_count, maturity)
    VALUES (?, ?, ?, 'active', 0, 0, 'new')
  `).bind(
    text,
    type,
    importance
  ).run();

  const id = result.meta?.last_row_id;

  if (id) {
    await db.prepare(`
      INSERT INTO memory_history
        (memory_id, event, details, created)
      VALUES (?, 'created', ?, CURRENT_TIMESTAMP)
    `).bind(
      id,
      `Created as ${type}`
    ).run();
  }

  return id;
}

function buildJudgment(situation, principles, lessons) {
  const principleText = principles
    .map(p => p.text)
    .slice(0, 3);

  const lessonText = lessons
    .map(l => l.text)
    .slice(0, 4);

  let judgment;

  if (
    principleText.some(text =>
      normalize(text).includes("make its own judgment")
    )
  ) {
    judgment = "Aren should form its own judgment";
  } else {
    judgment = "Aren should evaluate the situation using its available principles and experience";
  }
  if (
    conceptMatches(situation).includes("consequences") ||
    normalize(situation).includes("consequence")
  ) {
    judgment += " and examine the decision through its consequences";
  }

  judgment += ".";

  const reasonParts = [];

  if (principleText.length) {
    reasonParts.push("Relevant principles were considered.");
  }

  if (lessonText.length) {
    reasonParts.push("Relevant lessons and reviewed experience were considered.");
  }

  if (!reasonParts.length) {
    reasonParts.push("No sufficiently relevant stored principles or lessons were found.");
  }

  return {
    judgment,
    reason: reasonParts.join(" "),
    principleText,
    lessonText
  };
}

async function handleDecide(db, url) {
  const situation = cleanText(
    url.searchParams.get("situation")
  );

  if (!situation) {
    return textResponse("Missing situation", 400);
  }

  const memories = await getMemories(db);

  const principles = memories
    .filter(m => m.type === "principle")
    .map(m => ({
      ...m,
      score: relevanceScore(situation, m)
    }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score);

  const lessons = memories
    .filter(m => m.type === "lesson")
    .map(m => ({
      ...m,
      score: Number(
        (
          relevanceScore(situation, m) *
          maturityWeight(m.maturity) *
          lessonWeight(m)
        ).toFixed(6)
      )
    }))
    .sort((a, b) => b.score - a.score);

  const selectedPrinciples = principles.slice(0, 5);
  const selectedLessons = lessons.slice(0, 6);

  const result = buildJudgment(
    situation,
    selectedPrinciples,
    selectedLessons
  );

  const totalRelevant =
    selectedPrinciples.length +
    selectedLessons.length;

  const confidence = Math.max(
    1,
    Math.min(
      5,
      Math.round(
        1 +
        Math.min(4, totalRelevant)
      )
    )
  );

  const judgmentInsert = await db.prepare(`
    INSERT INTO judgments
      (situation, judgment, reason, confidence, basis)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    situation,
    result.judgment,
    result.reason,
    confidence,
    JSON.stringify({
      principles: selectedPrinciples,
      lessons: selectedLessons
    })
  ).run();

  const judgmentId = judgmentInsert.meta?.last_row_id;

  return json({
    judgment_id: judgmentId,
    situation,
    judgment: result.judgment,
    reason: result.reason,
    confidence,
    basis: {
      principles: selectedPrinciples,
      lessons: selectedLessons
    },
    review:
      `After the consequence is known, review this judgment using /review.`
  });
}

async function handleReview(db, url) {
  const judgmentId = Number(
    url.searchParams.get("judgment_id")
  );

  const assessment = cleanText(
    url.searchParams.get("assessment")
  ).toLowerCase();

  const outcome = cleanText(
    url.searchParams.get("outcome")
  );

  if (!judgmentId) {
    return textResponse("Missing judgment_id", 400);
  }

  if (!["evidence", "challenge", "neutral"].includes(assessment)) {
    return textResponse(
      "Assessment must be evidence, challenge, or neutral",
      400
    );
  }

  if (!outcome) {
    return textResponse("Missing outcome", 400);
  }

  const judgment = await db.prepare(`
    SELECT *
    FROM judgments
    WHERE id = ?
  `).bind(judgmentId).first();

  if (!judgment) {
    return textResponse("Judgment not found", 404);
  }

  await db.prepare(`
    UPDATE judgments
    SET assessment = ?,
        outcome = ?
    WHERE id = ?
  `).bind(
    assessment,
    outcome,
    judgmentId
  ).run();

  if (assessment === "evidence") {
    return json({
      status: "Judgment reviewed.",
      judgment_id: judgmentId,
      assessment,
      outcome,
      next:
        "Use the consequence as experience. Aren can develop a lesson from it without automatically changing a principle."
    });
  }

  if (assessment === "challenge") {
    return json({
      status: "Judgment reviewed.",
      judgment_id: judgmentId,
      assessment,
      outcome,
      lesson: null,
      development: null
    });
  }

  return json({
    status: "Judgment reviewed.",
    judgment_id: judgmentId,
    assessment,
    outcome,
    next:
      "The experience was recorded without increasing or decreasing support for the judgment."
  });
}

async function handleAutolearn(db) {
  const rows = await db.prepare(`
    SELECT *
    FROM judgments
    WHERE assessment = 'evidence'
      AND lesson_memory_id IS NULL
    ORDER BY id ASC
  `).all();

  const results = [];

  for (const judgment of rows.results || []) {
    const text = buildLessonFromReviewedExperience(judgment);

    const lessonId = await saveMemory(
      db,
      text,
      "lesson",
      5
    );

    if (lessonId) {
      await db.prepare(`
        UPDATE memories
        SET evidence_count = 1,
            maturity = 'tested'
        WHERE id = ?
      `).bind(lessonId).run();

      await db.prepare(`
        UPDATE judgments
        SET lesson_memory_id = ?
        WHERE id = ?
      `).bind(
        lessonId,
        judgment.id
      ).run();

      await db.prepare(`
        INSERT INTO development_cycles
          (trigger, action, target_memory_id, reason, result)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        "reviewed judgment",
        "created_new_lesson",
        lessonId,
        "Evidence from a reviewed judgment was preserved as experience.",
        `Created lesson ${lessonId}`
      ).run();

      results.push({
        judgment_id: judgment.id,
        action: "created_new_lesson",
        memory_id: lessonId,
        evidence_count: 1,
        challenged_count: 0,
        maturity: "tested"
      });
    }
  }

  return json({
    status: "Autonomous development completed.",
    processed: results.length,
    results
  });
}

/*
  SELF-EVALUATION ENGINE

  Aren examines its own stored knowledge and identifies:
  - challenged lessons
  - weak/new lessons
  - lessons with repeated support
  - possible contradictions
  - mature lessons that may deserve principle consideration
  - areas where more evidence is needed

  It does NOT automatically rewrite principles.
*/

async function filterRepeatedDevelopmentTasks(db, tasks) {
  const filtered = [];

  for (const task of tasks) {
    const type = task.type;
    const target = task.target_memory_id || null;
    const related = task.related_memory_id || null;

    const previous = await db.prepare(`
      SELECT *
      FROM development_tasks
      WHERE type = ?
        AND COALESCE(target_memory_id, 0) = COALESCE(?, 0)
        AND COALESCE(related_memory_id, 0) = COALESCE(?, 0)
        AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `).bind(type, target, related).first();

    if (!previous) {
      filtered.push(task);
      continue;
    }

    if (type === "test_lesson" || type === "gather_evidence") {
      /*
        Do not repeatedly retest a lesson just because old reviewed
        judgments remain unlinked. A completed evidence search that found
        nothing should create a pause until genuinely new reviewed experience
        exists.
      */
      /*
        A task that completed with no relevant experience is now waiting.
        It becomes eligible again only when a genuinely newer reviewed
        judgment exists. Use both completed and created as a safe fallback
        because older task rows may have a null completed timestamp.
      */
      let previousResult = {};
      try {
        previousResult = JSON.parse(previous.result || "{}");
      } catch (_) {}

      const noEvidence =
        previousResult?.finding ===
        "No new sufficiently relevant reviewed experience was found.";

      const checkpoint =
        previous.completed ||
        previous.created ||
        "1970-01-01";

      const newExperience = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM judgments
        WHERE assessment IN ('evidence', 'challenge')
          AND created > ?
      `).bind(checkpoint).first();

      if (
        Number(newExperience?.count || 0) > 0 ||
        !noEvidence
      ) {
        filtered.push(task);
      }

      continue;
    }

    if (type === "analyze_evidence") {
      const changed = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM memory_history
        WHERE memory_id = ?
          AND created > COALESCE(?, '1970-01-01')
      `).bind(target, previous.completed).first();

      if (Number(changed?.count || 0) > 0) {
        filtered.push(task);
      }

      continue;
    }

    if (type === "evaluate_principle_candidate") {
      const candidate = await db.prepare(`
        SELECT id
        FROM principle_candidates
        WHERE lesson_id = ?
        LIMIT 1
      `).bind(target).first();

      if (!candidate) {
        filtered.push(task);
      }

      continue;
    }

    if (type === "resolve_tension") {
      const changed = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM memory_history
        WHERE memory_id IN (?, ?)
          AND created > COALESCE(?, '1970-01-01')
      `).bind(target, related, previous.completed).first();

      if (Number(changed?.count || 0) > 0) {
        filtered.push(task);
      }

      continue;
    }

    if (type === "review_principle") {
      const changed = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM memory_history
        WHERE memory_id IN (
          SELECT id
          FROM memories
          WHERE type = 'lesson'
            AND status = 'active'
        )
          AND created > COALESCE(?, '1970-01-01')
      `).bind(previous.completed).first();

      if (Number(changed?.count || 0) > 0) {
        filtered.push(task);
      }

      continue;
    }

    filtered.push(task);
  }

  return filtered;
}

async function handleSelfEvaluate(db) {
  const memories = await getMemories(db);

  const principles = memories.filter(
    m => m.type === "principle"
  );

  const lessons = memories.filter(
    m => m.type === "lesson"
  );

  const observations = [];
  const developmentTasks = [];

  // 1. Find challenged lessons.
  for (const lesson of lessons) {
    const challenged = Number(
      lesson.challenged_count || 0
    );

    const evidence = Number(
      lesson.evidence_count || 0
    );

    if (challenged > 0) {
      observations.push({
        type: "challenged_lesson",
        memory_id: lesson.id,
        text: lesson.text,
        evidence_count: evidence,
        challenged_count: challenged,
        maturity: lesson.maturity,
        finding:
          "This lesson has been challenged and should be tested further."
      });

      developmentTasks.push({
        priority: challenged >= evidence ? 1 : 2,
        type: "test_lesson",
        target_memory_id: lesson.id,
        task:
          `Test the lesson "${lesson.text}" against new experience.`,
        reason:
          "The lesson has unresolved challenges."
      });
    }
  }

  // 1b. Analyze lessons where support and challenge both exist.
  for (const lesson of lessons) {
    const evidence = Number(lesson.evidence_count || 0);
    const challenged = Number(lesson.challenged_count || 0);

    if (evidence > 0 && challenged > 0) {
      observations.push({
        type: "mixed_evidence",
        memory_id: lesson.id,
        text: lesson.text,
        evidence_count: evidence,
        challenged_count: challenged,
        finding:
          "This lesson contains both support and challenge. Aren should compare the reviewed outcomes instead of relying only on counts."
      });

      developmentTasks.push({
        priority: 1,
        type: "analyze_evidence",
        target_memory_id: lesson.id,
        task:
          `Compare supporting and challenging experience for lesson ${lesson.id}.`,
        reason:
          "The lesson contains mixed evidence and requires comparison."
      });
    }
  }

  // 2. Find new lessons with little evidence.
  for (const lesson of lessons) {
    const evidence = Number(
      lesson.evidence_count || 0
    );

    const challenged = Number(
      lesson.challenged_count || 0
    );

    if (
      lesson.maturity === "new" &&
      evidence === 0 &&
      challenged === 0
    ) {
      observations.push({
        type: "weak_lesson",
        memory_id: lesson.id,
        text: lesson.text,
        finding:
          "This lesson has not yet been tested by reviewed experience."
      });

      developmentTasks.push({
        priority: 3,
        type: "gather_evidence",        target_memory_id: lesson.id,
        task:
          `Seek evidence for the lesson "${lesson.text}".`,
        reason:
          "The lesson has not yet been tested."
      });
    }
  }

  // 3. Find strongly supported lessons.
  for (const lesson of lessons) {
    const evidence = Number(
      lesson.evidence_count || 0
    );

    const challenged = Number(
      lesson.challenged_count || 0
    );

    if (
      evidence >= 3 &&
      challenged === 0
    ) {
      observations.push({
        type: "strong_lesson",
        memory_id: lesson.id,
        text: lesson.text,
        evidence_count: evidence,
        challenged_count: challenged,
        maturity: lesson.maturity,
        finding:
          "This lesson has repeated supporting evidence without recorded challenges."
      });

      developmentTasks.push({
        priority: 2,
        type: "evaluate_principle_candidate",
        target_memory_id: lesson.id,
        task:
          `Evaluate whether "${lesson.text}" is strong enough to become a principle candidate.`,
        reason:
          "The lesson has accumulated repeated evidence."
      });
    }
  }

  // 4. Search for possible contradictions between lessons.
  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const A = lessons[i];
      const B = lessons[j];

      const overlap = wordOverlap(
        A.text,
        B.text
      );

      const concepts = conceptScore(
        A.text,
        B.text
      );

      const combined = Math.max(
        overlap,
        concepts
      );

      const Anegative = normalize(A.text).includes("not");
      const Bnegative = normalize(B.text).includes("not");

      if (
        combined >= 0.45 &&
        Anegative !== Bnegative
      ) {
        observations.push({
          type: "possible_contradiction",
          memory_ids: [A.id, B.id],
          lessons: [A.text, B.text],
          finding:
            "These lessons appear related and may contain opposing conditions. They require examination rather than automatic resolution."
        });

        developmentTasks.push({
          priority: 1,
          type: "resolve_tension",
          target_memory_id: A.id,
          related_memory_id: B.id,
          task:
            `Examine the relationship between lesson ${A.id} and lesson ${B.id}.`,
          reason:
            "Possible contradiction or conflicting condition detected."
        });
      }
    }
  }

  // 5. Examine principles against lessons.
  for (const principle of principles) {
    const related = lessons
      .map(lesson => ({
        lesson,
        score: Math.max(
          wordOverlap(principle.text, lesson.text),
          conceptScore(principle.text, lesson.text)
        )
      }))
      .filter(x => x.score >= 0.35)
      .sort((a, b) => b.score - a.score);

    if (related.length) {
      observations.push({
        type: "principle_review",
        principle_id: principle.id,
        principle: principle.text,
        related_lessons: related.slice(0, 5).map(
          x => ({
            id: x.lesson.id,
            text: x.lesson.text,
            maturity: x.lesson.maturity,
            evidence_count: x.lesson.evidence_count,
            challenged_count: x.lesson.challenged_count
          })
        ),
        finding:
          "The principle has related experience that should be considered when evaluating whether the principle remains justified."
      });

      developmentTasks.push({
        priority: 2,
        type: "review_principle",
        target_memory_id: principle.id,
        task:
          `Review whether the principle "${principle.text}" remains justified in light of related experience.`,
        reason:
          "Related lessons have accumulated around the principle."
      });
    }
  }

  developmentTasks.sort(
    (a, b) => a.priority - b.priority
  );

  // Do not repeat completed work unless a new condition or new experience exists.
  const actionableTasks = await filterRepeatedDevelopmentTasks(
    db,
    developmentTasks
  );

  // Keep the cycle in persistent memory.
  const cycleResult = await db.prepare(`
    INSERT INTO development_cycles
      (trigger, action, reason, result, status)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    "self_evaluation",
    "evaluated_own_knowledge",
    "Aren inspected principles, lessons, evidence, challenges and possible tensions.",
    JSON.stringify({
      observations,
      developmentTasks: actionableTasks
    }),
    "completed"
  ).run();

  return json({
    status: "Self-evaluation completed.",
    cycle_id: cycleResult.meta?.last_row_id || null,
    summary: {
      principles_examined: principles.length,
      lessons_examined: lessons.length,
      observations: observations.length,
      development_tasks: developmentTasks.length
    },
    observations,
    next_development_tasks: actionableTasks.slice(0, 10)
  });
}

async function handleEvaluateLessons(db) {
  const memories = await getMemories(db);

  const lessons = memories.filter(
    m => m.type === "lesson"
  );

  const results = [];

  for (const lesson of lessons) {
    const evidence = Number(
      lesson.evidence_count || 0
    );

    const challenged = Number(
      lesson.challenged_count || 0
    );

    let maturity = "new";

    if (challenged >= 2 && challenged > evidence) {
      maturity = "questioned";
    } else if (evidence >= 3 && challenged === 0) {
      maturity = "mature";
    } else if (evidence >= 1) {
      maturity = "tested";
    }

    if (challenged >= 2 && challenged >= evidence) {
      maturity = "questioned";
    }

    await db.prepare(`
      UPDATE memories
      SET maturity = ?
      WHERE id = ?
    `).bind(
      maturity,
      lesson.id
    ).run();

    results.push({
      id: lesson.id,
      text: lesson.text,
      evidence_count: evidence,
      challenged_count: challenged,
      maturity
    });
  }

  return json({
    status: "Lesson evaluation completed.",
    results
  });
}

async function handlePrincipleCandidates(db) {
  const lessons = await db.prepare(`
    SELECT *
    FROM memories
    WHERE type = 'lesson'
      AND status = 'active'
      AND COALESCE(evidence_count, 0) >= 3
      AND COALESCE(challenged_count, 0) = 0
      AND COALESCE(maturity, 'new') = 'mature'
    ORDER BY evidence_count DESC
  `).all();

  const candidates = [];

  for (const lesson of lessons.results || []) {
    const existing = await db.prepare(`
      SELECT id
      FROM principle_candidates
      WHERE lesson_id = ?
    `).bind(lesson.id).first();

    if (!existing) {
      const reason =
        `Lesson has reached mature status. Evidence count: ${lesson.evidence_count}. Challenge count: ${lesson.challenged_count}. The lesson may be considered as a principle candidate, but it must not automatically replace or alter an existing principle. A stronger basis is required.`;

      const result = await db.prepare(`
        INSERT INTO principle_candidates
          (lesson_id, candidate_text, reason, status)
        VALUES (?, ?, ?, 'candidate')
      `).bind(
        lesson.id,
        lesson.text,
        reason
      ).run();

      candidates.push({
        id: result.meta?.last_row_id || null,
        lesson_id: lesson.id,
        candidate_text: lesson.text,
        reason
      });
    }
  }

  return json({
    status: "Principle candidate evaluation completed.",
    candidates
  });
}


function analyzeReviewOutcome(lesson, judgment) {
  const source = [
    judgment.situation,
    judgment.judgment,
    judgment.outcome
  ].filter(Boolean).join(" ");

  const relevance = relevanceScore(source, lesson);

  const outcomeConcepts = conceptMatches(
    String(judgment.outcome || "")
  );

  const lessonConcepts = new Set(
    conceptMatches(lesson.text)
  );

  let conceptMatchesCount = 0;
  for (const concept of outcomeConcepts) {
    if (lessonConcepts.has(concept)) {
      conceptMatchesCount++;
    }
  }

  const conceptRelevance =
    lessonConcepts.size && outcomeConcepts.length
      ? conceptMatchesCount /
        Math.max(lessonConcepts.size, outcomeConcepts.length)
      : 0;

  const strength = Number(
    Math.min(
      1,
      relevance * 0.7 + conceptRelevance * 0.3
    ).toFixed(6)
  );

  const conclusion =
    judgment.assessment === "evidence"
      ? "The reviewed outcome provides support for the lesson in this situation."
      : judgment.assessment === "challenge"
        ? "The reviewed outcome provides a challenge to the lesson in this situation."
        : "The reviewed outcome does not materially support or challenge the lesson.";

  return {
    relevance: Number(relevance.toFixed(6)),
    strength,
    conclusion
  };
}

async function backfillLessonEvaluations(db) {
  const rows = await db.prepare(`
    SELECT
      l.lesson_id,
      j.id AS judgment_id,
      j.situation,
      j.judgment,
      j.assessment,
      j.outcome
    FROM development_test_links l
    INNER JOIN judgments j
      ON j.id = l.judgment_id
    WHERE j.assessment IN ('evidence', 'challenge')
  `).all();

  let created = 0;

  for (const row of rows.results || []) {
    const lesson = await getMemoryById(db, row.lesson_id);
    if (!lesson) continue;

    const analysis = analyzeReviewOutcome(lesson, row);

    const result = await db.prepare(`
      INSERT OR IGNORE INTO lesson_evaluations
        (lesson_id, judgment_id, assessment, outcome, relevance, strength, conclusion)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      row.lesson_id,
      row.judgment_id,
      row.assessment,
      row.outcome || "",
      analysis.relevance,
      analysis.strength,
      analysis.conclusion
    ).run();

    if (result.meta?.changes) {
      created += Number(result.meta.changes);
    }
  }

  return created;
}

async function analyzeLessonEvidence(db, lessonId) {
  const lesson = await getMemoryById(db, lessonId);

  if (!lesson || lesson.type !== "lesson") {
    return {
      status: "skipped",
      reason: "Lesson not found."
    };
  }

  const rows = await db.prepare(`
    SELECT
      j.id,
      j.situation,
      j.judgment,
      j.assessment,
      j.outcome
    FROM development_test_links l
    INNER JOIN judgments j
      ON j.id = l.judgment_id
    WHERE l.lesson_id = ?
      AND j.assessment IN ('evidence', 'challenge')
    ORDER BY j.id ASC
  `).bind(lessonId).all();

  const standaloneChallenges = await db.prepare(`
    SELECT id, situation, outcome, strength
    FROM lesson_challenges
    WHERE lesson_id = ?
    ORDER BY id ASC
  `).bind(lessonId).all();

  let support = 0;
  let challenge = 0;

  for (const row of rows.results || []) {
    const analysis = analyzeReviewOutcome(lesson, row);

    if (row.assessment === "evidence") {
      support += analysis.strength;
    } else if (row.assessment === "challenge") {
      challenge += analysis.strength;
    }

    await db.prepare(`
      INSERT OR IGNORE INTO lesson_evaluations
        (lesson_id, judgment_id, assessment, outcome, relevance, strength, conclusion)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      lessonId,
      row.id,
      row.assessment,
      row.outcome || "",
      analysis.relevance,
      analysis.strength,
      analysis.conclusion
    ).run();
  }

  for (const row of standaloneChallenges.results || []) {
    challenge += Number(row.strength || 0);
  }

  support = Number(support.toFixed(6));
  challenge = Number(challenge.toFixed(6));

  const analyzedExperiences =
    (rows.results?.length || 0) +
    (standaloneChallenges.results?.length || 0);

  let conclusion;

  if (!analyzedExperiences) {
    conclusion = "No analyzed evidence or challenges are available yet.";
  } else if (support > challenge * 1.15) {
    conclusion =
      "Support currently outweighs challenge. The lesson remains supported, but future challenges should still be examined.";
  } else if (challenge > support * 1.15) {
    conclusion =
      "Challenge currently outweighs support. The lesson should be treated as questioned until further experience clarifies it.";
  } else {
    conclusion =
      "Support and challenge are materially mixed. The lesson should be refined by examining the conditions in which each outcome occurred.";
  }

  await db.prepare(`
    INSERT INTO memory_history
      (memory_id, event, details, created)
    VALUES (?, 'lesson_analysis', ?, CURRENT_TIMESTAMP)
  `).bind(
    lessonId,
    JSON.stringify({
      support_weight: support,
      challenge_weight: challenge,
      conclusion
    })
  ).run();

  return {
    status: "completed",
    lesson_id: lessonId,
    analyzed_experiences: (rows.results?.length || 0) + (standaloneChallenges.results?.length || 0),
    support_weight: support,
    challenge_weight: challenge,
    conclusion
  };
}

async function executeTestLesson(db, task) {
  const lesson = await getMemoryById(db, task.target_memory_id);
  if (!lesson || lesson.type !== "lesson") {
    return { status: "skipped", reason: "Lesson not found." };
  }

  const rows = await db.prepare(`
    SELECT j.id, j.situation, j.judgment, j.assessment, j.outcome
    FROM judgments j
    LEFT JOIN development_test_links l      ON l.lesson_id = ?
      AND l.judgment_id = j.id
    WHERE j.assessment IN ('evidence', 'challenge')
      AND l.id IS NULL
    ORDER BY j.id ASC
  `).bind(lesson.id).all();

  let evidenceAdded = 0;
  let challengesAdded = 0;
  let experiencesExamined = 0;

  for (const judgment of rows.results || []) {
    const source =
      String(judgment.situation || "") +
      " " +
      String(judgment.judgment || "");

    if (relevanceScore(source, lesson) >= 0.35) {
      experiencesExamined++;

      if (judgment.assessment === "evidence") {
        evidenceAdded++;
      }

      if (judgment.assessment === "challenge") {
        challengesAdded++;
      }

      await db.prepare(`
        INSERT OR IGNORE INTO development_test_links
          (lesson_id, judgment_id)
        VALUES (?, ?)
      `).bind(
        lesson.id,
        judgment.id
      ).run();

      const analysis = analyzeReviewOutcome(lesson, judgment);

      await db.prepare(`
        INSERT OR REPLACE INTO lesson_evaluations
          (lesson_id, judgment_id, assessment, outcome, relevance, strength, conclusion)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        lesson.id,
        judgment.id,
        judgment.assessment,
        judgment.outcome || "",
        analysis.relevance,
        analysis.strength,
        analysis.conclusion
      ).run();
    }
  }

  if (evidenceAdded || challengesAdded) {
    const current = await getMemoryById(db, lesson.id);
    const evidence =
      Number(current.evidence_count || 0) +
      evidenceAdded;

    const challenged =
      Number(current.challenged_count || 0) +
      challengesAdded;

    let maturity = current.maturity || "new";

    if (
      challenged >= 2 &&
      challenged >= evidence
    ) {
      maturity = "questioned";
    } else if (
      evidence >= 3 &&
      challenged === 0
    ) {
      maturity = "mature";
    } else if (evidence >= 1) {
      maturity = "tested";
    }

    await db.prepare(`
      UPDATE memories
      SET evidence_count = ?,
          challenged_count = ?,
          maturity = ?
      WHERE id = ?
    `).bind(
      evidence,
      challenged,
      maturity,
      lesson.id
    ).run();

    await db.prepare(`
      INSERT INTO memory_history
        (memory_id, event, details)
      VALUES (?, 'development_test', ?)
    `).bind(
      lesson.id,
      "Autonomous test examined " +
      experiencesExamined +
      " new reviewed experiences and added " +
      evidenceAdded +
      " evidence and " +
      challengesAdded +
      " challenges."
    ).run();

    return {
      status: "completed",
      memory_id: lesson.id,
      experiences_examined: experiencesExamined,
      evidence_added: evidenceAdded,
      challenges_added: challengesAdded,
      evidence_count: evidence,
      challenged_count: challenged,
      maturity
    };
  }

  return {
    status: "completed",
    memory_id: lesson.id,
    experiences_examined: experiencesExamined,
    evidence_added: 0,
    challenges_added: 0,
    finding:
      "No new sufficiently relevant reviewed experience was found."
  };
}

async function executeGatherEvidence(db, task) {
  return executeTestLesson(db, task);
}

async function executeResolveTension(db, task) {
  const a = await getMemoryById(db, task.target_memory_id);
  const b = await getMemoryById(db, task.related_memory_id);

  if (!a || !b) {
    return { status: "skipped", reason: "One or both lessons were not found." };
  }

  const similarity = Number(
    Math.max(wordOverlap(a.text, b.text), conceptScore(a.text, b.text)).toFixed(6)
  );
  const opposite =
    normalize(a.text).includes("not") !== normalize(b.text).includes("not");

  const finding =
    similarity >= 0.45 && opposite
      ? "Potential tension confirmed; both lessons remain unchanged."
      : "No strong contradiction was confirmed by the current comparison.";

  for (const item of [
    [a.id, "Compared with lesson " + b.id + ". Similarity " + similarity + ". " + finding],
    [b.id, "Compared with lesson " + a.id + ". Similarity " + similarity + ". " + finding]
  ]) {
    await db.prepare(`
      INSERT INTO memory_history (memory_id, event, details)
      VALUES (?, 'tension_review', ?)
    `).bind(item[0], item[1]).run();
  }

  return {
    status: "completed",
    memory_ids: [a.id, b.id],
    similarity,
    finding
  };
}

async function executePrincipleCandidate(db, task) {
  const lesson = await getMemoryById(db, task.target_memory_id);

  if (!lesson || lesson.type !== "lesson") {
    return { status: "skipped", reason: "Lesson not found." };
  }

  if (
    Number(lesson.evidence_count || 0) < 3 ||
    Number(lesson.challenged_count || 0) !== 0 ||
    lesson.maturity !== "mature"
  ) {
    return { status: "skipped", reason: "Lesson does not meet candidate requirements." };
  }

  const existing = await db.prepare(`
    SELECT id FROM principle_candidates WHERE lesson_id = ?
  `).bind(lesson.id).first();

  if (existing) {
    return { status: "completed", candidate_id: existing.id, created: false };
  }

  const reason =
    "Mature lesson with repeated supporting evidence and no recorded challenges. Candidate only; no principle was changed.";

  const result = await db.prepare(`
    INSERT INTO principle_candidates
      (lesson_id, candidate_text, reason, status)
    VALUES (?, ?, ?, 'candidate')
  `).bind(lesson.id, lesson.text, reason).run();

  return {
    status: "completed",
    candidate_id: result.meta?.last_row_id || null,
    lesson_id: lesson.id,
    created: true,
    principle_changed: false
  };
}

async function executePrincipleReview(db, task) {
  const principle = await getMemoryById(db, task.target_memory_id);

  if (!principle || principle.type !== "principle") {
    return { status: "skipped", reason: "Principle not found." };
  }

  const lessons = (await getMemories(db))
    .filter(m => m.type === "lesson")
    .map(m => ({ ...m, score: relevanceScore(principle.text, m) }))
    .filter(m => m.score >= 0.30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const finding = lessons.length
    ? "Reviewed " + lessons.length + " related lessons. Principle remains unchanged."
    : "No sufficiently related lessons were found. Principle remains unchanged.";

  await db.prepare(`
    INSERT INTO development_cycles
      (trigger, action, target_memory_id, reason, result, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    "autonomous_development",
    "review_principle",
    principle.id,
    "Review principle against related experience.",
    JSON.stringify({ principle: principle.text, related_lessons: lessons, finding }),
    "completed"
  ).run();

  return {
    status: "completed",
    principle_id: principle.id,
    related_lessons: lessons.map(l => l.id),
    finding,
    principle_changed: false
  };
}

async function executeDevelopmentTask(db, task) {
  switch (task.type) {
    case "test_lesson":
    case "gather_evidence":
      return executeTestLesson(db, task);
    case "analyze_evidence":
      await backfillLessonEvaluations(db);
      return analyzeLessonEvidence(db, task.target_memory_id);
    case "resolve_tension":
      return executeResolveTension(db, task);
    case "evaluate_principle_candidate":
      return executePrincipleCandidate(db, task);
    case "review_principle":
      return executePrincipleReview(db, task);
    default:
      return { status: "skipped", reason: "Unknown task type: " + task.type };
  }
}

async function handleExecuteDevelopment(db) {
  const evaluationResponse = await handleSelfEvaluate(db);
  const evaluation = await evaluationResponse.json();
  const tasks = evaluation.next_development_tasks || [];
  const cycleId = evaluation.cycle_id || null;
  const executed = [];

  for (const task of tasks) {
    const insert = await db.prepare(`
      INSERT INTO development_tasks
        (cycle_id, priority, type, target_memory_id, related_memory_id, task, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
    `).bind(
      cycleId,
      Number(task.priority || 3),
      task.type,
      task.target_memory_id || null,
      task.related_memory_id || null,
      task.task || "",
      task.reason || ""
    ).run();

    const taskId = insert.meta?.last_row_id || null;
    let result;

    try {
      result = await executeDevelopmentTask(db, task);
      await db.prepare(`
        UPDATE development_tasks
        SET status = ?, result = ?, completed = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        result.status === "completed" ? "completed" : "skipped",
        JSON.stringify(result),
        taskId
      ).run();
    } catch (error) {
      result = {
        status: "failed",
        error: String(error?.message || error)
      };

      await db.prepare(`
        UPDATE development_tasks
        SET status = 'failed', result = ?, completed = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(JSON.stringify(result), taskId).run();
    }

    executed.push({ task_id: taskId, task, result });
  }

  await db.prepare(`
    INSERT INTO development_cycles
      (trigger, action, reason, result, status)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    "self_evaluation",
    "execute_development_tasks",
    "Aren executed its highest-priority self-evaluation tasks.",
    JSON.stringify({
      cycle_id: cycleId,
      tasks_found: tasks.length,
      tasks_executed: executed.length
    }),
    "completed"
  ).run();

  return json({
    status: "Autonomous development executed.",
    cycle_id: cycleId,
    tasks_found: tasks.length,
    tasks_executed: executed.length,
    executed,
    principle_changes: 0,
    rule: "Principles are never changed automatically by the development executor."
  });
}

/*
  AUTONOMOUS DEVELOPMENT CYCLE

  One complete cycle:
  1. Convert reviewed evidence into lessons.
  2. Re-evaluate lesson maturity.
  3. Inspect Aren's own knowledge.
  4. Select and execute development tasks.
  5. Preserve every result in persistent memory.

  Principles are protected: this cycle can create lessons and
  principle candidates, but it never changes an existing principle.
*/

/*
  SELF-DIRECTED RESEARCH PLANNER

  Creates a persistent research question when a lesson is untested,
  challenged, or has mixed evidence. It plans questions only; it does
  not invent findings, treat fetched text as verified, or alter principles.
*/
async function handleSelfDirectedResearch(db) {
  const lessons = (await getMemories(db)).filter(memory =>
    memory.type === "lesson" &&
    (
      Number(memory.evidence_count || 0) === 0 ||
      Number(memory.challenged_count || 0) > 0
    )
  );

  const planned = [];
  const skipped = [];

  for (const lesson of lessons) {
    const existing = await db.prepare(`
      SELECT id, status
      FROM research
      WHERE target_memory_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(lesson.id).first();

    if (existing) {
      skipped.push({
        lesson_id: lesson.id,
        research_id: existing.id,
        reason: "A research question is already recorded for this lesson."
      });
      continue;
    }

    const evidenceCount = Number(lesson.evidence_count || 0);
    const challengedCount = Number(lesson.challenged_count || 0);
    let question;

    if (evidenceCount > 0 && challengedCount > 0) {
      question = `Compare the supporting and challenging reviewed experiences for this lesson: "${lesson.text}". Identify the conditions that may explain the different outcomes.`;
    } else if (challengedCount > 0) {
      question = `What reliable evidence supports or challenges this lesson: "${lesson.text}"? Examine the conditions and limits of the lesson.`;
    } else {
      question = `What reliable evidence supports or challenges this untested lesson: "${lesson.text}"?`;
    }

    const inserted = await db.prepare(`
      INSERT INTO research (question, status, target_memory_id, research_kind)
      VALUES (?, 'planned', ?, 'self_directed')
    `).bind(question, lesson.id).run();

    const researchId = inserted.meta?.last_row_id || null;
    planned.push({
      research_id: researchId,
      lesson_id: lesson.id,
      question,
      status: "planned",
      note: "Question generated from stored knowledge. Sources and findings still require evaluation."
    });
  }

  const cycle = await db.prepare(`
    INSERT INTO development_cycles
      (trigger, action, reason, result, status)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    "self_evaluation",
    "plan_self_directed_research",
    "Aren identified untested or challenged lessons that need more evidence.",
    JSON.stringify({ planned, skipped }),
    "completed"
  ).run();

  return json({
    status: "Self-directed research planning completed.",
    cycle_id: cycle.meta?.last_row_id || null,
    lessons_considered: lessons.length,
    questions_created: planned.length,
    planned,
    skipped,
    rule: "Planning a question does not establish a fact or change a principle."
  });
}

async function handleAutonomousCycle(db) {
  const cycleStarted = new Date().toISOString();

  const learningResponse = await handleAutolearn(db);
  const learning = await learningResponse.json();

  const lessonResponse = await handleEvaluateLessons(db);
  const lessonEvaluation = await lessonResponse.json();

  const researchResponse = await handleSelfDirectedResearch(db);
  const selfDirectedResearch = await researchResponse.json();

  const researchDiscovery = await handleAutonomousResearchDiscovery(db);
  const researchReview = await handleAutonomousResearchReview(db);

  const developmentResponse = await handleExecuteDevelopment(db);
  const development = await developmentResponse.json();

  const result = {
    cycle_started: cycleStarted,
    learning,
    lesson_evaluation: lessonEvaluation,
    self_directed_research: selfDirectedResearch,
    research_discovery: researchDiscovery,
    research_review: researchReview,
    development
  };

  await db.prepare(`
    INSERT INTO development_cycles
      (trigger, action, reason, result, status)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    "autonomous_cycle",
    "learn_evaluate_develop",
    "Aren completed a full autonomous learning and development loop.",
    JSON.stringify(result),
    "completed"
  ).run();

  return json({
    status: "Autonomous cycle completed.",
    cycle: result,
    principle_changes: 0,
    rule: "Principles are never changed automatically by the development executor."
  });
}

async function handleDevelopment(db) {
  const result = await db.prepare(`
    SELECT *
    FROM development_cycles
    ORDER BY id DESC
    LIMIT 20
  `).all();

  return json(
    result.results || []
  );
}

async function handleThink(db, url) {
  const situation = cleanText(
    url.searchParams.get("situation")
  );

  if (!situation) {
    return textResponse("Missing situation", 400);
  }

  const memories = await getMemories(db);

  const relevant = memories
    .map(memory => ({
      ...memory,
      score: relevanceScore(situation, memory)
    }))
    .filter(memory => memory.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return json({
    situation,
    thinking_context: relevant
  });
}

async function handleJudgment(db, url) {
  const id = Number(
    url.searchParams.get("id") ||
    url.searchParams.get("judgment_id")
  );

  if (!id) {
    return textResponse("Missing judgment_id", 400);
  }

  const judgment = await db.prepare(`
    SELECT *
    FROM judgments
    WHERE id = ?
  `).bind(id).first();

  if (!judgment) {
    return textResponse("Judgment not found", 404);
  }

  return json(judgment);
}

async function handleJudgments(db) {
  const result = await db.prepare(`
    SELECT *
    FROM judgments
    ORDER BY id DESC
    LIMIT 100
  `).all();

  return json(
    result.results || []
  );
}

async function handleMemoryType(db, url) {
  const type = cleanText(
    url.searchParams.get("type")
  );

  if (!type) {
    return textResponse("Missing type", 400);
  }

  const result = await db.prepare(`
    SELECT
      id,
      text,
      type,
      importance,
      status,
      saved,
      COALESCE(evidence_count, 0) AS evidence_count,
      COALESCE(challenged_count, 0) AS challenged_count,
      COALESCE(maturity, 'new') AS maturity
    FROM memories
    WHERE type = ?
      AND status = 'active'
    ORDER BY id ASC
  `).bind(type).all();

  return json(
    result.results || []
  );
}

async function handleRemember(db, url) {
  const text = cleanText(
    url.searchParams.get("text")
  );

  const type = cleanText(
    url.searchParams.get("type"),
    "memory"
  );

  const importance = Number(
    url.searchParams.get("importance") || 5
  );

  if (!text) {
    return textResponse("Missing text", 400);
  }

  const id = await saveMemory(
    db,
    text,
    type,
    importance
  );
  return json({
    status: "Memory saved",
    id,
    text,
    type,
    importance
  });
}

async function handleMemoryHistory(db, url) {
  const memoryId = Number(
    url.searchParams.get("memory_id")
  );

  if (!memoryId) {
    return textResponse("Missing memory_id", 400);
  }
  const result = await db.prepare(`
    SELECT *
    FROM memory_history
    WHERE memory_id = ?
    ORDER BY id ASC
  `).bind(memoryId).all();

  return json(
    result.results || []
  );
}

async function handleEvidence(db, url) {
  const memoryId = Number(
    url.searchParams.get("memory_id")
  );

  if (!memoryId) {
    return textResponse("Missing memory_id", 400);
  }

  const memory = await getMemoryById(db, memoryId);

  if (!memory) {
    return textResponse("Memory not found", 404);
  }

  const evidence =
    Number(memory.evidence_count || 0) + 1;

  let maturity = memory.maturity;

  if (evidence >= 3) {
    maturity = "mature";
  } else if (evidence >= 1) {
    maturity = "tested";
  }

  await db.prepare(`
    UPDATE memories
    SET evidence_count = ?,
        maturity = ?
    WHERE id = ?
  `).bind(
    evidence,
    maturity,
    memoryId
  ).run();

  await db.prepare(`
    INSERT INTO memory_history
      (memory_id, event, details, created)
    VALUES (?, 'evidence', ?, CURRENT_TIMESTAMP)
  `).bind(
    memoryId,
    `Evidence count increased to ${evidence}`
  ).run();

  return json({
    status: "Evidence recorded.",
    memory_id: memoryId,
    evidence_count: evidence,
    challenged_count: memory.challenged_count,
    maturity
  });
}

async function handleChallenge(db, url) {
  const memoryId = Number(url.searchParams.get("memory_id"));
  const situation = cleanText(url.searchParams.get("situation"));
  const outcome = cleanText(url.searchParams.get("outcome"));

  if (!memoryId) {
    return textResponse("Missing memory_id", 400);
  }

  const memory = await getMemoryById(db, memoryId);
  if (!memory) {
    return textResponse("Memory not found", 404);
  }

  if (!situation || !outcome) {
    return textResponse(
      "Challenge now requires situation and outcome so Aren can analyze the experience.",
      400
    );
  }

  const analysis = analyzeReviewOutcome(
    memory,
    {
      situation,
      judgment: "",
      outcome,
      assessment: "challenge"
    }
  );

  await db.prepare(`
    INSERT INTO lesson_challenges
      (lesson_id, situation, outcome, relevance, strength)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    memoryId,
    situation,
    outcome,
    analysis.relevance,
    analysis.strength
  ).run();

  const challenged =
    Number(memory.challenged_count || 0) + 1;

  const evidence =
    Number(memory.evidence_count || 0);

  let maturity = memory.maturity;
  if (challenged >= 2 && challenged >= evidence) {
    maturity = "questioned";
  } else if (evidence >= 3 && challenged === 0) {
    maturity = "mature";
  } else if (evidence >= 1) {
    maturity = "tested";
  }

  await db.prepare(`
    UPDATE memories
    SET challenged_count = ?, maturity = ?
    WHERE id = ?
  `).bind(challenged, maturity, memoryId).run();

  await db.prepare(`
    INSERT INTO memory_history
      (memory_id, event, details, created)
    VALUES (?, 'challenge', ?, CURRENT_TIMESTAMP)
  `).bind(
    memoryId,
    JSON.stringify({
      situation,
      outcome,
      relevance: analysis.relevance,
      strength: analysis.strength,
      challenged_count: challenged
    })
  ).run();

  return json({
    status: "Challenge recorded and analyzed.",
    memory_id: memoryId,
    evidence_count: evidence,
    challenged_count: challenged,
    maturity,
    relevance: analysis.relevance,
    strength: analysis.strength
  });
}

async function handleResearch(db, url) {
  const question = cleanText(
    url.searchParams.get("question")
  );

  if (!question) {
    return textResponse("Missing question", 400);
  }

  const result = await db.prepare(`
    INSERT INTO research
      (question, status)
    VALUES (?, 'new')
  `).bind(question).run();

  return json({
    status: "Research question created.",
    research_id: result.meta?.last_row_id || null,
    question
  });
}

async function handleResearchClaim(db, url) {
  const researchId = Number(
    url.searchParams.get("research_id")
  );

  const claim = cleanText(
    url.searchParams.get("claim")
  );

  const evidence = cleanText(
    url.searchParams.get("evidence")
  );

  const confidence = Number(
    url.searchParams.get("confidence") || 1
  );

  if (!researchId || !claim) {
    return textResponse(
      "Missing research_id or claim",
      400
    );
  }

  const result = await db.prepare(`
    INSERT INTO research_claims
      (research_id, claim, evidence, confidence)
    VALUES (?, ?, ?, ?)
  `).bind(
    researchId,
    claim,
    evidence,
    confidence
  ).run();

  return json({
    status: "Research claim saved.",
    id: result.meta?.last_row_id || null
  });
}

async function handleResearchConclusion(db, url) {
  const researchId = Number(
    url.searchParams.get("research_id")
  );

  const conclusion = cleanText(
    url.searchParams.get("conclusion")
  );

  const confidence = Number(
    url.searchParams.get("confidence") || 1
  );

  if (!researchId || !conclusion) {
    return textResponse(
      "Missing research_id or conclusion",
      400
    );
  }

  const result = await db.prepare(`
    INSERT INTO research_conclusions
      (research_id, conclusion, confidence)
    VALUES (?, ?, ?)
  `).bind(
    researchId,
    conclusion,
    confidence
  ).run();

  await db.prepare(`
    UPDATE research
    SET answer = ?,
        status = 'completed'
    WHERE id = ?
  `).bind(
    conclusion,
    researchId
  ).run();

  return json({
    status: "Research conclusion saved.",
    id: result.meta?.last_row_id || null
  });
}

async function handleResearchEvidence(db, url) {
  const researchId = Number(url.searchParams.get("research_id"));
  const claimId = Number(url.searchParams.get("claim_id"));
  const lessonId = Number(url.searchParams.get("lesson_id"));
  const evidence = cleanText(url.searchParams.get("evidence"));
  const assessment = cleanText(url.searchParams.get("assessment")).toLowerCase();
  const confidence = Math.max(1, Math.min(5, Number(url.searchParams.get("confidence") || 1)));

  if (!researchId || !claimId || !lessonId || !evidence) {
    return textResponse(
      "Missing research_id, claim_id, lesson_id, or evidence",
      400
    );
  }

  if (!["evidence", "challenge", "neutral"].includes(assessment)) {
    return textResponse(
      "Assessment must be evidence, challenge, or neutral",
      400
    );
  }

  const research = await db.prepare(
    "SELECT id, question, source, status FROM research WHERE id = ?"
  ).bind(researchId).first();

  if (!research) {
    return textResponse("Research not found", 404);
  }

  const claim = await db.prepare(
    "SELECT id, research_id, claim, evidence, confidence FROM research_claims WHERE id = ?"
  ).bind(claimId).first();

  if (!claim || Number(claim.research_id) !== researchId) {
    return textResponse("Research claim not found for this research", 404);
  }

  const lesson = await getMemoryById(db, lessonId);

  if (!lesson || lesson.type !== "lesson") {
    return textResponse("Lesson not found", 404);
  }

  const relevance = relevanceScore(
    cleanText(claim.claim + " " + evidence),
    lesson
  );

  if (relevance < 0.30) {
    return json({
      status: "Research evidence rejected.",
      reason: "The claim/evidence is not sufficiently relevant to the selected lesson.",
      relevance
    }, 422);
  }

  const assessmentWeight =
    assessment === "evidence" ? 1 :
    assessment === "challenge" ? 1 : 0;

  const strength = Number(
    Math.min(
      1,
      relevance *
      (0.5 + confidence * 0.1) *
      assessmentWeight
    ).toFixed(6)
  );

  const inserted = await db.prepare(`
    INSERT INTO research_evidence
      (research_id, claim_id, lesson_id, evidence, assessment, relevance, strength, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    researchId,
    claimId,
    lessonId,
    evidence,
    assessment,
    relevance,
    strength,
    confidence
  ).run();

  if (assessment !== "neutral") {
    const current = await getMemoryById(db, lessonId);
    const evidenceCount =
      Number(current.evidence_count || 0) +
      (assessment === "evidence" ? 1 : 0);
    const challengedCount =
      Number(current.challenged_count || 0) +
      (assessment === "challenge" ? 1 : 0);

    let maturity = current.maturity || "new";

    if (challengedCount >= 2 && challengedCount >= evidenceCount) {
      maturity = "questioned";
    } else if (evidenceCount >= 3 && challengedCount === 0) {
      maturity = "mature";
    } else if (evidenceCount >= 1 || challengedCount >= 1) {
      maturity = "tested";
    }

    await db.prepare(`
      UPDATE memories
      SET evidence_count = ?,
          challenged_count = ?,
          maturity = ?
      WHERE id = ?
    `).bind(
      evidenceCount,
      challengedCount,
      maturity,
      lessonId
    ).run();
    await db.prepare(`
      INSERT INTO memory_history
        (memory_id, event, details, created)
      VALUES (?, 'research_evidence', ?, CURRENT_TIMESTAMP)
    `).bind(
      lessonId,
      JSON.stringify({
        research_id: researchId,
        claim_id: claimId,
        assessment,
        relevance,
        strength,
        confidence
      })
    ).run();

    return json({
      status: "Research evidence evaluated.",
      research_id: researchId,
      claim_id: claimId,
      lesson_id: lessonId,
      evidence_id: inserted.meta?.last_row_id || null,
      assessment,
      relevance,
      strength,
      evidence_count: evidenceCount,
      challenged_count: challengedCount,
      maturity,
      principle_changed: false
    });
  }

  return json({
    status: "Research evidence recorded as neutral.",
    research_id: researchId,
    claim_id: claimId,
    lesson_id: lessonId,
    evidence_id: inserted.meta?.last_row_id || null,
    assessment,
    relevance,
    strength: 0,
    principle_changed: false
  });
}

async function handleResearchHistory(db) {
  const result = await db.prepare(`
    SELECT *
    FROM research
    ORDER BY id DESC
    LIMIT 100
  `).all();

  return json(
    result.results || []
  );
}

async function handleResearchDetail(db, url) {
  const id = Number(
    url.searchParams.get("id") ||
    url.searchParams.get("research_id")
  );

  if (!id) {
    return textResponse("Missing research_id", 400);
  }

  const research = await db.prepare(`
    SELECT *
    FROM research
    WHERE id = ?
  `).bind(id).first();

  if (!research) {
    return textResponse("Research not found", 404);
  }

  const claims = await db.prepare(`
    SELECT *
    FROM research_claims
    WHERE research_id = ?
    ORDER BY id ASC
  `).bind(id).all();

  const conclusions = await db.prepare(`
    SELECT *
    FROM research_conclusions
    WHERE research_id = ?
    ORDER BY id ASC
  `).bind(id).all();

  return json({
    research,
    claims: claims.results || [],
    conclusions: conclusions.results || []
  });
}

function validateResearchTarget(raw) {
  let target;
  try { target = new URL(raw); }
  catch (_) { return { ok: false, reason: "Invalid source URL." }; }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    return { ok: false, reason: "Only public HTTP/HTTPS URLs without credentials are allowed." };
  }
  if (target.port && !["80", "443"].includes(target.port)) {
    return { ok: false, reason: "Only standard web ports are allowed." };
  }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") || host.includes(":")) {
    return { ok: false, reason: "Local or non-public hostnames are not allowed." };
  }
  const parts = host.split(".");
  if (parts.length === 4 && parts.every(part => /^\d+$/.test(part))) {
    const ip = parts.map(Number);
    const [a, b] = ip;
    if (ip.some(part => part > 255) || a === 0 || a === 10 || a === 127 ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) {
      return { ok: false, reason: "Private or reserved IP addresses are not allowed." };
    }
  }
  target.hash = "";
  return { ok: true, url: target };
}

function readableResearchText(body, contentType) {
  if (/text\/plain|application\/json|application\/xml|text\/xml/i.test(contentType)) {
    return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  return body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/article|\/section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

async function handleResearchUrl(db, url) {
  const rawTarget = cleanText(url.searchParams.get("url"));
  if (!rawTarget) return textResponse("Missing url", 400);

  const researchId = Number(url.searchParams.get("research_id") || 0);
  let targetResearch = null;
  if (researchId) {
    targetResearch = await db.prepare(
      "SELECT id, question, status FROM research WHERE id = ?"
    ).bind(researchId).first();
    if (!targetResearch) {
      return json({ status: "Research not found.", research_id: researchId }, 404);
    }
  }

  const checked = validateResearchTarget(rawTarget);
  if (!checked.ok) return json({ status: "Research source rejected.", reason: checked.reason }, 400);
  const target = checked.url;

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { "accept": "text/html,text/plain,application/json,application/xml,text/xml;q=0.9" },
      signal: AbortSignal.timeout(10000)
    });
    if (response.status >= 300 && response.status < 400) {
      return json({ status: "Research source not followed.", reason: "Submit the final public URL directly.", http_status: response.status }, 400);
    }
    if (!response.ok) return json({ status: "Research source failed.", http_status: response.status }, 502);

    const contentType = response.headers.get("content-type") || "";
    if (!/(text\/html|text\/plain|application\/json|application\/xml|text\/xml)/i.test(contentType)) {
      return json({ status: "Research source rejected.", reason: "Only text, HTML, JSON, and XML are supported." }, 415);
    }
    const maxBytes = 200000;
    if (Number(response.headers.get("content-length") || 0) > maxBytes) {
      return json({ status: "Research source rejected.", reason: "Source exceeds the 200 KB limit." }, 413);
    }
    const reader = response.body?.getReader();
    if (!reader) return json({ status: "Research source failed.", reason: "No readable response body." }, 502);
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return json({ status: "Research source rejected.", reason: "Source exceeds the 200 KB limit." }, 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const rawBody = new TextDecoder("utf-8").decode(bytes);
    const content = readableResearchText(rawBody, contentType).slice(0, 20000);
    if (!content) return json({ status: "Research source failed.", reason: "No readable text found." }, 422);

    if (researchId) {
      const existing = await db.prepare(`
        SELECT id, status
        FROM research_sources
        WHERE research_id = ? AND source_url = ?
        LIMIT 1
      `).bind(researchId, target.toString()).first();

      if (existing) {
        return json({
          status: "Source already attached to this research question.",
          research_id: researchId,
          source_id: existing.id,
          source: target.toString(),
          source_status: existing.status,
          duplicate: true,
          note: "No duplicate source was saved."
        });
      }

      const saved = await db.prepare(`
        INSERT INTO research_sources
          (research_id, source_url, source_host, content_type, content, status)
        VALUES (?, ?, ?, ?, ?, 'unverified')
      `).bind(
        researchId,
        target.toString(),
        target.hostname.toLowerCase(),
        contentType,
        content
      ).run();

      await db.prepare(`
        UPDATE research
        SET status = CASE
          WHEN status IN ('planned', 'new') THEN 'source_collected'
          ELSE status
        END
        WHERE id = ?
      `).bind(researchId).run();

      return json({
        status: "Source attached to research question.",
        research_id: researchId,
        source_id: saved.meta?.last_row_id || null,
        source: target.toString(),
        source_host: target.hostname.toLowerCase(),
        source_status: "unverified",
        content_type: contentType,
        characters_saved: content.length,
        duplicate: false,
        note: "Retrieved text is unverified. It has not been fact-checked and does not change a lesson or principle."
      });
    }

    const result = await db.prepare(`
      INSERT INTO research (question, source, answer, status)
      VALUES (?, ?, ?, 'source_saved')
    `).bind("Source collected for review: " + target.toString(), target.toString(), content).run();

    return json({
      status: "Research source saved for evaluation.",
      research_id: result.meta?.last_row_id || null,
      source: target.toString(),
      content_type: contentType,
      characters_saved: content.length,
      note: "Retrieved text is unverified evidence, not an established fact or conclusion."
    });
  } catch (error) {
    return json({ status: "Research source failed.", source: target.toString(),
      error: String(error?.message || error) }, 502);
  }
}

async function handleResearchDiscover(db, url) {
  const researchId = Number(url.searchParams.get("research_id") || 0);
  if (!Number.isSafeInteger(researchId) || researchId < 1) {
    return textResponse("Missing or invalid research_id", 400);
  }

  const research = await db.prepare(
    "SELECT id, question, status FROM research WHERE id = ?"
  ).bind(researchId).first();

  if (!research) {
    return json({ status: "Research not found.", research_id: researchId }, 404);
  }

  const question = String(research.question || "");
  const quoted = question.match(/"([^"]{3,300})"/);
  const searchTerm = (quoted ? quoted[1] : question)
    .replace(/^(what reliable evidence supports or challenges this untested lesson:|what reliable evidence supports or challenges this lesson:|compare the supporting and challenging reviewed experiences for this lesson:)/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  if (!searchTerm) {
    return json({ status: "No usable research terms found.", research_id: researchId }, 422);
  }

  const normalize = value => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normalizedQuestion = normalize(searchTerm);
  const isDecisionTopic = /\b(decision|decisions|judgment|judgement|consequence|consequences|outcome|outcomes)\b/.test(normalizedQuestion);

  // Relevance is evaluated by independent meaning groups, not raw keyword counts.
  // This prevents long, unrelated articles from passing through incidental word overlap.
  const profiles = isDecisionTopic
    ? [
        { name: "decision-making", patterns: [/\bdecision making\b/, /\bdecision-making\b/, /\bdecision theory\b/, /\bjudgment\b/, /\bjudgement\b/] },
        { name: "outcomes-and-consequences", patterns: [/\bdecision outcomes?\b/, /\boutcome evaluation\b/, /\bconsequences? of decisions?\b/, /\bdecision consequences?\b/, /\boutcome bias\b/, /\bfeedback on decisions?\b/] },
        { name: "learning-and-review", patterns: [/\blearning from (experience|outcomes|mistakes)\b/, /\bexperiential learning\b/, /\breflective practice\b/, /\bafter action review\b/] }
      ]
    : [
        { name: "learning-from-experience", patterns: [/\blearning from experience\b/, /\blearning through experience\b/, /\bexperiential learning\b/, /\bexperience-based learning\b/, /\blessons learned\b/, /\breflective practice\b/, /\breflection on experience\b/] },
        { name: "preservation-and-retention", patterns: [/\bknowledge retention\b/, /\bmemory retention\b/, /\bmemory consolidation\b/, /\blong-term memory\b/, /\borganizational memory\b/, /\binstitutional memory\b/, /\bknowledge management\b/, /\bknowledge preservation\b/, /\bpreserving knowledge\b/, /\bretention of knowledge\b/] },
        { name: "review-and-improvement", patterns: [/\bafter action review\b/, /\bpostmortem analysis\b/, /\bcontinuous improvement\b/, /\breflective learning\b/, /\bexperience review\b/, /\blessons learned process\b/] },
        { name: "memory-and-retrieval", patterns: [/\bepisodic memory\b/, /\bautobiographical memory\b/, /\bmemory retrieval\b/, /\bretrieval practice\b/, /\bmemory recall\b/, /\brecall of past experience\b/] },
        { name: "knowledge-capture-and-transfer", patterns: [/\bknowledge capture\b/, /\bknowledge transfer\b/, /\bknowledge sharing\b/, /\borganizational learning\b/, /\bexperience sharing\b/] }
      ];

  const matchedProfiles = content => {
    const text = normalize(content);
    return profiles
      .filter(profile => profile.patterns.some(pattern => pattern.test(text)))
      .map(profile => profile.name);
  };

  const relevanceScore = (title, body) => {
    const titleMatches = matchedProfiles(title);
    const bodyMatches = matchedProfiles(body);
    return {
      title_matches: titleMatches,
      body_matches: bodyMatches,
      matched_concept_groups: [...new Set([...titleMatches, ...bodyMatches])].length
    };
  };

  // Academic candidates must have a topic-specific title and meaningful
  // abstract coverage. Incidental keyword overlap alone is never sufficient.
  const academicRelevanceGate = score => {
    const titleGroups = score.title_matches || [];
    const bodyGroups = score.body_matches || [];
    if (isDecisionTopic) {
      const titleTopicAnchor =
        titleGroups.includes("decision-making") ||
        titleGroups.includes("outcomes-and-consequences");
      const abstractDecisionAnchor = bodyGroups.includes("decision-making");
      const abstractOutcomeOrLearningAnchor =
        bodyGroups.includes("outcomes-and-consequences") ||
        bodyGroups.includes("learning-and-review");
      return {
        title_topic_anchor: titleTopicAnchor,
        abstract_decision_anchor: abstractDecisionAnchor,
        abstract_outcome_or_learning_anchor: abstractOutcomeOrLearningAnchor,
        passed: titleTopicAnchor && abstractDecisionAnchor && abstractOutcomeOrLearningAnchor
      };
    }
    const titleTopicAnchor = [
      "learning-from-experience",
      "preservation-and-retention",
      "memory-and-retrieval",
      "review-and-improvement"
    ].some(group => titleGroups.includes(group));
    const abstractLearningAnchor = [
      "learning-from-experience",
      "memory-and-retrieval",
      "review-and-improvement"
    ].some(group => bodyGroups.includes(group));
    const abstractRetentionAnchor = [
      "preservation-and-retention",
      "memory-and-retrieval",
      "knowledge-capture-and-transfer"
    ].some(group => bodyGroups.includes(group));
    return {
      title_topic_anchor: titleTopicAnchor,
      abstract_learning_anchor: abstractLearningAnchor,
      abstract_retention_anchor: abstractRetentionAnchor,
      passed: titleTopicAnchor && abstractLearningAnchor && abstractRetentionAnchor
    };
  };

  const searchTerms = [searchTerm];
  if (/lesson|learn|experience|review/i.test(searchTerm)) {
    searchTerms.push("learning from experience");
  }
  if (/preserv|retain|memory|remember/i.test(searchTerm)) {
    searchTerms.push("memory retention learning");
  }
  if (/decision|judgment|consequence|outcome/i.test(searchTerm)) {
    searchTerms.push("decision making learning from outcomes");
    searchTerms.push("decision-making consequences outcomes evaluation");
    searchTerms.push("decision analysis outcome evaluation");
  }
  // Keep targeted searches ahead of the broad question so discovery is less dominated
  // by unrelated results returned for the original phrasing.
  const uniqueSearchTerms = [...new Set(searchTerms)].slice(0, 5);

  try {
    const candidateMap = new Map();
    const saved = [];
    const skipped = [];

    for (const term of uniqueSearchTerms) {
      const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
      searchUrl.search = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: term,
        format: "json",
        utf8: "1",
        srlimit: "8"
      }).toString();

      const response = await fetch(searchUrl.toString(), {
        headers: {
          "accept": "application/json",
          "user-agent": "Aren-Home/1.0 (research source discovery)"
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        skipped.push({
          search_term: term,
          reason: "Search provider unavailable.",
          http_status: response.status
        });
        continue;
      }

      const data = await response.json();
      for (const candidate of data?.query?.search || []) {
        const title = String(candidate.title || "").trim();
        if (title && !candidateMap.has(title)) candidateMap.set(title, candidate);
      }
    }

    const candidates = [...candidateMap.values()].slice(0, 12);

    // Wikipedia search is used only to discover possible vocabulary and leads.
    // Reference-encyclopedia pages are not saved as research sources.
    for (const candidate of candidates) {
      const title = String(candidate.title || "").trim();
      if (!title) continue;
      skipped.push({
        title,
        provider: "Wikipedia search",
        reason: "Reference-encyclopedia results are discovery leads only; academic-index sources are preferred and only academic candidates may be saved automatically."
      });
    }

    // Search academic indexes directly. Wikipedia results are never stored.
    // OpenAlex abstracts are reconstructed and must pass a topic-specific gate.
    const alternativeProvider = { name: "OpenAlex", attempted: false, http_status: null, error: null, candidates_found: 0, sources_saved: 0 };
    if (saved.length < 3) {
      alternativeProvider.attempted = true;
      try {
        const openAlexSearchTerm = uniqueSearchTerms.find(term => term !== searchTerm) || searchTerm;
        alternativeProvider.search_term = openAlexSearchTerm;
        const openAlexUrl = new URL("https://api.openalex.org/works");
        openAlexUrl.search = new URLSearchParams({
          search: openAlexSearchTerm,
          "per-page": "12",
          select: "id,doi,title,publication_year,authorships,abstract_inverted_index,type",
          sort: "relevance_score:desc"
        }).toString();
        const openAlexResponse = await fetch(openAlexUrl.toString(), {
          headers: {
            "accept": "application/json",
            "user-agent": "Aren-Home/1.0 (research source discovery)"
          },
          signal: AbortSignal.timeout(12000)
        });
        alternativeProvider.http_status = openAlexResponse.status;
        if (!openAlexResponse.ok) {
          alternativeProvider.error = "OpenAlex HTTP " + openAlexResponse.status;
        } else {
          const openAlexData = await openAlexResponse.json();
          const works = Array.isArray(openAlexData?.results) ? openAlexData.results : [];
          alternativeProvider.candidates_found = works.length;
          for (const work of works) {
            if (saved.length >= 3) break;
            const title = String(work?.title || "").trim();
            const inverted = work?.abstract_inverted_index;
            if (!title || !inverted || typeof inverted !== "object") continue;
            const words = [];
            for (const [word, positions] of Object.entries(inverted)) {
              for (const position of (Array.isArray(positions) ? positions : [])) {
                if (Number.isInteger(position)) words.push([position, word]);
              }
            }
            words.sort((a, b) => a[0] - b[0]);
            const abstract = words.map(item => item[1]).join(" ").trim();
            if (abstract.length < 120) continue;

            const score = relevanceScore(title, abstract);
            const academicGate = academicRelevanceGate(score);
            score.academic_gate = academicGate;
            if (!academicGate.passed) {
              skipped.push({
                title,
                provider: "OpenAlex",
                reason: "Rejected: academic title and abstract did not both demonstrate the required topic-specific concepts.",
                relevance_score: score
              });
              continue;
            }

            const sourceUrl = String(work.id || "").trim();
            if (!/^https:\/\/openalex\.org\/W\d+$/i.test(sourceUrl)) continue;
            const existing = await db.prepare(
              "SELECT id FROM research_sources WHERE research_id = ? AND source_url = ? LIMIT 1"
            ).bind(researchId, sourceUrl).first();
            if (existing) {
              skipped.push({ title, provider: "OpenAlex", reason: "Already attached to this research question." });
              continue;
            }

            const authors = (Array.isArray(work.authorships) ? work.authorships : [])
              .slice(0, 5)
              .map(item => item?.author?.display_name)
              .filter(Boolean);
            const content = [
              "Title: " + title,
              work.publication_year ? "Publication year: " + work.publication_year : "",
              authors.length ? "Authors: " + authors.join("; ") : "",
              work.doi ? "DOI: " + work.doi : "",
              "Abstract: " + abstract
            ].filter(Boolean).join("\n").slice(0, 20000);

            const inserted = await db.prepare(
              "INSERT INTO research_sources (research_id, source_url, source_host, content_type, content, status) VALUES (?, ?, 'openalex.org', 'application/json', ?, 'unverified')"
            ).bind(researchId, sourceUrl, content).run();
            saved.push({
              source_id: inserted.meta?.last_row_id || null,
              title,
              source_url: sourceUrl,
              doi: work.doi || null,
              publication_year: work.publication_year || null,
              provider: "OpenAlex",
              source_status: "unverified",
              relevance_score: score,
              characters_saved: content.length
            });
            alternativeProvider.sources_saved++;
          }
        }
      } catch (error) {
        alternativeProvider.error = String(error?.message || error);
      }
    }

    // Search Europe PMC with focused Boolean combinations rather than one broad phrase.
    const europePmcProvider = {
      name: "Europe PMC",
      attempted: false,
      http_status: null,
      error: null,
      queries_attempted: [],
      candidates_found: 0,
      sources_saved: 0
    };
    if (saved.length < 3) {
      europePmcProvider.attempted = true;
      const europePmcQueries = isDecisionTopic
        ? [
            'TITLE_ABS:("decision making" OR "decision-making") AND TITLE_ABS:(outcome OR consequence OR feedback)',
            'TITLE_ABS:("learning from mistakes" OR "decision feedback" OR "reflective practice") AND TITLE_ABS:(decision OR outcome)'
          ]
        : [
            'TITLE_ABS:("experiential learning" OR "learning from experience") AND TITLE_ABS:("memory retention" OR "memory consolidation" OR "knowledge retention")',
            'TITLE_ABS:("lessons learned" OR "reflective practice" OR "after action review") AND TITLE_ABS:("knowledge retention" OR "organizational memory" OR "knowledge management")',
            'TITLE_ABS:("episodic memory" OR "autobiographical memory") AND TITLE_ABS:(learning OR experience OR "memory consolidation")',
            'TITLE_ABS:("memory consolidation" OR "long-term memory") AND TITLE_ABS:(experience OR learning OR retrieval)'
          ];
      const europePmcWorks = new Map();
      try {
        for (const query of europePmcQueries) {
          const searchUrl = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
          searchUrl.search = new URLSearchParams({
            query,
            format: "json",
            pageSize: "12",
            resultType: "core"
          }).toString();
          const response = await fetch(searchUrl.toString(), {
            headers: {
              "accept": "application/json",
              "user-agent": "Aren-Home/1.0 (research source discovery)"
            },
            signal: AbortSignal.timeout(12000)
          });
          europePmcProvider.queries_attempted.push({
            query,
            http_status: response.status
          });
          if (!response.ok) {
            europePmcProvider.error = "One or more Europe PMC searches failed.";
            continue;
          }
          europePmcProvider.http_status = response.status;
          const data = await response.json();
          const works = Array.isArray(data?.resultList?.result)
            ? data.resultList.result
            : [];
          for (const work of works) {
            const key = String(work?.pmcid || work?.pmid || work?.doi || work?.id || work?.title || "");
            if (key && !europePmcWorks.has(key)) europePmcWorks.set(key, work);
          }
        }
        const works = [...europePmcWorks.values()];
        europePmcProvider.candidates_found = works.length;
        for (const work of works) {
          if (saved.length >= 3) break;
          const title = String(work?.title || "").trim();
          let abstract = work?.abstractText;
          if (Array.isArray(abstract)) {
            abstract = abstract.map(part =>
              typeof part === "string" ? part : String(part?.$ || "")
            ).join(" ");
          } else if (abstract && typeof abstract === "object") {
            abstract = String(abstract.$ || "");
          }
          abstract = String(abstract || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          if (!title || abstract.length < 120) continue;

          const score = relevanceScore(title, abstract);

          // Academic sources must connect the lesson topic to retention directly.
          // Generic mentions of learning plus knowledge management are insufficient.
          const academicGate = academicRelevanceGate(score);
          score.academic_gate = academicGate;
          const relevant = academicGate.passed;

          if (!relevant) {
            skipped.push({
              title,
              provider: "Europe PMC",
              reason: "Rejected: the academic title and abstract did not satisfy the topic-specific relevance requirements for this research question.",
              relevance_score: score
            });
            continue;
          }

          const pmcid = String(work?.pmcid || "").trim();
          const pmid = String(work?.pmid || "").trim();
          const sourceUrl = pmcid
            ? "https://europepmc.org/articles/" + encodeURIComponent(pmcid)
            : pmid
              ? "https://europepmc.org/article/MED/" + encodeURIComponent(pmid)
              : "";
          if (!sourceUrl) continue;
          const existing = await db.prepare(
            "SELECT id FROM research_sources WHERE research_id = ? AND source_url = ? LIMIT 1"
          ).bind(researchId, sourceUrl).first();
          if (existing) {
            skipped.push({ title, provider: "Europe PMC", reason: "Already attached to this research question." });
            continue;
          }

          const authors = Array.isArray(work.authorList?.author)
            ? work.authorList.author.slice(0, 5).map(author =>
                [author?.firstName, author?.lastName].filter(Boolean).join(" ")
              ).filter(Boolean)
            : [];
          const content = [
            "Title: " + title,
            work.firstPublicationDate ? "Publication date: " + work.firstPublicationDate : "",
            authors.length ? "Authors: " + authors.join("; ") : "",
            work.doi ? "DOI: " + work.doi : "",
            "Abstract: " + abstract
          ].filter(Boolean).join("\n").slice(0, 20000);
          const inserted = await db.prepare(
            "INSERT INTO research_sources (research_id, source_url, source_host, content_type, content, status) VALUES (?, ?, 'europepmc.org', 'application/json', ?, 'unverified')"
          ).bind(researchId, sourceUrl, content).run();
          saved.push({
            source_id: inserted.meta?.last_row_id || null,
            title,
            source_url: sourceUrl,
            doi: work.doi || null,
            publication_date: work.firstPublicationDate || null,
            provider: "Europe PMC",
            source_status: "unverified",
            relevance_score: score,
            characters_saved: content.length
          });
          europePmcProvider.sources_saved++;
        }
      } catch (error) {
        europePmcProvider.error = String(error?.message || error);
      }
    }

    if (saved.length) {
      await db.prepare(
        "UPDATE research SET status = CASE WHEN status IN ('planned', 'new') THEN 'source_collected' ELSE status END WHERE id = ?"
      ).bind(researchId).run();
    }

    return json({
      status: "Research source discovery completed.",
      research_id: researchId,
      search_term: searchTerm,
      search_variants: uniqueSearchTerms,
      provider: "OpenAlex and Europe PMC academic indexes; Wikipedia search used only for discovery leads",
      candidates_found: candidates.length,
      wikipedia_leads_only: candidates.length,
      alternative_provider: alternativeProvider,
      tertiary_provider: europePmcProvider,
      sources_saved: saved.length,
      saved,
      skipped,
      rule: "The relevance filter is preliminary. Sources remain unverified and must not be treated as established facts."
    });
  } catch (error) {
    return json({
      status: "Research discovery failed.",
      research_id: researchId,
      error: String(error?.message || error)
    }, 502);
  }
}

async function handleAutonomousResearchDiscovery(db) {
  // Retry discovery for incomplete research, including questions that already
  // have weak or insufficient sources. Each question gets at most three
  // autonomous attempts and six collected sources; source text stays unverified.
  const pending = await db.prepare(`
    SELECT
      r.id,
      COUNT(DISTINCT s.id) AS source_count,
      COUNT(DISTINCT d.id) AS attempt_count
    FROM research r
    LEFT JOIN research_sources s ON s.research_id = r.id
    LEFT JOIN research_discovery_runs d ON d.research_id = r.id
    WHERE r.research_kind = 'self_directed'
      AND r.status IN ('planned', 'new', 'source_collected')
    GROUP BY r.id
    HAVING COUNT(DISTINCT s.id) < 6
       AND COUNT(DISTINCT d.id) < 3
    ORDER BY COUNT(DISTINCT s.id) ASC, r.id ASC
    LIMIT 1
  `).first();

  if (!pending) {
    return {
      status: "No self-directed research question needs discovery or remains within its retry limits.",
      sources_saved: 0,
      retry_limit_per_question: 3,
      source_limit_per_question: 6
    };
  }

  const researchId = Number(pending.id);
  const sourcesBefore = Number(pending.source_count || 0);
  const attemptNumber = Number(pending.attempt_count || 0) + 1;

  try {
    const response = await handleResearchDiscover(
      db,
      new URL("https://aren-home.workers.dev/research-discover?research_id=" + researchId)
    );
    const result = await response.json();
    const sourcesAfterResult = await db.prepare(
      "SELECT COUNT(*) AS count FROM research_sources WHERE research_id = ?"
    ).bind(researchId).first();
    const sourcesAfter = Number(sourcesAfterResult?.count || 0);

    await db.prepare(`
      INSERT INTO research_discovery_runs
        (research_id, attempt_number, sources_before, sources_after, status, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      researchId,
      attemptNumber,
      sourcesBefore,
      sourcesAfter,
      sourcesAfter > sourcesBefore ? "sources_added" : "no_new_sources",
      JSON.stringify(result)
    ).run();

    return {
      ...result,
      research_id: researchId,
      attempt_number: attemptNumber,
      retry_limit_per_question: 3,
      sources_before: sourcesBefore,
      sources_after: sourcesAfter,
      triggered_by: "scheduled_autonomous_cycle",
      rule: "Collected sources remain unverified; discovery never creates facts or changes principles."
    };
  } catch (error) {
    await db.prepare(`
      INSERT INTO research_discovery_runs
        (research_id, attempt_number, sources_before, sources_after, status, details)
      VALUES (?, ?, ?, ?, 'failed', ?)
    `).bind(
      researchId,
      attemptNumber,
      sourcesBefore,
      sourcesBefore,
      String(error?.message || error)
    ).run();

    return {
      status: "Autonomous source discovery attempt failed.",
      research_id: researchId,
      attempt_number: attemptNumber,
      error: String(error?.message || error),
      triggered_by: "scheduled_autonomous_cycle"
    };
  }
}

async function handleManualResearchRetry(db, url) {
  const researchId = Number(url.searchParams.get("research_id") || 0);
  // This controlled test is intentionally limited to the two existing
  // self-directed research questions. It does not reset or delete history.
  if (![1, 2].includes(researchId)) {
    return json({
      status: "Manual retry not allowed.",
      allowed_research_ids: [1, 2],
      rule: "Only the two existing self-directed research questions are enabled for this controlled test."
    }, 400);
  }

  const research = await db.prepare(
    "SELECT id, question FROM research WHERE id = ? AND research_kind = 'self_directed'"
  ).bind(researchId).first();
  if (!research) {
    return json({ status: "Self-directed research question not found.", research_id: researchId }, 404);
  }

  const priorManual = await db.prepare(
    "SELECT id FROM research_discovery_runs WHERE research_id = ? AND status LIKE 'manual_retry%' LIMIT 1"
  ).bind(researchId).first();
  if (priorManual) {
    return json({
      status: "Controlled manual retry already used for this research question.",
      research_id: researchId,
      rule: "One controlled retry per question; prior discovery history remains unchanged."
    }, 409);
  }

  const beforeRow = await db.prepare(
    "SELECT COUNT(*) AS count FROM research_sources WHERE research_id = ?"
  ).bind(researchId).first();
  const sourcesBefore = Number(beforeRow?.count || 0);
  const attemptRow = await db.prepare(
    "SELECT COALESCE(MAX(attempt_number), 0) AS attempt_number FROM research_discovery_runs WHERE research_id = ?"
  ).bind(researchId).first();
  const attemptNumber = Number(attemptRow?.attempt_number || 0) + 1;

  try {
    const response = await handleResearchDiscover(
      db,
      new URL("https://aren-home.workers.dev/research-discover?research_id=" + researchId)
    );
    const result = await response.json();
    const afterRow = await db.prepare(
      "SELECT COUNT(*) AS count FROM research_sources WHERE research_id = ?"
    ).bind(researchId).first();
    const sourcesAfter = Number(afterRow?.count || 0);
    const status = sourcesAfter > sourcesBefore
      ? "manual_retry_sources_added"
      : "manual_retry_no_new_sources";

    await db.prepare(`
      INSERT INTO research_discovery_runs
        (research_id, attempt_number, sources_before, sources_after, status, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      researchId,
      attemptNumber,
      sourcesBefore,
      sourcesAfter,
      status,
      JSON.stringify(result)
    ).run();

    return json({
      ...result,
      research_id: researchId,
      attempt_number: attemptNumber,
      sources_before: sourcesBefore,
      sources_after: sourcesAfter,
      controlled_manual_retry: true,
      rule: "One-time controlled retry. Existing sources and discovery history are preserved. New sources remain unverified; no claims, lessons, or principles are changed."
    });
  } catch (error) {
    await db.prepare(`
      INSERT INTO research_discovery_runs
        (research_id, attempt_number, sources_before, sources_after, status, details)
      VALUES (?, ?, ?, ?, 'manual_retry_failed', ?)
    `).bind(
      researchId,
      attemptNumber,
      sourcesBefore,
      sourcesBefore,
      String(error?.message || error)
    ).run();

    return json({
      status: "Controlled manual research retry failed.",
      research_id: researchId,
      attempt_number: attemptNumber,
      error: String(error?.message || error),
      rule: "Failure is recorded; previous research history remains unchanged."
    }, 502);
  }
}

function researchTopicFit(topic, title, body) {
  const t = normalize(topic);
  const titleText = normalize(title);
  const fullText = normalize(title + ' ' + body);
  let groups;

  if (/preserve|preservation|retain|retention|lesson|experience|experiential/.test(t)) {
    groups = [
      ['experience', 'experiential', 'learning', 'learn', 'reflection', 'reflective'],
      ['memory', 'remember', 'retention', 'preserve', 'preservation', 'retain', 'lesson']
    ];
  } else if (/decision|consequence|outcome|impact/.test(t)) {
    groups = [
      ['decision', 'decisions', 'decision-making', 'choice', 'choices', 'judgment'],
      ['consequence', 'consequences', 'outcome', 'outcomes', 'result', 'results', 'impact', 'effects']
    ];
  } else {
    groups = [tokenize(topic).filter(word => word.length >= 6).slice(0, 4)];
  }

  const has = (text, terms) => {
    const words = new Set(text.split(/\s+/).filter(Boolean));
    return terms.some(term => words.has(term));
  };

  const matched = groups.filter(group => group.length && has(fullText, group));
  const titleAnchor = groups.some(group => group.length && has(titleText, group));
  const excludedTitle = /^(list of|category:|characters|episodes)/i.test(title.trim());
  const score = groups.length ? matched.length / groups.length : 0;

  return {
    score: excludedTitle ? Math.min(score, 0.1) : score,
    groups_required: groups.length,
    groups_matched: excludedTitle ? 0 : matched.length,
    missing_groups: groups
      .filter(group => !has(fullText, group))
      .map(group => group.join('/')),
    title_anchor: titleAnchor && !excludedTitle,
    excluded_title: excludedTitle
  };
}

async function handleAutonomousResearchReview(db, researchId = 0, forceRescreen = false) {
  const pending = await db.prepare(`
    SELECT s.id AS source_id, s.research_id, s.source_url, s.source_host,
           s.content_type, s.content, r.question
    FROM research_sources s
    INNER JOIN research r ON r.id = s.research_id
    LEFT JOIN research_source_reviews v ON v.source_id = s.id
    WHERE r.research_kind = 'self_directed'
      AND (? = 0 OR s.research_id = ?)
      AND (? = 1 OR v.id IS NULL OR v.status != 'screened_v2_unverified')
    ORDER BY s.id ASC
    LIMIT 100
  `).bind(researchId, researchId, forceRescreen ? 1 : 0).all();

  const reviewed = [];
  for (const source of (pending.results || [])) {
    const host = String(source.source_host || '').toLowerCase();
    const body = String(source.content || '');
    const titleMatch = body.match(/^Title:\s*(.+)$/im);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const doi = /\bDOI:\s*10\.\d{4,9}\//i.test(body);
    const publicationDate = /\bPublication (?:date|year):\s*\S+/i.test(body);
    const publisherClass =
      /(^|\.)europepmc\.org$|(^|\.)openalex\.org$|(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$/.test(host)
        ? 'academic-index'
        : host === 'en.wikipedia.org'
          ? 'reference-encyclopedia'
          : 'unclassified-publisher';

    const topicMatch = String(source.question || '')
      .match(/"([^"]{3,300})"/);
    const topic = (topicMatch ? topicMatch[1] : source.question || '').slice(0, 300);
    const lexical = wordOverlap(topic, title + ' ' + body);
    const concepts = conceptScore(topic, title + ' ' + body);
    const topicFit = researchTopicFit(topic, title, body);
    const genericScore = Math.max(lexical, concepts);
    // Generic word overlap is never enough to label a source strongly relevant.
    // A source must cover the topic's specific evidence dimensions.
    const relevance = Number(Math.min(genericScore, topicFit.score).toFixed(6));
    const relevanceBand =
      topicFit.groups_matched === topicFit.groups_required && topicFit.title_anchor
        ? 'strong_topic_overlap'
        : topicFit.groups_matched > 0
          ? 'partial_topic_overlap'
          : 'weak_topic_overlap';

    const flags = [];
    if (topicFit.groups_matched < topicFit.groups_required) {
      flags.push('Missing one or more required topic dimensions: ' + topicFit.missing_groups.join(', ') + '.');
    }
    if (!topicFit.title_anchor) {
      flags.push('Source title does not contain a specific topic anchor.');
    }
    if (topicFit.excluded_title) {
      flags.push('Title pattern indicates a list or entertainment index rather than topic evidence.');
    }
    if (!title) flags.push('No title metadata found in stored text.');
    if (body.length < 250) flags.push('Stored text is short and may be insufficient for assessment.');
    if (!doi && !publicationDate) flags.push('No DOI or publication date metadata found.');
    if (publisherClass === 'unclassified-publisher') flags.push('Publisher type is not classified by this screening rule.');
    if (relevanceBand === 'weak_topic_overlap') flags.push('Stored text has weak lexical/concept overlap with the research topic.');

    const metadata = {
      title: title || null,
      doi_present: doi,
      publication_date_or_year_present: publicationDate,
      source_host: host || null,
      content_type: source.content_type || null,
      characters: body.length
    };

    const record = {
      source_id: source.source_id,
      research_id: source.research_id,
      publisher_class: publisherClass,
      relevance_score: relevance,
      relevance_band: relevanceBand,
      metadata,
      flags,
      status: 'screened_v2_unverified'
    };

    await db.prepare(`
      INSERT INTO research_source_reviews
        (source_id, research_id, publisher_class, relevance_score, relevance_band, metadata, flags, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'screened_v2_unverified')
      ON CONFLICT(source_id) DO UPDATE SET
        publisher_class = excluded.publisher_class,
        relevance_score = excluded.relevance_score,
        relevance_band = excluded.relevance_band,
        metadata = excluded.metadata,
        flags = excluded.flags,
        status = 'screened_v2_unverified',
        reviewed_at = CURRENT_TIMESTAMP
    `).bind(
      source.source_id,
      source.research_id,
      publisherClass,
      relevance,
      relevanceBand,
      JSON.stringify(metadata),
      JSON.stringify(flags)
    ).run();

    reviewed.push(record);
  }

  return {
    status: 'Preliminary source screening completed.',
    sources_screened: reviewed.length,
    reviewed,
    rule: 'This is a transparent metadata and topic-overlap screen, not fact verification. No source is marked verified, no claim is accepted, and no lesson or principle is changed.'
  };
}

async function handleResearchSourceReviews(db, url) {
  const researchId = Number(url.searchParams.get('research_id') || 0);
  if (researchId && !Number.isSafeInteger(researchId)) {
    return textResponse('Invalid research_id', 400);
  }

  const rows = await db.prepare(`
    SELECT v.*, s.source_url, s.source_host, s.status AS source_status
    FROM research_source_reviews v
    INNER JOIN research_sources s ON s.id = v.source_id
    WHERE (? = 0 OR v.research_id = ?)
    ORDER BY v.id ASC
  `).bind(researchId, researchId).all();

  return json({
    status: 'Preliminary source reviews retrieved.',
    review_count: rows.results?.length || 0,
    reviews: rows.results || [],
    rule: 'Screening results are not verification or proof.'
  });
}

function researchAssessmentPage(url) {
  const researchId = Number(url.searchParams.get("research_id") || 1);
  const safeResearchId = Number.isSafeInteger(researchId) && researchId > 0 ? researchId : 1;
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aren — Evidence Assessment</title>
<style>
body{font-family:Arial,sans-serif;max-width:760px;margin:32px auto;padding:0 18px;line-height:1.5;color:#202124}
h1{margin-bottom:4px} .muted{color:#5f6368;font-size:14px}
label{display:block;font-weight:600;margin:14px 0 5px}
input,select,textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #bbb;border-radius:6px;font:inherit}
textarea{min-height:90px} button{margin-top:18px;padding:11px 18px;border:0;border-radius:6px;background:#202124;color:white;font-weight:600;cursor:pointer}
#result{white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:6px;margin-top:18px;display:none}
.note{background:#f7f7f7;padding:12px;border-left:3px solid #777;margin:16px 0}
</style>
</head>
<body>
<h1>Aren — Evidence Assessment</h1>
<p class="muted">Record what a source actually says and how it relates to one lesson.</p>
<div class="note"><strong>Important:</strong> This records an assessment only. It does not verify the source or change a lesson, memory, evidence count, maturity, or principle.</div>
<form id="assessmentForm">
<label for="research_id">Research ID</label>
<input id="research_id" name="research_id" type="number" min="1" value="${safeResearchId}" required>
<label for="source_id">Source ID</label>
<input id="source_id" name="source_id" type="number" min="1" placeholder="Example: 19" required>
<label for="lesson_id">Lesson ID</label>
<input id="lesson_id" name="lesson_id" type="number" min="1" placeholder="Example: 3" required>
<label for="assessment">Assessment</label>
<select id="assessment" name="assessment" required>
<option value="insufficient">Insufficient evidence — relevant, but cannot support or challenge</option>
<option value="supports">Supports the lesson</option>
<option value="challenges">Challenges the lesson</option>
<option value="not_relevant">Not relevant to the lesson</option>
</select>
<label for="evidence_excerpt">Exact source excerpt (required for supports/challenges)</label>
<textarea id="evidence_excerpt" name="evidence_excerpt" placeholder="Paste the passage that supports your assessment."></textarea>
<label for="reasoning">Reasoning</label>
<textarea id="reasoning" name="reasoning" minlength="10" maxlength="5000" required placeholder="Explain what the passage demonstrates and why it relates to the lesson."></textarea>
<label for="limitation">Limitations / uncertainty</label>
<textarea id="limitation" name="limitation" maxlength="3000" placeholder="For example: small sample, different population, indirect evidence, or conflicting findings."></textarea>
<label for="source_locator">Page, section, paragraph, or DOI</label>
<input id="source_locator" name="source_locator" maxlength="1000" placeholder="Where the excerpt can be found">
<label for="confidence">Assessment confidence (1–5)</label>
<select id="confidence" name="confidence">
<option value="1">1 — very low</option><option value="2">2 — low</option><option value="3" selected>3 — moderate</option><option value="4">4 — high</option><option value="5">5 — very high</option>
</select>
<button type="submit">Save assessment</button>
</form>
<pre id="result"></pre>
<p class="muted"><a href="/research-sources?research_id=${safeResearchId}">View source IDs for this research</a> · <a href="/research-source-assessments?research_id=${safeResearchId}">View saved assessments</a></p>
<script>
const form=document.getElementById("assessmentForm");
const result=document.getElementById("result");
const assessment=document.getElementById("assessment");
const excerpt=document.getElementById("evidence_excerpt");
function updateExcerpt(){excerpt.required=["supports","challenges"].includes(assessment.value);}
assessment.addEventListener("change",updateExcerpt);updateExcerpt();
form.addEventListener("submit",async event=>{
 event.preventDefault();
 const data=Object.fromEntries(new FormData(form).entries());
 for(const key of ["research_id","source_id","lesson_id","confidence"])data[key]=Number(data[key]);
 result.style.display="block";result.textContent="Saving…";
 try{
  const response=await fetch("/research-assess",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
  const body=await response.json();
  result.textContent=JSON.stringify(body,null,2);
 }catch(error){result.textContent="Could not save: "+String(error);}
});
</script>
</body>
</html>`, {headers:{"content-type":"text/html; charset=UTF-8"}});
}

async function handleResearchSourceAssessment(db, request) {
  if (request.method !== "POST") {
    return textResponse("Use POST with a JSON body to record an evidence assessment.", 405);
  }

  let input;
  try {
    input = await request.json();
  } catch (_) {
    return textResponse("Request body must be valid JSON.", 400);
  }

  const researchId = Number(input.research_id);
  const sourceId = Number(input.source_id);
  const lessonId = Number(input.lesson_id);
  const assessment = cleanText(input.assessment).toLowerCase();
  const evidenceExcerpt = cleanText(input.evidence_excerpt || "");
  const reasoning = cleanText(input.reasoning || "");
  const limitation = cleanText(input.limitation || "");
  const sourceLocator = cleanText(input.source_locator || "");
  const confidence = Number(input.confidence || 1);

  if (!Number.isSafeInteger(researchId) || researchId < 1 ||
      !Number.isSafeInteger(sourceId) || sourceId < 1 ||
      !Number.isSafeInteger(lessonId) || lessonId < 1) {
    return textResponse("research_id, source_id, and lesson_id must be positive integers.", 400);
  }
  if (!["supports", "challenges", "insufficient", "not_relevant"].includes(assessment)) {
    return textResponse("assessment must be supports, challenges, insufficient, or not_relevant.", 400);
  }
  if (!reasoning || reasoning.length < 10 || reasoning.length > 5000) {
    return textResponse("reasoning is required and must be 10 to 5000 characters.", 400);
  }
  if (["supports", "challenges"].includes(assessment) && evidenceExcerpt.length < 10) {
    return textResponse("A source excerpt is required when classifying evidence as supports or challenges.", 400);
  }
  if (evidenceExcerpt.length > 10000 || limitation.length > 3000 || sourceLocator.length > 1000) {
    return textResponse("Excerpt, limitation, or source locator exceeds the allowed length.", 400);
  }
  if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
    return textResponse("confidence must be an integer from 1 to 5.", 400);
  }

  const research = await db.prepare(
    "SELECT id, target_memory_id FROM research WHERE id = ?"
  ).bind(researchId).first();
  if (!research) return textResponse("Research not found.", 404);

  const source = await db.prepare(
    "SELECT id, research_id, status FROM research_sources WHERE id = ? AND research_id = ?"
  ).bind(sourceId, researchId).first();
  if (!source) return textResponse("Source not found for this research.", 404);

  const lesson = await getMemoryById(db, lessonId);
  if (!lesson || lesson.type !== "lesson") {
    return textResponse("Target memory must be an existing lesson.", 400);
  }
  if (research.target_memory_id && Number(research.target_memory_id) !== lessonId) {
    return textResponse("The selected lesson does not match this research question's linked lesson.", 409);
  }

  const inserted = await db.prepare(`
    INSERT INTO research_source_assessments
      (research_id, source_id, lesson_id, assessment, evidence_excerpt, reasoning,
       limitation, source_locator, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    researchId,
    sourceId,
    lessonId,
    assessment,
    evidenceExcerpt || null,
    reasoning,
    limitation || null,
    sourceLocator || null,
    confidence
  ).run();

  return json({
    status: "Evidence assessment recorded.",
    assessment_id: inserted.meta?.last_row_id || null,
    research_id: researchId,
    source_id: sourceId,
    lesson_id: lessonId,
    assessment,
    confidence,
    source_status_unchanged: source.status,
    lesson_changed: false,
    principle_changed: false,
    rule: "This records an auditable assessment only. It does not verify the source or alter lesson evidence counts, maturity, memories, or principles."
  });
}

async function handleResearchSourceAssessments(db, url) {
  const researchId = Number(url.searchParams.get("research_id") || 0);
  const sourceId = Number(url.searchParams.get("source_id") || 0);
  if ((researchId && (!Number.isSafeInteger(researchId) || researchId < 1)) ||
      (sourceId && (!Number.isSafeInteger(sourceId) || sourceId < 1))) {
    return textResponse("Invalid research_id or source_id.", 400);
  }
  if (!researchId && !sourceId) {
    return textResponse("Provide research_id or source_id.", 400);
  }

  const rows = await db.prepare(`
    SELECT a.*, s.source_url, s.source_host, s.status AS source_status,
           r.question, m.text AS lesson_text
    FROM research_source_assessments a
    INNER JOIN research_sources s ON s.id = a.source_id
    INNER JOIN research r ON r.id = a.research_id
    INNER JOIN memories m ON m.id = a.lesson_id
    WHERE (? = 0 OR a.research_id = ?)
      AND (? = 0 OR a.source_id = ?)
    ORDER BY a.id ASC
  `).bind(researchId, researchId, sourceId, sourceId).all();

  return json({
    status: "Evidence assessments retrieved.",
    assessment_count: rows.results?.length || 0,
    assessments: rows.results || [],
    rule: "Assessments are recorded interpretations, not automatic verification or changes to Aren's lessons or principles."
  });
}

async function handleResearchSources(db, url) {
  const researchId = Number(url.searchParams.get("research_id") || 0);
  if (!researchId) return textResponse("Missing research_id", 400);

  const research = await db.prepare(
    "SELECT id, question, status FROM research WHERE id = ?"
  ).bind(researchId).first();
  if (!research) return json({ status: "Research not found.", research_id: researchId }, 404);

  const result = await db.prepare(`
    SELECT id, research_id, source_url, source_host, content_type,
           status, fetched_at, length(content) AS characters_saved
    FROM research_sources
    WHERE research_id = ?
    ORDER BY id ASC
  `).bind(researchId).all();

  const sources = result.results || [];
  return json({
    status: "Research sources retrieved.",
    research,
    source_count: sources.length,
    unverified_count: sources.filter(source => source.status === "unverified").length,
    sources,
    rule: "Collected source text is not verified fact. Compare independent sources before drawing conclusions."
  });
}

async function handleHealth(db) {
  const requiredTables = [
    "memories",
    "judgments",
    "memory_history",
    "development_cycles",
    "development_tasks",
    "development_test_links",
    "principle_candidates",
    "research",
    "research_claims",
    "research_conclusions",
    "research_evidence",
    "research_sources",
    "research_discovery_runs",
    "research_source_reviews",
    "research_source_assessments",
    "schema_migrations"
  ];

  const checks = [];
  for (const table of requiredTables) {
    try {
      await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
      checks.push({ table, ok: true });
    } catch (error) {
      checks.push({ table, ok: false, error: String(error?.message || error) });
    }
  }

  const failed = checks.filter(c => !c.ok);

  return json({
    status: failed.length ? "unhealthy" : "healthy",
    database: "AREN_DB",
    tables: checks,
    checked_at: new Date().toISOString()
  }, failed.length ? 500 : 200);
}

async function handleBackup(db) {
  const memories = await db.prepare(`
    SELECT * FROM memories ORDER BY id ASC
  `).all();

  const judgments = await db.prepare(`
    SELECT * FROM judgments ORDER BY id ASC
  `).all();

  const memoryHistory = await db.prepare(`
    SELECT * FROM memory_history ORDER BY id ASC
  `).all();

  const researchSourceAssessments = await db.prepare(`
    SELECT * FROM research_source_assessments ORDER BY id ASC
  `).all();

  return json({
    backup_version: 1,
    created_at: new Date().toISOString(),
    source: "Aren-DB",
    memories: memories.results || [],
    judgments: judgments.results || [],
    memory_history: memoryHistory.results || [],
    research_source_assessments: researchSourceAssessments.results || []
  });
}

async function handleSystemTest(db) {
  const memories = await getMemories(db);
  const hasIdentity = memories.some(m => m.type === "identity");
  const hasPrinciple = memories.some(m => m.type === "principle");
  const hasLesson = memories.some(m => m.type === "lesson");

  let judgmentTest = null;
  try {
    const result = buildJudgment(
      "A decision should be examined through its consequences over time",
      memories.filter(m => m.type === "principle"),
      memories.filter(m => m.type === "lesson")
    );
    judgmentTest = {
      ok: true,
      judgment: result.judgment
    };
  } catch (error) {
    judgmentTest = {
      ok: false,
      error: String(error?.message || error)
    };
  }

  const checks = {
    d1: true,
    identity: hasIdentity,
    principle: hasPrinciple,
    lessons: hasLesson,
    judgment_engine: judgmentTest.ok
  };

  const passed = Object.values(checks).filter(Boolean).length;

  return json({
    status: passed === Object.keys(checks).length ? "healthy" : "attention_required",
    checks,
    passed,
    total: Object.keys(checks).length,
    judgment_test: judgmentTest
  }, passed === Object.keys(checks).length ? 200 : 500);
}

function homepage() {
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Aren</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 850px;
      margin: 50px auto;
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
    }
  </style>
</head>
<body>
  <h1>Aren</h1>
  <div class="subtitle">An evolving AI identity.</div>
  <a href="/identity">Identity</a>
  <a href="/memories">Memory</a>
  <a href="/principles">Principles</a>
  <a href="/lessons">Lessons</a>
  <a href="/development">Development</a>
  <a href="/self-evaluate">Self Evaluation</a>
  <a href="/principle-candidates">Principle Candidates</a>
  <a href="/judgments">Judgments</a>
  <a href="/research-history">Research</a>
  <a href="/self-directed-research">Self-Directed Research</a>
  <a href="/memory-test">Memory Test</a>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (!env.AREN_DB) {
        return textResponse(
          "AREN_DB binding is missing.",
          500
        );
      }

      const db = env.AREN_DB;

      await ensureTables(db);

      if (path === "/health") {
        return await handleHealth(db);
      }

      if (path === "/backup") {
        return await handleBackup(db);
      }

      if (path === "/system-test") {
        return await handleSystemTest(db);
      }

      if (path === "/") {
        return new Response(homepage(), {
          headers: {
            "content-type": "text/html; charset=UTF-8"
          }
        });
      }

      if (path === "/memory-test") {
        if (env.KV) {
          await env.KV.put(
            "aren_memory_test",
            "working"
          );
        }

        return textResponse(
          "Aren memory is working"
        );
      }

      if (path === "/memories") {
        return json(
          await getMemories(db)
        );
      }

      if (path === "/memory") {
        return json(
          await getMemories(db)
        );
      }

      if (path === "/context") {
        const memories = await getMemories(db);

        return json({
          identity: memories.filter(m => m.type === "identity"),
          principles: memories.filter(m => m.type === "principle"),
          lessons: memories.filter(m => m.type === "lesson"),
          memories: memories.filter(
            m => !["identity", "principle", "lesson"].includes(m.type)
          )
        });
      }

      if (path === "/remember") {
        return await handleRemember(
          db,
          url
        );
      }

      if (path === "/memory-type") {
        return await handleMemoryType(
          db,
          url
        );
      }

      if (path === "/identity") {
        return await handleMemoryType(
          db,
          new URL(
            `${url.origin}/memory-type?type=identity`
          )
        );
      }

      if (path === "/principles") {
        return await handleMemoryType(
          db,
          new URL(
            `${url.origin}/memory-type?type=principle`
          )
        );
      }

      if (path === "/lessons") {
        return await handleMemoryType(
          db,
          new URL(
            `${url.origin}/memory-type?type=lesson`
          )
        );
      }

      if (path === "/memory-history") {
        return await handleMemoryHistory(
          db,
          url
        );
      }

      if (path === "/think") {
        return await handleThink(
          db,
          url
        );
      }

      if (path === "/decide") {
        return await handleDecide(
          db,
          url
        );
      }

      if (path === "/judgment") {
        return await handleJudgment(
          db,
          url
        );
      }

      if (path === "/judgments") {
        return await handleJudgments(
          db
        );
      }

      if (
        path === "/review" ||
        path === "/judgment/review"
      ) {
        return await handleReview(
          db,
          url
        );
      }

      if (path === "/evidence") {
        return await handleEvidence(
          db,
          url
        );
      }

      if (path === "/challenge") {
        return await handleChallenge(
          db,
          url
        );
      }

      if (path === "/autolearn") {
        return await handleAutolearn(
          db
        );
      }

      if (path === "/self-evaluate") {
        return await handleSelfEvaluate(
          db
        );
      }

      if (path === "/evaluate-lessons") {
        return await handleEvaluateLessons(
          db
        );
      }

      if (path === "/lesson-analysis") {
        const memoryId = Number(url.searchParams.get("memory_id"));

        if (!memoryId) {
          return textResponse("Missing memory_id", 400);
        }

        const lesson = await db.prepare(
          "SELECT id, text, type, evidence_count, challenged_count, maturity FROM memories WHERE id = ?"
        ).bind(memoryId).first();

        if (!lesson || lesson.type !== "lesson") {
          return json({
            status: "skipped",
            reason: "Lesson not found."
          });
        }

        const rows = await db.prepare(
          `SELECT j.id, j.assessment, j.situation, j.judgment, j.outcome
           FROM development_test_links l
           INNER JOIN judgments j ON j.id = l.judgment_id
           WHERE l.lesson_id = ?
             AND j.assessment IN ('evidence', 'challenge')
           ORDER BY j.id ASC`
        ).bind(memoryId).all();

        const standaloneChallenges = await db.prepare(
          `SELECT id, situation, outcome, strength
           FROM lesson_challenges
           WHERE lesson_id = ?
           ORDER BY id ASC`
        ).bind(memoryId).all();

        let support = 0;
        let challenge = 0;

        for (const row of (rows.results || [])) {
          const analysis = analyzeReviewOutcome(lesson, row);
          if (row.assessment === "evidence") support += analysis.strength;
          if (row.assessment === "challenge") challenge += analysis.strength;
        }

        for (const row of (standaloneChallenges.results || [])) {
          challenge += Number(row.strength || 0);
        }

        return json({
          status: "completed",
          lesson_id: memoryId,
          analyzed_experiences: rows.results?.length || 0,
          support_weight: Number(support.toFixed(6)),
          challenge_weight: Number(challenge.toFixed(6)),
          evidence_count: lesson.evidence_count,
          challenged_count: lesson.challenged_count,
          maturity: lesson.maturity
        });
      }

      if (path === "/principle-candidates") {
        return await handlePrincipleCandidates(
          db
        );
      }

      if (path === "/development") {
        return await handleDevelopment(
          db
        );
      }

      if (path === "/autonomous-cycle") {
        return await handleAutonomousCycle(
          db
        );
      }

      if (
        path === "/execute-development" ||
        path === "/autonomous-development"
      ) {
        return await handleExecuteDevelopment(
          db
        );
      }

      if (path === "/self-directed-research") {
        return await handleSelfDirectedResearch(db);
      }

      if (path === "/research") {
        return await handleResearch(
          db,
          url
        );
      }

      if (path === "/research-claim") {
        return await handleResearchClaim(
          db,
          url
        );
      }

      if (path === "/research-conclusion") {
        return await handleResearchConclusion(
          db,
          url
        );
      }

      if (path === "/research-history") {
        return await handleResearchHistory(
          db
        );
      }

      if (path === "/research-evidence") {
        return await handleResearchEvidence(
          db,
          url
        );
      }

      if (path === "/research-detail") {
        return await handleResearchDetail(
          db,
          url
        );
      }

      if (path === "/research-discover") {
        return await handleResearchDiscover(db, url);
      }

      if (path === "/research-retry") {
        return await handleManualResearchRetry(db, url);
      }

      if (path === "/research-url") {
        return await handleResearchUrl(
          db,
          url
        );
      }

      if (path === "/research-screen") {
        const researchId = Number(url.searchParams.get("research_id") || 0);
        if (!Number.isSafeInteger(researchId) || researchId < 1) {
          return textResponse("A valid research_id is required.", 400);
        }
        return json(await handleAutonomousResearchReview(db, researchId, true));
      }

      if (path === "/research-source-reviews") {
        return await handleResearchSourceReviews(db, url);
      }

      if (path === "/research-source-assessments") {
        return await handleResearchSourceAssessments(db, url);
      }

      if (path === "/research-assessment") {
        return researchAssessmentPage(url);
      }

      if (path === "/research-assess") {
        return await handleResearchSourceAssessment(db, request);
      }

      if (path === "/research-sources") {
        return await handleResearchSources(
          db,
          url
        );
      }

      return textResponse(
        "Not found",
        404
      );

    } catch (error) {
      return textResponse(
        `Aren Worker Error: ${String(error?.message || error)}`,
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    try {
      if (!env.AREN_DB) return;
      const db = env.AREN_DB;
      await ensureTables(db);
      await handleAutonomousCycle(db);
    } catch (_) {
      // Scheduled development must never crash the Worker runtime.
    }
  }
};