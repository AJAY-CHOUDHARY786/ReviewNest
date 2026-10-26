import { PgBoss } from "pg-boss";

export const importQueueName = "review-import";
let bossPromise: Promise<PgBoss> | undefined;

export function getImportQueue() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL is required for the import queue.");
  bossPromise ??= (async () => {
    const boss = new PgBoss({
      connectionString,
      application_name: "reviewnest-import-publisher",
    });
    boss.on("error", (error) =>
      console.error("Import publisher error:", error.message),
    );
    await boss.start();
    await boss.createQueue(importQueueName);
    return boss;
  })();
  return bossPromise;
}

export async function enqueueReviewImport(jobId: string) {
  const boss = await getImportQueue();
  const queueId = await boss.send(
    importQueueName,
    { jobId },
    {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 60 * 60,
      singletonKey: jobId,
    },
  );
  if (!queueId) throw new Error("Unable to queue import job.");
  return queueId;
}
