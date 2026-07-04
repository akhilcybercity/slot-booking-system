require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : {
        rejectUnauthorized: false
    }
});

async function initDB() {
    try {
        // Bookings table
        await pool.query(`
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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        // Initialize default PIN if it doesn't exist
        const pinRes = await pool.query("SELECT value FROM settings WHERE key = 'pin'");
        if (pinRes.rows.length === 0) {
            await pool.query("INSERT INTO settings (key, value) VALUES ('pin', '1947')");
        }

        // Users table for Admin and Staff
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                role TEXT NOT NULL
            )
        `);

        // Initialize default admin
        const adminRes = await pool.query("SELECT username FROM users WHERE username = 'admin'");
        if (adminRes.rows.length === 0) {
            await pool.query("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')");
        }

        // Logs table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                username TEXT,
                action TEXT
            )
        `);

        // Initialize closedDates array as JSON string
        const closedDatesRes = await pool.query("SELECT value FROM settings WHERE key = 'closedDates'");
        if (closedDatesRes.rows.length === 0) {
            await pool.query("INSERT INTO settings (key, value) VALUES ('closedDates', '[]')");
        }

        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization error:", err);
    }
}

// Only initialize if DATABASE_URL is provided, else warn
if (process.env.DATABASE_URL) {
    initDB();
} else {
    console.warn("WARNING: DATABASE_URL is not set. Database not initialized.");
}

module.exports = pool;
