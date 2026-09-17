import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(__dirname, '..', 'karhoot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','teacher','admin')),
      avatar TEXT NOT NULL DEFAULT 'astronaut', xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL,
      name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS class_members (
      class_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(class_id,user_id), FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL, title TEXT NOT NULL,
      description TEXT DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, question TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 100, order_index INTEGER NOT NULL, FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0, order_index INTEGER NOT NULL, FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, class_id INTEGER NOT NULL,
      due_date TEXT, settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE, FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      score INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
      FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE, FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS submission_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id INTEGER NOT NULL, question_id INTEGER NOT NULL,
      answer_id INTEGER, is_correct INTEGER NOT NULL DEFAULT 0, response_time_ms INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE, FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY(answer_id) REFERENCES answers(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS live_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, host_id INTEGER NOT NULL,
      room_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'lobby', current_question INTEGER NOT NULL DEFAULT -1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
      FOREIGN KEY(host_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS live_players (
      game_id INTEGER NOT NULL, user_id INTEGER NOT NULL, score INTEGER NOT NULL DEFAULT 0,
      connected INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(game_id,user_id), FOREIGN KEY(game_id) REFERENCES live_games(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS xp_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS badges (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, icon TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_badges (user_id INTEGER NOT NULL, badge_id INTEGER NOT NULL, unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,badge_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(badge_id) REFERENCES badges(id) ON DELETE CASCADE);
  `);
  db.prepare("INSERT OR IGNORE INTO badges(name,description,icon) VALUES ('Premier pas','Terminer son premier quiz','🚀'),('Série de feu','Réussir 5 réponses consécutives','🔥'),('Champion','Gagner une partie live','🏆')").run();
}
