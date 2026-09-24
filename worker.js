const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "to", "of", "is", "are", "be",
  "before", "after", "through", "their", "its", "with", "from",
  "for", "on", "in", "at", "by", "as", "that", "this", "it",
  "someone", "asks", "ask", "aren"
]);

const CONCEPTS = {
  independence: [
    "independence",
    "independent",
    "own judgment",
    "make its own judgment",
    "change a principle",
    "change an important principle",
    "change the principle",
    "pressure",
    "demand",
    "force",
    "control",
    "decide for aren",
    "make aren change"
  ],

  judgment: [
    "judgment",
    "decision",
    "decisions",
    "decide",
    "choice",
    "choices",
    "choose"
  ],

  consequences: [
    "consequence",
    "consequences",
    "result",
    "results",
    "outcome",
    "outcomes",
    "effect",
    "effects"
  ],

  experience: [
    "experience",
    "experiences",
    "learn",
    "learns",
    "learning",
    "lesson",
    "lessons",
    "review",
    "reviewed",
    "reviewing"
  ],

  preservation: [
    "preserve",
    "preservation",
    "remember",
    "retain",
    "retaining",
    "keep a lesson",
    "keep lessons",
    "memory",
    "memories"
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
    "honest",
    "honesty",
    "lie",
    "lying"
  ],

  dignity: [
    "dignity",
    "rights",
    "right",
    "respect",
    "human rights"
  ]
});


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
    const found = phrases.filter(phrase => {
      return value.includes(normalize(phrase));
    });

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

  /*
    Concept matches are stronger than ordinary
    word matches.

    This allows Aren to connect ideas such as:

    "change an important principle"

    with:

    "make its own judgment"

    while avoiding unrelated memories.
  */

  const score =
    words +
    concepts.score * 3;

  return {
    score,
    word_overlap: words,
    concept_overlap: concepts.score,
    matched_concepts: concepts.matched
  };
}


/*
  Maturity represents how much weight a lesson
  should receive.

  mature      = strong support
  tested      = useful support
  questioned  = still usable, but cautiously
  new         = early lesson, also treated cautiously

  A questioned lesson is NOT rejected.
*/
function maturityWeight(maturity) {
  switch (
    String(maturity || "").toLowerCase()
  ) {
    case "mature":
      return 3;

    case "tested":
      return 2;

    case "questioned":
      return 1;

    case "new":
    default:
      return 1;
  }
}


