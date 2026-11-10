import { readDocument, writeDocument } from "../storage/jsonDocumentBackend.js";
import { createKeyedLock } from "../services/keyedLock.js";
import { NS, LEGACY_FILENAME } from "../storage/namespaces.js";

// This document has its own lock: unrelated payment writes must not race it.
const lock = createKeyedLock();
const namespace = NS.TELEGRAM_CABINETS;
const filename = LEGACY_FILENAME[namespace];

export async function getCards(telegramId) {
  const db = await readDocument(namespace, filename);
  return Array.isArray(db[String(telegramId)]) ? db[String(telegramId)] : [];
}

export async function rememberCard(telegramId, card) {
  return lock("document", async () => {
    const db = await readDocument(namespace, filename);
    const old = Array.isArray(db[String(telegramId)]) ? db[String(telegramId)] : [];
    db[String(telegramId)] = [...old.filter((v) => v.messageId !== card.messageId), card].slice(-3);
    await writeDocument(namespace, filename, db);
  });
}

export async function forgetCard(telegramId, messageId) {
  return lock("document", async () => {
    const db = await readDocument(namespace, filename);
    const old = Array.isArray(db[String(telegramId)]) ? db[String(telegramId)] : [];
    db[String(telegramId)] = old.filter((v) => v.messageId !== messageId);
    await writeDocument(namespace, filename, db);
  });
}
