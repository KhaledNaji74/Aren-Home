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
      `ALTER TABLE memory_history ADD COLUMN created DATETIME DEFAULT CURRENT_TIMESTAMP`
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
        (memory_id, event, details)
      VALUES (?, 'created', ?)
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
    SET assessment = ?
    WHERE id = ?
  `).bind(
    assessment,
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
    const text = cleanText(
      judgment.outcome ||
      judgment.judgment ||
      judgment.situation
    );

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
      const pendingExperience = await db.prepare(`
        SELECT COUNT(*) AS count
        FROM judgments j
        LEFT JOIN development_test_links l
          ON l.lesson_id = ?
          AND l.judgment_id = j.id
        WHERE j.assessment IN ('evidence', 'challenge')
          AND l.id IS NULL
      `).bind(target).first();

      if (Number(pendingExperience?.count || 0) > 0) {
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
        type: "gather_evidence",
        target_memory_id: lesson.id,
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


async function executeTestLesson(db, task) {
  const lesson = await getMemoryById(db, task.target_memory_id);
  if (!lesson || lesson.type !== "lesson") {
    return { status: "skipped", reason: "Lesson not found." };
  }

  const rows = await db.prepare(`
    SELECT j.id, j.situation, j.judgment, j.assessment
    FROM judgments j
    LEFT JOIN development_test_links l
      ON l.lesson_id = ?
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
      (memory_id, event, details)
    VALUES (?, 'evidence', ?)
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
    SET challenged_count = ?,
        maturity = ?
    WHERE id = ?
  `).bind(
    challenged,
    maturity,
    memoryId
  ).run();

  await db.prepare(`
    INSERT INTO memory_history
      (memory_id, event, details)
    VALUES (?, 'challenge', ?)
  `).bind(
    memoryId,
    `Challenge count increased to ${challenged}`
  ).run();

  return json({
    status: "Challenge recorded.",
    memory_id: memoryId,
    evidence_count: evidence,
    challenged_count: challenged,
    maturity
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

async function handleResearchUrl(db, url) {
  const target = cleanText(
    url.searchParams.get("url")
  );

  if (!target) {
    return textResponse("Missing url", 400);
  }

  try {
    const response = await fetch(target);

    const contentType =
      response.headers.get("content-type") || "";

    const body = await response.text();

    const limitedBody = body.slice(0, 20000);

    const result = await db.prepare(`
      INSERT INTO research
        (question, source, answer, status)
      VALUES (?, ?, ?, 'completed')
    `).bind(
      `Research source: ${target}`,
      target,
      limitedBody
    ).run();

    return json({
      status: "Research source retrieved.",
      research_id: result.meta?.last_row_id || null,
      source: target,
      content_type: contentType,
      content: limitedBody
    });
  } catch (error) {
    return json({
      status: "Research source failed.",
      source: target,
      error: String(error?.message || error)
    }, 500);
  }
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

      if (path === "/execute-development") {
        return await handleExecuteDevelopment(
          db
        );
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

      if (path === "/research-detail") {
        return await handleResearchDetail(
          db,
          url
        );
      }

      if (path === "/research-url") {
        return await handleResearchUrl(
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
  }
};
