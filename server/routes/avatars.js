import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { requireAuth } from '../auth.js';
import { catalogRows } from '../avatar-catalog.js';

export const avatarRouter = Router();
const catalogMeta = new Map(catalogRows().map(item => [item.slug, item]));
const LEGACY_CHARACTERS = new Set(['lorelei', 'adventurer', 'bottts', 'pixel-art', 'thumbs', 'avataaars', 'fun-emoji', 'bottts-neutral', 'croodles', 'voxel-art']);
const hexColor = z.string().regex(/^#?[0-9a-fA-F]{3,8}$/);
const optionValue = z.union([z.string().min(1).max(128), z.number().finite().min(-360).max(360), z.boolean()]);
const avatarConfigSchema = z.object({
  character: z.string().min(1).max(64).default('toon-head'),
  outfit: z.string().max(64).default(''),
  background: z.string().max(64).default(''),
  seed: z.string().min(1).max(80).default('karhoot'),
  options: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), optionValue).default({})
}).superRefine((config, ctx) => {
  for (const key of ['backgroundColor', 'skinColor', 'hairColor', 'clothesColor', 'clothingColor', 'eyesColor', 'mouthColor', 'strokeColor']) {
    const value = config.options[key];
    if (value !== undefined && typeof value === 'string' && !hexColor.safeParse(value).success) {
      ctx.addIssue({ code: 'custom', path: ['options', key], message: `Couleur invalide: ${key}` });
    }
  }
});

function owned(userId, slug) {
  if (!slug) return true;
  const item = db.prepare('SELECT id,price FROM avatar_items WHERE slug=? AND active=1').get(slug);
  if (!item) return false;
  return item.price === 0 || !!db.prepare('SELECT 1 FROM user_avatar_items WHERE user_id=? AND item_id=?').get(userId, item.id);
}

function getConfig(userId) {
  const row = db.prepare('SELECT avatar_config,username FROM users WHERE id=?').get(userId);
  let config;
  try {
    const raw = JSON.parse(row?.avatar_config || '{}');
    config = {
      character: raw.character || 'toon-head',
      outfit: raw.outfit || '',
      background: raw.background || '',
      seed: String(raw.seed || row?.username || 'karhoot').slice(0, 80),
      options: raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options) ? raw.options : {}
    };
  } catch {
    config = { character: 'toon-head', outfit: '', background: '', seed: row?.username || 'karhoot', options: {} };
  }

  // Migrate old avatar configurations so they can never block the Toon Head system.
  let changed = false;
  if (LEGACY_CHARACTERS.has(config.character)) {
    config.character = 'toon-head';
    changed = true;
  }
  if (config.outfit === 'violet-fit' || config.outfit === 'black-fit') {
    config.outfit = '';
    changed = true;
  }
  if (changed) {
    db.prepare('UPDATE users SET avatar=?,avatar_config=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run('toon-head', JSON.stringify(config), userId);
  }
  return config;
}

avatarRouter.get('/catalog', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id,slug,name,category,style,price,description,icon,svg_content FROM avatar_items WHERE active=1 ORDER BY category,price,id').all();
  const items = rows.map(item => ({
    ...item,
    svg_content: undefined,
    ...(catalogMeta.get(item.slug)?.optionKey
      ? { optionKey: catalogMeta.get(item.slug).optionKey, optionValue: catalogMeta.get(item.slug).optionValue }
      : { optionKey: '', optionValue: '' }),
    owned: owned(req.user.id, item.slug),
    equipped: false,
    hasSvg: Boolean(item.svg_content)
  }));
  const config = getConfig(req.user.id);
  for (const item of items) {
    item.equipped = [config.character, config.outfit, config.background].includes(item.slug)
      || (item.optionKey && String(config.options?.[item.optionKey]) === String(item.optionValue));
  }
  res.json({ items });
});

avatarRouter.get('/custom/:slug.svg', (req, res) => {
  const item = db.prepare("SELECT svg_content FROM avatar_items WHERE slug=? AND active=1 AND svg_content<>''").get(req.params.slug);
  if (!item) return res.status(404).type('text/plain').send('SVG introuvable');
  res.type('image/svg+xml').set({ 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }).send(item.svg_content);
});

avatarRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id,username,avatar,avatar_config,coins,xp,level FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ user, config: getConfig(req.user.id) });
});

avatarRouter.post('/purchase', requireAuth, (req, res) => {
  const parsed = z.object({ slug: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Article invalide' });
  const item = db.prepare('SELECT * FROM avatar_items WHERE slug=? AND active=1').get(parsed.data.slug);
  if (!item) return res.status(404).json({ error: 'Article introuvable' });
  if (owned(req.user.id, item.slug)) return res.status(409).json({ error: 'Article déjà possédé' });
  const buy = db.transaction(() => {
    const user = db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id);
    if (!user || user.coins < item.price) throw new Error('NOT_ENOUGH_COINS');
    db.prepare('UPDATE users SET coins=coins-?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.price, req.user.id);
    db.prepare('INSERT INTO user_avatar_items(user_id,item_id) VALUES (?,?)').run(req.user.id, item.id);
    return db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id).coins;
  });
  try {
    const coins = buy();
    res.json({ ok: true, coins, item: { ...item, svg_content: undefined } });
  } catch (error) {
    if (error.message === 'NOT_ENOUGH_COINS') return res.status(400).json({ error: 'Pas assez de pièces' });
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Article déjà possédé' });
    console.error(error);
    return res.status(500).json({ error: 'Achat impossible' });
  }
});

avatarRouter.post('/equip', requireAuth, (req, res) => {
  const parsed = avatarConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Configuration invalide', details: parsed.error.flatten() });
  const config = parsed.data;

  if (LEGACY_CHARACTERS.has(config.character)) config.character = 'toon-head';

  for (const key of ['character', 'outfit', 'background']) {
    if (config[key] && !owned(req.user.id, config[key])) {
      return res.status(403).json({ error: `Article non possédé: ${config[key]}` });
    }
  }

  for (const [key, value] of Object.entries(config.options || {})) {
    const meta = catalogRows().find(item => item.optionKey === key && String(item.optionValue) === String(value));
    if (!meta) return res.status(400).json({ error: `Cosmétique invalide: ${key}` });
    if (!owned(req.user.id, meta.slug)) return res.status(403).json({ error: `Cosmétique non possédé: ${meta.slug}` });
  }

  const character = db.prepare('SELECT style,svg_content FROM avatar_items WHERE slug=? AND category=? AND active=1').get(config.character, 'character');
  if (!character) return res.status(400).json({ error: 'Personnage invalide' });

  db.prepare('UPDATE users SET avatar=?,avatar_config=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(character.style, JSON.stringify(config), req.user.id);
  res.json({ ok: true, config, avatar: character.style, customSvg: Boolean(character.svg_content) });
});
