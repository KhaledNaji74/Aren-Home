async function handleAutonomousDevelopment(env) {
  await ensureTables(env);

  const judgments =
    await env.AREN_DB
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
