import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_CATALOG } from './avatar-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(__dirname, '..', 'karhoot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function addColumn(sql) {
  try { db.exec(sql); } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','teacher','admin')),
      avatar TEXT NOT NULL DEFAULT 'toon-head', xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS classes (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS class_members (class_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(class_id,user_id), FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS quizzes (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, question TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 100, order_index INTEGER NOT NULL, FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS answers (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, answer TEXT NOT NULL, is_correct INTEGER NOT NULL DEFAULT 0, order_index INTEGER NOT NULL, FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, class_id INTEGER NOT NULL, due_date TEXT, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER NOT NULL, student_id INTEGER NOT NULL, score INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, completed_at TEXT, FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS submission_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id INTEGER NOT NULL, question_id INTEGER NOT NULL, answer_id INTEGER, is_correct INTEGER NOT NULL DEFAULT 0, response_time_ms INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS live_games (id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, host_id INTEGER NOT NULL, room_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'lobby', current_question INTEGER NOT NULL DEFAULT -1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS live_players (game_id INTEGER NOT NULL, user_id INTEGER NOT NULL, score INTEGER NOT NULL DEFAULT 0, connected INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(game_id,user_id), FOREIGN KEY(game_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS live_answers (game_id INTEGER NOT NULL, user_id INTEGER NOT NULL, question_id INTEGER NOT NULL, answer_id INTEGER NOT NULL, is_correct INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(game_id,user_id,question_id), FOREIGN KEY(game_id) REFERENCES live_games(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE, FOREIGN KEY(answer_id) REFERENCES answers(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS xp_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS badges (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, icon TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_badges (user_id INTEGER NOT NULL, badge_id INTEGER NOT NULL, unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,badge_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS avatar_items (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('character','outfit','style','background')), style TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '✨', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS user_avatar_items (user_id INTEGER NOT NULL, item_id INTEGER NOT NULL, purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,item_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
  `);
  addColumn("ALTER TABLE users ADD COLUMN avatar_config TEXT NOT NULL DEFAULT '{}'");
  addColumn("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 100");
  addColumn("ALTER TABLE avatar_items ADD COLUMN svg_content TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE avatar_items ADD COLUMN creator_id INTEGER");
  addColumn("ALTER TABLE avatar_items ADD COLUMN anchor TEXT NOT NULL DEFAULT 'center'");
  addColumn("ALTER TABLE avatar_items ADD COLUMN pos_x REAL NOT NULL DEFAULT 50");
  addColumn("ALTER TABLE avatar_items ADD COLUMN pos_y REAL NOT NULL DEFAULT 50");
  addColumn("ALTER TABLE avatar_items ADD COLUMN scale REAL NOT NULL DEFAULT 100");
  addColumn("ALTER TABLE avatar_items ADD COLUMN rotation REAL NOT NULL DEFAULT 0");
  db.prepare("UPDATE users SET avatar='toon-head' WHERE avatar IN ('lorelei','adventurer','bottts','pixel-art','thumbs','avataaars','fun-emoji','bottts-neutral','croodles','voxel-art')").run();
  const oldStyles=['lorelei','adventurer','bottts','pixel-art','thumbs','avataaars','fun-emoji','bottts-neutral','croodles','voxel-art'];
  const marks=oldStyles.map(()=>'?').join(',');
  db.prepare(`DELETE FROM user_avatar_items WHERE item_id IN (SELECT id FROM avatar_items WHERE style IN (${marks}))`).run(...oldStyles);
  db.prepare(`DELETE FROM avatar_items WHERE style IN (${marks})`).run(...oldStyles);
  db.prepare("INSERT OR IGNORE INTO badges(name,description,icon) VALUES ('Premier pas','Terminer son premier quiz','🚀'),('Série de feu','Réussir 5 réponses consécutives','🔥'),('Champion','Gagner une partie live','🏆')").run();
  const insert = db.prepare('INSERT OR IGNORE INTO avatar_items(slug,name,category,style,price,description,icon) VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => AVATAR_CATALOG.forEach(([slug,name,category,style,price,description,icon]) => insert.run(slug,name,category,style,price,description,icon)))();
}
