-- Add soft-delete column to Card. Rows are hidden from the user but
-- remain in the DB so historical Payment.cardId FKs stay intact
-- (Payment.cardId has onDelete: Restrict — a physical DELETE would fail).
ALTER TABLE "cards" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- New index optimized for the common pattern: list a user's
-- ACTIVE cards (deletedAt IS NULL) ordered by createdAt DESC. The
-- old (userId) index is left in place — it's a strict prefix of this
-- composite and Prisma will pick the more specific one when filtered.
CREATE INDEX "cards_userId_deletedAt_idx" ON "cards"("userId", "deletedAt");
