import express from "express";
import redis from "../redis.js";
import { nanoid } from "nanoid";
import { validatePaste } from "../utils/validate.js";
import { now } from "../utils/time.js";
import { escapeHtml } from "../utils/escapeHtml.js";

const router = express.Router();

/* CREATE PASTE */
router.post("/", async (req, res) => {
  const error = validatePaste(req.body);
  if (error) return res.status(400).json({ error });

  const id = nanoid(8);
  const current = now(req);

  const paste = {
    id,
    content: req.body.content,
    created_at: current,
    expires_at: req.body.ttl_seconds
      ? current + req.body.ttl_seconds * 1000
      : null,
    max_views: req.body.max_views ?? null,
    views: 0
  };

  await redis.set(`paste:${id}`, JSON.stringify(paste));

  res.json({
    id,
    url: `${req.protocol}://${req.get("host")}/p/${id}`
  });
});

/* FETCH API */
router.get("/api/:id", async (req, res) => {
  const gen_id = `paste:${req.params.id}`;
  const result = await redis.get(gen_id);
  if (!result) return res.status(404).json({ error: "Not found" });

  const paste = JSON.parse(result);
  const current = now(req);

  if (paste.expires_at && current > paste.expires_at) {
    return res.status(404).json({ error: "Expired" });
  }

  if (paste.max_views && paste.views >= paste.max_views) {
    return res.status(404).json({ error: "View limit exceeded" });
  }

  paste.views++;
  await redis.set(gen_id, JSON.stringify(paste));

  res.json({
    content: paste.content,
    remaining_views: paste.max_views
      ? paste.max_views - paste.views
      : null,
    expires_at: paste.expires_at
      ? new Date(paste.expires_at).toISOString()
      : null
  });
});

/* HTML VIEW */
router.get("/:id", async (req, res) => {
  const gen_id = `paste:${req.params.id}`;
  const result = await redis.get(gen_id);
  if (!result) return res.sendStatus(404);

  const paste = JSON.parse(result);
  const current = now(req);

  if (
    (paste.expires_at && current > paste.expires_at) ||
    (paste.max_views && paste.views >= paste.max_views)
  ) {
    return res.sendStatus(404);
  }

  paste.views++;
  await redis.set(gen_id, JSON.stringify(paste));

  res.send(`
    <html>
      <body>
      <pre style="
        color:#ff0000;
        font-size:20px;
      ">
        <pre>${escapeHtml(paste.content)}</pre>
      </body>
    </html>
  `);
});

export default router;