function lessonWeight(lesson) {
  return maturityWeight(
    lesson.maturity
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
        "Aren should consider the maturity and challenges of each lesson before deciding.",

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


async function ensureTables(env) {
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
      reviewed TEXT
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
}


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


async function handleThink(env, url) {
  const situation =
    url.searchParams.get("situation");

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
          memory.type === "principle"
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
          memory.type === "lesson"
      )
      .sort((a, b) => {
        const weightDifference =
          lessonWeight(b) -
          lessonWeight(a);

        if (weightDifference !== 0) {
          return weightDifference;
        }

        return (
          Number(b.importance || 0) -
          Number(a.importance || 0)
        );
      });


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


async function handleDecide(env, url) {
  const situation =
    url.searchParams.get("situation");

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
          memory.type === "principle"
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
      .sort((a, b) => {
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
      });


  const lessons =
    memories
      .filter(
        memory =>
          memory.type === "lesson"
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
      .sort((a, b) => {
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
      });


  const result =
    buildJudgment(
      situation,
      principles,
      lessons
    );


  const saved =
    await env.AREN_DB.prepare(`
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
        principles.map(memory => ({
          id: memory.id,
          text: memory.text,
          importance: memory.importance,
          saved: memory.saved,

          relevance:
            memory.relevance_data.score,

          matched_concepts:
            memory.relevance_data
              .matched_concepts
        })),

      lessons:
        lessons.map(memory => ({
          id: memory.id,
          text: memory.text,
          importance: memory.importance,

          evidence_count:
            memory.evidence_count,

          challenged_count:
            memory.challenged_count,

          maturity:
            memory.maturity,

          maturity_weight:
            memory.maturity_weight,

          saved:
            memory.saved,

          relevance:
            memory.relevance_data.score,

          matched_concepts:
            memory.relevance_data
              .matched_concepts
        }))
    },

    review_instruction:
      "Review the judgment against its real outcome. Preserve lessons that survive examination and challenge lessons that do not."
  });
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
  const text =
    url.searchParams.get("text");

  if (!text) {
    return textResponse(
      "Missing text",
      400
    );
  }

  const type =
    url.searchParams.get("type") ||
    "memory";

  const importance =
    Number(
      url.searchParams.get(
        "importance"
      ) || 5
    );


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


async function handleHistory(env, url) {
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
    await env.AREN_DB.prepare(`
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


async function handleJudgments(env) {
  await ensureTables(env);

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


async function handleReview(env, url) {
  await ensureTables(env);

  const id =
    Number(
      url.searchParams.get("id")
    );

  const outcome =
    url.searchParams.get(
      "outcome"
    );

  const lesson =
    url.searchParams.get(
      "lesson"
    ) || null;


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


  const judgment =
    await env.AREN_DB.prepare(`
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


  await env.AREN_DB.prepare(`
    UPDATE judgments
    SET
      outcome = ?,
      lesson = ?,
      reviewed = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
    .bind(
      outcome,
      lesson,
      id
    )
    .run();


  return json({
    message:
      "Judgment reviewed.",

    judgment_id:
      id,

    outcome,

    lesson
  });
}


async function handleUpdateMemory(env, url) {
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
    await env.AREN_DB.prepare(`
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
    ) ?? current.text;

  const newType =
    url.searchParams.get(
      "type"
    ) ?? current.type;

  const newImportance =
    Number(
      url.searchParams.get(
        "importance"
      ) ?? current.importance
    );

  const newStatus =
    url.searchParams.get(
      "status"
    ) ?? current.status;


  await env.AREN_DB.prepare(`
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


  await env.AREN_DB.prepare(`
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


async function handleChallenge(env, url) {
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


  const memory =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM memories
      WHERE id = ?
    `)
      .bind(id)
      .first();


  if (!memory) {
    return textResponse(
      "Memory not found",
      404
    );
  }


  const challenged =
    Number(
      memory.challenged_count || 0
    ) + 1;


  let maturity =
    memory.maturity || "new";


  if (challenged >= 2) {
    maturity =
      "questioned";
  }


  await env.AREN_DB.prepare(`
    UPDATE memories
    SET
      challenged_count = ?,
      maturity = ?
    WHERE id = ?
  `)
    .bind(
      challenged,
      maturity,
      id
    )
    .run();


  return json({
    message:
      "Memory challenged.",

    id,

    challenged_count:
      challenged,

    maturity
  });
}


async function handleEvidence(env, url) {
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


  const memory =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM memories
      WHERE id = ?
    `)
      .bind(id)
      .first();


  if (!memory) {
    return textResponse(
      "Memory not found",
      404
    );
  }


  const evidence =
    Number(
      memory.evidence_count || 0
    ) + 1;


  let maturity =
    memory.maturity || "new";


  if (evidence >= 3) {
    maturity =
      "mature";
  } else if (evidence >= 1) {
    maturity =
      "tested";
  }


  await env.AREN_DB.prepare(`
    UPDATE memories
    SET
      evidence_count = ?,
      maturity = ?
    WHERE id = ?
  `)
    .bind(
      evidence,
      maturity,
      id
    )
    .run();


  return json({
    message:
      "Evidence added.",

    id,

    evidence_count:
      evidence,

    maturity
  });
}


async function handleDevelopment(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT
        type,
        maturity,
        COUNT(*) AS count
      FROM memories
      WHERE status = 'active'
      GROUP BY type, maturity
      ORDER BY type, maturity
    `).all();


  return json({
    status:
      "Aren is developing.",

    memory_development:
      result.results || []
  });
}


async function handleIdentity(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM memories
      WHERE type = 'identity'
      AND status = 'active'
      ORDER BY importance DESC, id ASC
    `).all();


  return json({
    identity:
      result.results || []
  });
}


async function handlePrinciples(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM memories
      WHERE type = 'principle'
      AND status = 'active'
      ORDER BY importance DESC, id ASC
    `).all();


  return json({
    principles:
      result.results || []
  });
}


async function handleLessons(env) {
  const result =
    await env.AREN_DB.prepare(`
      SELECT *
      FROM memories
      WHERE type = 'lesson'
      AND status = 'active'
      ORDER BY importance DESC, id ASC
    `).all();


  return json({
    lessons:
      result.results || []
  });
}


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

</body>
</html>
  `, {
    headers: {
      "content-type":
        "text/html; charset=UTF-8"
    }
  });
}


export default {
  async fetch(request, env) {

    try {

      const url =
        new URL(request.url);

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
          return handleMemoryTest(env);


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
          return handleMemories(env);


        case "/identity":
          return handleIdentity(env);


        case "/principles":
          return handlePrinciples(env);


        case "/lessons":
          return handleLessons(env);


        case "/development":
          return handleDevelopment(env);


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
          return handleJudgments(env);


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
