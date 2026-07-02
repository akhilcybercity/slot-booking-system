const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Bookings table
    db.run(`
        CREATE TABLE IF NOT EXISTS bookings (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            slot_key TEXT NOT NULL,
            status TEXT NOT NULL,
            name TEXT,
            roll_no TEXT,
            department TEXT,
            is_under_18 INTEGER DEFAULT 0,
            duration INTEGER DEFAULT 10,
            cancel_code TEXT,
            parent_slot TEXT
        )
    `);

    // Settings table (PIN and Holidays)
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    // Initialize default PIN if it doesn't exist
    db.get("SELECT value FROM settings WHERE key = 'pin'", (err, row) => {
        if (!row) {
            db.run("INSERT INTO settings (key, value) VALUES ('pin', '1947')");
        }
    });

    // Initialize closedDates array as JSON string
    db.get("SELECT value FROM settings WHERE key = 'closedDates'", (err, row) => {
        if (!row) {
            db.run("INSERT INTO settings (key, value) VALUES ('closedDates', '[]')");
        }
    });
});

module.exports = db;
