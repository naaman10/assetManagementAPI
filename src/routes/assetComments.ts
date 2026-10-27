import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import {
  assetCommentMentions,
  assetComments,
  assets,
  locations,
  sites,
  users,
} from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody } from "./http.js";

const authors = alias(users, "comment_authors");
const mentionedUsers = alias(users, "comment_mentioned_users");

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentionedUserIds: z.array(z.uuid()).max(50).optional(),
});

export const assetCommentRoutes = new Hono<AppEnv>();

assetCommentRoutes.get("/assets/:id/comments", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const db = c.get("services").db;
  const asset = await visibleAsset(db, c.get("user"), assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const comments = await commentsForAsset(db, assetId);
  return c.json({ commentCount: comments.length, comments });
});

assetCommentRoutes.post("/assets/:id/comments", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const parsed = createCommentSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const asset = await visibleAsset(db, user, assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const mentionedUserIds = await usersExist(db, parsed.data.mentionedUserIds ?? []);

  if (!mentionedUserIds) {
    return c.json({ error: "Mentioned user not found." }, 404);
  }

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(assetComments)
      .values({
        assetId,
        authorUserId: user.id,
        body: parsed.data.body,
      })
      .returning({ id: assetComments.id });

    if (row && mentionedUserIds.length > 0) {
      await tx.insert(assetCommentMentions).values(
        mentionedUserIds.map((mentionedUserId) => ({
          commentId: row.id,
          userId: mentionedUserId,
        })),
      );
    }

    return [row];
  });

  if (!created) {
    throw new Error("Comment was not created.");
  }

  const comment = await loadComment(db, user, created.id);

  if (!comment) {
    throw new Error("Comment was not created.");
  }

  return c.json({ comment }, 201);
});

assetCommentRoutes.get("/comments/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Comment not found." }, 404);
  }

  const comment = await loadComment(c.get("services").db, c.get("user"), id);

  if (!comment) {
    return c.json({ error: "Comment not found." }, 404);
  }

  return c.json({ comment });
});

assetCommentRoutes.delete("/comments/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Comment not found." }, 404);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const comment = await loadComment(db, user, id);

  if (!comment) {
    return c.json({ error: "Comment not found." }, 404);
  }

  if (comment.author.id !== user.id) {
    return c.json({ error: "Only the author can delete this comment." }, 403);
  }

  await db.delete(assetComments).where(eq(assetComments.id, id));
  return c.json({ ok: true });
});

async function commentsForAsset(db: Database, assetId: string) {
  const rows = await db
    .select({
      id: assetComments.id,
      assetId: assetComments.assetId,
      body: assetComments.body,
      createdAt: assetComments.createdAt,
      updatedAt: assetComments.updatedAt,
      authorId: authors.id,
      authorEmail: authors.email,
      authorName: authors.name,
    })
    .from(assetComments)
    .innerJoin(authors, eq(assetComments.authorUserId, authors.id))
    .where(eq(assetComments.assetId, assetId))
    .orderBy(asc(assetComments.createdAt), asc(assetComments.id));

  return presentComments(db, rows);
}

async function loadComment(db: Database, user: AuthUser, id: string) {
  const [row] = await db
    .select({
      id: assetComments.id,
      assetId: assetComments.assetId,
      body: assetComments.body,
      createdAt: assetComments.createdAt,
      updatedAt: assetComments.updatedAt,
      authorId: authors.id,
      authorEmail: authors.email,
      authorName: authors.name,
      clientId: sites.clientId,
    })
    .from(assetComments)
    .innerJoin(authors, eq(assetComments.authorUserId, authors.id))
    .innerJoin(assets, eq(assetComments.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(eq(assetComments.id, id))
    .limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const [comment] = await presentComments(db, [row]);
  return comment ?? null;
}

async function presentComments(
  db: Database,
  rows: {
    id: string;
    assetId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    authorId: string;
    authorEmail: string;
    authorName: string | null;
  }[],
) {
  const ids = rows.map((row) => row.id);
  const mentionRows =
    ids.length === 0
      ? []
      : await db
          .select({
            commentId: assetCommentMentions.commentId,
            id: mentionedUsers.id,
            email: mentionedUsers.email,
            name: mentionedUsers.name,
          })
          .from(assetCommentMentions)
          .innerJoin(mentionedUsers, eq(assetCommentMentions.userId, mentionedUsers.id))
          .where(inArray(assetCommentMentions.commentId, ids))
          .orderBy(asc(mentionedUsers.name), asc(mentionedUsers.email));

  const mentionsByComment = new Map<string, CommentUser[]>();

  for (const mention of mentionRows) {
    const list = mentionsByComment.get(mention.commentId) ?? [];
    list.push({
      id: mention.id,
      email: mention.email,
      name: mention.name,
    });
    mentionsByComment.set(mention.commentId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    assetId: row.assetId,
    body: row.body,
    author: {
      id: row.authorId,
      email: row.authorEmail,
      name: row.authorName,
    },
    mentions: mentionsByComment.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function visibleAsset(db: Database, user: AuthUser, assetId: string) {
  const [asset] = await db
    .select({ id: assets.id, clientId: sites.clientId })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!asset || !(await clientIsVisible(db, user, asset.clientId))) {
    return null;
  }

  return asset;
}

async function usersExist(db: Database, ids: string[]) {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return unique;
  }

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, unique), eq(users.disabled, false)));

  return rows.length === unique.length ? unique : null;
}

type CommentUser = {
  id: string;
  email: string;
  name: string | null;
};

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
